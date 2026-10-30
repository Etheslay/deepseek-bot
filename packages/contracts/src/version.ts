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
// v0.5 adds MCP HTTP discovery/grants and mcp.call; prior senders stay accepted.
// v0.6 adds selected-window capture/OCR contracts; prior senders stay accepted.
// v0.7 adds manager orchestration (tasks, relay chains, coordinator role);
// prior senders stay accepted.
// v0.8 adds stdio MCP and credential-ref injection. Optional connector fields
// stay compatible; 0.1–0.7 senders stay accepted. Workflow documents are unchanged.
// D17 adds optional chat.send skills inside 0.8. No protocol bump.
// v0.9 adds the local voice backend (voice.transcribe, voice.speak,
// voice.status); prior senders stay accepted.
// v0.10 adds token usage accounting (usage.summary). Additive only: the method
// is new, existing methods keep their semantics, and workflow documents are
// unchanged, so 0.1–0.9 senders stay accepted.
// v0.11 adds skillLibrary.get/save — the D17 skill library moves from renderer
// localStorage to Host storage. Additive only: injection still rides
// chat.send.skills (0.8+), existing methods keep their semantics, and 0.1–0.10
// senders stay accepted.
// v0.12 adds the workflow read surface (workflow.get, run.snapshot,
// approval.list) so the desktop editor and run monitor can stop reading the
// fixture service. Additive only: every method wraps an existing storage/engine
// read, no entity changes, and 0.1–0.11 senders stay accepted.
export const CONTRACT_VERSION = "0.12" as const;
export const PROTOCOL_VERSION = CONTRACT_VERSION;
/** Workflow documents did not change in v0.3–v0.11; keep the document version. */
export const WORKFLOW_SCHEMA_VERSION = "0.1" as const;

export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "0.1",
  "0.2",
  "0.3",
  "0.4",
  "0.5",
  "0.6",
  "0.7",
  "0.8",
  "0.9",
  "0.10",
  "0.11",
  PROTOCOL_VERSION,
];

export function isProtocolVersionSupported(version: string): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}
