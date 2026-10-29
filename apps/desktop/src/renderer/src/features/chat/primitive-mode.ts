/**
 * 原始人模式 (primitive mode) — the per-bot renderer preference behind the
 * composer switch. Like the skill library and bot templates this lives in
 * localStorage (the renderer-first shelf); host-side persistence waits for
 * the Renderer→Host 拍板. Only enabled bots are stored, so the absent key
 * reads as off and the file stays tiny.
 */
const STORAGE_KEY = "deepseek-bot.primitive-mode.v1";

export function loadPrimitiveModes(storage: Storage): Record<string, true> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const modes: Record<string, true> = {};
    for (const [botId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === true) {
        modes[botId] = true;
      }
    }
    return modes;
  } catch {
    return {};
  }
}

export function setPrimitiveMode(
  storage: Storage,
  botId: string,
  enabled: boolean,
): Record<string, true> {
  const next = loadPrimitiveModes(storage);
  if (enabled) {
    next[botId] = true;
  } else {
    delete next[botId];
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The in-memory map still reflects this session's choice.
  }
  return next;
}
