/**
 * @deepseek-bot/runtime — workflow engine for DeepSeekBot (D06).
 *
 * Owns: DAG validation at start, sequential/parallel dispatch with a
 * concurrency limit, stop-descendants failure policy, bounded retries,
 * whole-graph cancellation, approval-node pauses, immutable run snapshots
 * and persistent event emission with sequence continuity.
 * Does NOT own: tool permission enforcement (D08), the Harness adapter
 * process (plugs in via NodeExecutor), scheduling (D10) or the desktop IPC
 * surface.
 */
export * from "./errors.js";
export * from "./executor.js";
export * from "./backoff.js";
export * from "./graph.js";
export * from "./run-events.js";
export * from "./run-execution.js";
export * from "./engine.js";
