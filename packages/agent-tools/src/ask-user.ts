import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";

const optionId = z.enum(["A", "B", "C", "D"]);
export const AskUserInputSchema = z
  .object({
    question: z.string().trim().min(1).max(2_000),
    options: z
      .array(
        z
          .object({
            id: optionId,
            label: z.string().trim().min(1).max(1_000),
          })
          .strict(),
      )
      .min(2)
      .max(4)
      .refine(
        (options) => new Set(options.map((option) => option.id)).size === options.length,
        "option ids must be unique",
      ),
    allowOther: z.boolean().default(true),
  })
  .strict();

export type AskUserInput = z.output<typeof AskUserInputSchema>;
export type AskUserRequest = AskUserInput & {
  requestId: string;
  callerId: string;
  createdAt: string;
  expiresAt: string;
};
export interface AskUserResult {
  readonly requestId: string;
  readonly optionId?: z.infer<typeof optionId>;
  /** Selected option label or the user's trimmed free text. */
  readonly text: string;
}

const answerSchema = z.union([
  z.object({ optionId }).strict(),
  z.object({ text: z.string().trim().min(1).max(4_000) }).strict(),
]);
const WAIT_TIMEOUT_MS = 30 * 60_000;

/** Trusted Host controls, deliberately absent from the model tool registry. */
export interface UserQuestionControls {
  /** Returns detached snapshots; callerId optionally narrows the result. */
  listPending(callerId?: string): AskUserRequest[];
  answer(requestId: string, callerId: string, answer: unknown): void;
  cancel(requestId: string, callerId: string): void;
}

interface PendingQuestion {
  readonly request: AskUserRequest;
  readonly resolve: (answer: AskUserResult) => void;
  readonly reject: (error: ToolRejectionError) => void;
  readonly cleanup: () => void;
}

/**
 * One Host owns one coordinator. Questions live only for that Host lifetime;
 * neither the questions nor their answers are persisted or replayed.
 */
export class AskUserCoordinator implements UserQuestionControls {
  private readonly pending = new Map<string, PendingQuestion>();
  private closed = false;

  ask(input: AskUserInput, context: ToolContext): Promise<AskUserResult> {
    if (this.closed) {
      return Promise.reject(
        new ToolRejectionError("RUNTIME_UNAVAILABLE", "ask_user host is closed"),
      );
    }
    if (context.signal?.aborted) {
      return Promise.reject(new ToolRejectionError("CANCELLED", "ask_user was cancelled"));
    }
    const createdAt = Date.now();
    const request: AskUserRequest = {
      ...structuredClone(input),
      requestId: randomUUID(),
      callerId: context.caller.id,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + WAIT_TIMEOUT_MS).toISOString(),
    };
    return new Promise((resolve, reject) => {
      const abort = () => this.fail(request.requestId, "CANCELLED", "ask_user was cancelled");
      const timer = setTimeout(() => {
        this.fail(request.requestId, "TOOL_TIMEOUT", "ask_user timed out waiting for an answer");
      }, WAIT_TIMEOUT_MS);
      timer.unref();
      this.pending.set(request.requestId, {
        request,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          context.signal?.removeEventListener("abort", abort);
        },
      });
      context.signal?.addEventListener("abort", abort, { once: true });
    });
  }

  listPending(callerId?: string): AskUserRequest[] {
    const requests: AskUserRequest[] = [];
    for (const entry of this.pending.values()) {
      if (this.expire(entry)) continue;
      if (callerId === undefined || callerId === entry.request.callerId) {
        requests.push(structuredClone(entry.request));
      }
    }
    return requests;
  }

  answer(requestId: string, callerId: string, answer: unknown): void {
    const entry = this.requirePending(requestId, callerId);
    const parsed = answerSchema.safeParse(answer);
    if (!parsed.success)
      throw new ToolRejectionError("INVALID_INPUT", "ask_user answer is invalid");
    let result: AskUserResult;
    if ("optionId" in parsed.data) {
      const selectedId = parsed.data.optionId;
      const selected = entry.request.options.find((option) => option.id === selectedId);
      if (selected === undefined)
        throw new ToolRejectionError("INVALID_INPUT", "ask_user option is unavailable");
      result = { requestId, optionId: selected.id, text: selected.label };
    } else {
      if (!entry.request.allowOther)
        throw new ToolRejectionError("INVALID_INPUT", "ask_user does not accept other text");
      result = { requestId, text: parsed.data.text };
    }
    this.remove(entry);
    entry.resolve(result);
  }

  cancel(requestId: string, callerId: string): void {
    this.requirePending(requestId, callerId);
    this.fail(requestId, "CANCELLED", "ask_user was cancelled");
  }

  close(): void {
    this.closed = true;
    for (const requestId of this.pending.keys()) {
      this.fail(requestId, "RUNTIME_UNAVAILABLE", "ask_user host is closed");
    }
  }

  private requirePending(requestId: string, callerId: string): PendingQuestion {
    const entry = this.pending.get(requestId);
    if (entry === undefined || entry.request.callerId !== callerId || this.expire(entry)) {
      throw new ToolRejectionError(
        "INVALID_INPUT",
        "ask_user request is unavailable for this caller",
      );
    }
    return entry;
  }

  private expire(entry: PendingQuestion): boolean {
    if (Date.now() < Date.parse(entry.request.expiresAt)) return false;
    this.fail(entry.request.requestId, "TOOL_TIMEOUT", "ask_user timed out waiting for an answer");
    return true;
  }

  private fail(
    requestId: string,
    code: "CANCELLED" | "TOOL_TIMEOUT" | "RUNTIME_UNAVAILABLE",
    message: string,
  ): void {
    const entry = this.pending.get(requestId);
    if (entry === undefined) return;
    this.remove(entry);
    entry.reject(new ToolRejectionError(code, message));
  }

  private remove(entry: PendingQuestion): void {
    this.pending.delete(entry.request.requestId);
    entry.cleanup();
  }
}

export function bindAskUserTool(
  coordinator: AskUserCoordinator,
): ToolCapability<typeof AskUserInputSchema> {
  return {
    name: "ask_user",
    description:
      "Ask the user one question with 2-4 choices and optionally other text. Waits for their answer; does not grant permission or approve any action.",
    inputSchema: AskUserInputSchema,
    handler: (params, context) => coordinator.ask(params, context),
  };
}
