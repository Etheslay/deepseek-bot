/**
 * A chat turn may message another bot only when this user message asked for
 * that handoff. A deck, a document, or an ordinary question is this bot's own
 * work: dispatch_task is refused and no permission card is raised.
 *
 * The check is the current message only. An older handoff does not keep a
 * later unrelated turn open.
 */
export function userAskedAnotherBot(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (/其他\s*bot|其它\s*bot|别的\s*bot|另一个\s*bot|其他机器人|别的机器人/i.test(text)) {
    return true;
  }
  if (/派发|派给|派任务/.test(compact)) return true;
  if (/发给(?!我)/.test(compact)) return true;
  if (/交给(?!你|我)/.test(compact)) return true;
  if (/\b(dispatch|another bot|other bots?)\b/i.test(text)) return true;
  return false;
}
