/**
 * The chat wait says "制作文档" or "转换成 PDF" when the user asked for that.
 * Summarizing an attached file stays on the reading wait.
 */
const WORD = /docx|\bword\b|文档|文字稿/i;
const MAKING =
  /做|制作|生成|写一|新建|创建|来一份|来一个|做个|做一份|能做|可以做|能不能|可不可以|修改|加上|删掉|删除|\bmake\b|\bcreate\b|\bbuild\b|\bgenerate\b|\bdraft\b|\bedit\b/i;
const CONVERT = /转成\s*pdf|转为\s*pdf|转换成\s*pdf|导出\s*pdf|convert(?:\s+\w+){0,3}\s+to\s+pdf/i;

export function asksToConvertToPdf(text: string): boolean {
  const question = text.trim();
  if (question.length === 0 || question.length > 2_000) return false;
  return CONVERT.test(question);
}

export function asksToMakeDocument(text: string): boolean {
  const question = text.trim();
  if (question.length === 0 || question.length > 2_000) return false;
  if (asksToConvertToPdf(question)) return false;
  return WORD.test(question) && MAKING.test(question);
}
