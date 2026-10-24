const REDACTED = "[REDACTED]";

/**
 * Mask common secret patterns in arbitrary text.
 * Patterns: sk-..., Bearer ..., DEEPSEEK_API_KEY=..., api_key=...
 * Empty string stays empty; plain text is unchanged.
 */
export function redactSecrets(input: string): string {
  if (input === "") {
    return "";
  }

  let output = input;

  output = output.replace(/\bsk-[A-Za-z0-9_-]+/g, REDACTED);

  output = output.replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`);

  output = output.replace(
    /\bDEEPSEEK_API_KEY\s*=\s*\S+/gi,
    `DEEPSEEK_API_KEY=${REDACTED}`,
  );

  output = output.replace(/\bapi_key\s*=\s*\S+/gi, `api_key=${REDACTED}`);

  return output;
}
