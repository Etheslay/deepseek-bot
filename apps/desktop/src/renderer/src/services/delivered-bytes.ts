/**
 * Pull a finished office file out of the bot workspace, one slice at a time.
 * `chat.send` only names the file. The bytes stay under the 1 MiB envelope.
 */
import {
  DeliveredFileSchema,
  METHOD_CONTRACTS,
  WORKSPACE_EXPORT_CHUNK_BYTES,
  type DeliveredFile,
} from "@deepseek-bot/contracts";

export function deliveredFilesFromResponse(value: unknown): DeliveredFile[] {
  if (!Array.isArray(value)) return [];
  const files: DeliveredFile[] = [];
  for (const item of value) {
    const parsed = DeliveredFileSchema.safeParse(item);
    if (parsed.success) files.push(parsed.data);
  }
  return files;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

/** Pull one delivered file. The result length must match the card's size. */
export async function fetchDeliveredBytes(
  call: (method: string, payload: unknown) => Promise<unknown>,
  botId: string,
  file: Pick<DeliveredFile, "path" | "bytes">,
): Promise<Uint8Array> {
  const out = new Uint8Array(file.bytes);
  let offset = 0;
  while (offset < file.bytes) {
    const raw = await call("workspace.export", {
      botId,
      path: file.path,
      offset,
      limit: Math.min(WORKSPACE_EXPORT_CHUNK_BYTES, file.bytes - offset),
    });
    const slice = METHOD_CONTRACTS["workspace.export"].response.parse(raw);
    const chunk = decodeBase64(slice.data);
    if (chunk.byteLength === 0) break;
    const room = out.byteLength - offset;
    out.set(chunk.subarray(0, room), offset);
    offset += Math.min(chunk.byteLength, room);
  }
  if (offset !== file.bytes) {
    throw new Error("delivered file length did not match");
  }
  return out;
}
