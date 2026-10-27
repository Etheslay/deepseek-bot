/**
 * Connector invocation driver (D19). The only code that talks to a
 * registered local service. The endpoint is loopback http(s), enforced at
 * storage time; the first official action is Stable Diffusion txt2img
 * against the local SD WebUI API (`/sdapi/v1/txt2img`). Generated images
 * land under the data root's connector-outputs directory and are referenced
 * by absolute path — image bytes never travel through the contract
 * envelope (1 MiB message cap). Credential references stay unresolved:
 * local services need none, and resolving them is a later, explicit slice.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConnector } from "@deepseek-bot/storage";

export const CONNECTOR_ACTIONS = ["txt2img"] as const;
export type ConnectorAction = (typeof CONNECTOR_ACTIONS)[number];

export const CONNECTOR_TIMEOUT_MS = 120_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface ConnectorInvokeInput {
  readonly connectorId: string;
  readonly action: string;
  readonly params: {
    readonly prompt: string;
    readonly negativePrompt?: string | undefined;
    readonly width?: number | undefined;
    readonly height?: number | undefined;
    readonly steps?: number | undefined;
  };
}

export interface ConnectorInvokeResult {
  readonly connectorId: string;
  readonly action: ConnectorAction;
  readonly savedPath: string;
  readonly sizeBytes: number;
  readonly at: string;
}

export interface ConnectorNow {
  readonly now: () => Date;
}

function invalid(message: string): Error {
  return new Error(message);
}

/**
 * Execute one connector action. Throws plain errors with sanitized
 * messages — the gateway audits them as RUNTIME_ERROR and the model sees
 * the reason, never a stack trace or response body.
 */
export async function invokeConnector(
  db: Parameters<typeof getConnector>[0],
  outputsRoot: string,
  input: ConnectorInvokeInput,
  clock: ConnectorNow,
): Promise<ConnectorInvokeResult> {
  if (input.action !== "txt2img") {
    throw invalid(`unsupported connector action '${input.action}'`);
  }
  const prompt = input.params.prompt.trim();
  if (prompt.length === 0) throw invalid("prompt must not be empty");
  const connector = getConnector(db, input.connectorId);
  if (connector.kind !== "sd-webui") {
    throw invalid("this action requires a Stable Diffusion connector");
  }
  if (!connector.enabled) {
    throw invalid(`connector '${connector.name}' is disabled`);
  }
  if (connector.endpoint === null) {
    throw invalid(`connector '${connector.name}' has no endpoint configured`);
  }

  const url = `${connector.endpoint.replace(/\/+$/, "")}/sdapi/v1/txt2img`;
  const body = {
    prompt,
    negative_prompt: input.params.negativePrompt ?? "",
    width: input.params.width ?? 512,
    height: input.params.height ?? 512,
    steps: input.params.steps ?? 20,
    batch_size: 1,
  };
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw invalid(`connector did not answer within ${CONNECTOR_TIMEOUT_MS / 1000}s`);
    }
    throw invalid(`connector endpoint is unreachable (${connector.endpoint})`);
  }
  if (!response.ok) {
    throw invalid(`connector returned HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw invalid("connector returned a non-JSON response");
  }
  const images = (payload as { images?: unknown }).images;
  if (!Array.isArray(images) || images.length === 0 || typeof images[0] !== "string") {
    throw invalid("connector response carries no image");
  }
  const image = Buffer.from(images[0]!, "base64");
  if (image.byteLength === 0) throw invalid("connector response carries no image");
  if (image.byteLength > MAX_IMAGE_BYTES) {
    throw invalid(`connector image exceeds ${MAX_IMAGE_BYTES / (1024 * 1024)} MiB`);
  }

  const dir = join(outputsRoot, input.connectorId);
  mkdirSync(dir, { recursive: true });
  const stamp = clock.now().toISOString().slice(0, 10);
  const savedPath = join(dir, `${stamp}-${randomUUID()}.png`);
  writeFileSync(savedPath, image);
  return {
    connectorId: input.connectorId,
    action: "txt2img",
    savedPath,
    sizeBytes: image.byteLength,
    at: clock.now().toISOString(),
  };
}
