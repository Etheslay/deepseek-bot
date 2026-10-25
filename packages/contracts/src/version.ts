/**
 * Contract versioning (docs/CONTRACTS.md §1, §7).
 *
 * The protocol version is the compatibility boundary: receivers reject any
 * unknown version (including higher ones) instead of silently dropping
 * fields. Within one protocol version, added optional fields are a
 * compatible extension, so parsers ignore unknown object keys.
 *
 * v0.2 (D15 write layer) adds methods and entities without changing any
 * existing method's semantics, so the envelope protocol bumps its minor
 * version while the workflow document schemaVersion stays at "0.1" —
 * stored workflows/run snapshots keep parsing unchanged. Senders on the
 * previous protocol ("0.1") remain accepted.
 */
export const CONTRACT_VERSION = "0.2" as const;
export const PROTOCOL_VERSION = CONTRACT_VERSION;
/** Workflow documents did not change in v0.2; keep the document version. */
export const WORKFLOW_SCHEMA_VERSION = "0.1" as const;

export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "0.1",
  PROTOCOL_VERSION,
];

export function isProtocolVersionSupported(version: string): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}
