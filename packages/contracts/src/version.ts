/**
 * Contract versioning (docs/CONTRACTS.md §1, §7).
 *
 * The protocol version is the compatibility boundary: receivers reject any
 * unknown version (including higher ones) instead of silently dropping
 * fields. Within one protocol version, added optional fields are a
 * compatible extension, so parsers ignore unknown object keys.
 *
 * v0.3 (D16 permission control plane) adds methods and entities without changing any
 * existing method's semantics, so the envelope protocol bumps its minor
 * version while the workflow document schemaVersion stays at "0.1" —
 * stored workflows/run snapshots keep parsing unchanged. Senders on the
 * previous protocols ("0.1", "0.2") remain accepted.
 *
 * v0.4 (D28 artifact co-edit sidecar) adds the `artifacts.*` method group
 * over bot workspace files; existing methods are untouched, so this is again
 * a minor-only bump and "0.1"–"0.3" senders stay accepted.
 *
 * v0.5 (manager orchestration, TASK_MANAGER_ORCHESTRATION.md) adds the
 * coordinator bot role, the `task.*` method group and the `task.status`
 * event kind. Everything is additive: existing methods keep their
 * semantics, so "0.1"–"0.4" senders stay accepted.
 */
export const CONTRACT_VERSION = "0.5" as const;
export const PROTOCOL_VERSION = CONTRACT_VERSION;
/** Workflow documents did not change in v0.3/v0.4/v0.5; keep the document version. */
export const WORKFLOW_SCHEMA_VERSION = "0.1" as const;

export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "0.1",
  "0.2",
  "0.3",
  "0.4",
  PROTOCOL_VERSION,
];

export function isProtocolVersionSupported(version: string): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}
