/**
 * Capability labels (D22).
 *
 * Capability ids come from the contract and are stable data; only their display
 * text is localized. The map holds message keys, so switching language changes
 * what the user reads without touching any stored value. Both the settings panel
 * and the in-chat approval cards import this one table — it used to be duplicated
 * (and frozen at import time) in each file.
 */
import type { CapabilityId } from "@deepseek-bot/contracts";
import { t, type MessageKey } from "../../i18n.js";

const CAPABILITY_LABEL_KEYS = {
  "app.read": "permissions.readAppData",
  "app.create_group": "shell.createGroup",
  "app.create_bot": "permissions.createBot",
  "app.update_bot": "permissions.updateBot",
  "app.create_workflow": "permissions.updateWorkflow",
  "app.start_run": "permissions.startRun",
  "app.cancel_run": "permissions.cancelRun",
  "app.revoke_creation": "permissions.revokeCreationBatch",
  "interaction.ask_user": "permissions.askUser",
  "network.search": "permissions.webSearch",
  "memory.read": "permissions.memoryRead",
  "memory.write": "permissions.memoryWrite",
  "fs.read": "permissions.readWorkspaceFiles",
  "fs.write": "permissions.writeWorkspaceFiles",
  "exec.shell": "permissions.executeLocalCommand",
  "screen.capture": "permissions.screenAndWindowAwareness",
  "device.action": "permissions.deviceAction",
  "connector.invoke": "permissions.invokeConnector",
  "app.dispatch_task": "permissions.dispatchTask",
  "app.learn_skill": "permissions.learnSkill",
  "mcp.call": "permissions.mcpCall",
} as const satisfies Record<CapabilityId, MessageKey>;

export function capabilityLabel(capability: CapabilityId): string {
  return t(CAPABILITY_LABEL_KEYS[capability]);
}

/** One glyph per capability family for the Grok-style card header (图二). */
const CAPABILITY_GLYPHS: Partial<Record<CapabilityId, string>> = {
  "app.read": "🤖",
  "app.create_group": "🤖",
  "app.create_bot": "🤖",
  "app.update_bot": "🤖",
  "app.create_workflow": "🧩",
  "app.start_run": "▶️",
  "app.cancel_run": "⏹️",
  "app.revoke_creation": "🤖",
  "app.dispatch_task": "📨",
  "app.learn_skill": "📘",
  "interaction.ask_user": "❓",
  "network.search": "🔍",
  "memory.read": "🧠",
  "memory.write": "🧠",
  "fs.read": "📁",
  "fs.write": "📁",
  "exec.shell": "💻",
  "screen.capture": "🖥️",
  "device.action": "🖱️",
  "connector.invoke": "🔌",
  "mcp.call": "🔌",
};

/** The header glyph of the first capability on the card. */
export function capabilityGlyph(capabilities: readonly CapabilityId[]): string {
  return CAPABILITY_GLYPHS[capabilities[0] ?? "app.read"] ?? "🤖";
}
