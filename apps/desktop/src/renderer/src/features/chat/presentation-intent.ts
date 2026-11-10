/**
 * The chat wait says "制作演示文稿" when the user asked for a deck.
 * Summarizing an attached pptx is a different wait (the file is being read).
 */
const MENTION = /pptx?|power\s*point|幻灯片|演示文稿|slides?/i;
const MAKING =
  /做|制作|生成|写一|创建|来一份|来一个|做个|做一份|能做|可以做|能不能|可不可以|\bmake\b|\bcreate\b|\bbuild\b|\bgenerate\b|\bdraft\b/i;

export function asksToMakePresentation(text: string): boolean {
  const question = text.trim();
  if (question.length === 0 || question.length > 2_000) return false;
  return MENTION.test(question) && MAKING.test(question);
}
