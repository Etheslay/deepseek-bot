/**
 * Bot node prompt composition (D12).
 *
 * The engine passes the raw `instructionTemplate` and the resolved input
 * values (CONTRACTS §2 Node); rendering into the actual model prompt is the
 * adapter's job. Template text and instructions are data, never code
 * (CONTRACTS §1) — they are composed as plain text blocks, and the only
 * expansion is the explicit `{{input.<key>}}` placeholder.
 */
import { NodeExecutionError } from "@deepseek-bot/runtime";
import type { Bot, WorkflowNode } from "@deepseek-bot/contracts";

const PLACEHOLDER = /\{\{\s*input\.([A-Za-z0-9_.-]+)\s*\}\}/g;

/**
 * Render `{{input.KEY}}` placeholders. String inputs are inserted verbatim;
 * every other JSON value is serialized. A placeholder without a matching
 * input is a workflow configuration error (INVALID_INPUT), not an empty
 * substitution — a silently missing value would send the model fabricated
 * context.
 */
export function renderInstructionTemplate(
  template: string,
  inputs: Readonly<Record<string, unknown>>,
): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(inputs, key)) {
      throw new NodeExecutionError({
        code: "INVALID_INPUT",
        message: `instruction template references unknown input '${key}'`,
        retryable: false,
      });
    }
    const value = inputs[key];
    return typeof value === "string" ? value : JSON.stringify(value) ?? "null";
  });
}

/**
 * Compose the user prompt for one bot node attempt: the bot's standing
 * instructions, the rendered node instruction and the resolved inputs.
 * Sections are labelled so the model can tell standing policy from the
 * per-node task; the layout is part of the adapter's observable behavior.
 */
export function composeNodePrompt(
  bot: Bot,
  node: WorkflowNode,
  inputs: Readonly<Record<string, unknown>>,
): string {
  const rendered = renderInstructionTemplate(node.instructionTemplate, inputs);
  const sections = [
    `## Standing instructions\n${bot.instructions.trim()}`,
    `## Task\n${rendered.trim()}`,
  ];
  const inputKeys = Object.keys(inputs);
  if (inputKeys.length > 0) {
    const lines = inputKeys.map((key) => {
      const value = inputs[key];
      return `- ${key}: ${typeof value === "string" ? value : JSON.stringify(value) ?? "null"}`;
    });
    sections.push(`## Inputs\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}
