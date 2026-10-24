/**
 * Contract versioning (docs/CONTRACTS.md §1, §7).
 *
 * The protocol version is the compatibility boundary: receivers reject any
 * unknown version (including higher ones) instead of silently dropping
 * fields. Within one protocol version, added optional fields are a
 * compatible extension, so parsers ignore unknown object keys.
 */
export const CONTRACT_VERSION = "0.1" as const;
export const PROTOCOL_VERSION = CONTRACT_VERSION;
export const WORKFLOW_SCHEMA_VERSION = CONTRACT_VERSION;

export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [PROTOCOL_VERSION];

export function isProtocolVersionSupported(version: string): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}
