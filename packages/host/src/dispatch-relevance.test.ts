import { describe, expect, it } from "vitest";
import { userAskedAnotherBot } from "./dispatch-relevance.js";

const PPT = [
  "给我做一份 8 页的 PPT，文件必须是 .pptx，做完把文件路径发我，我要点开。",
  "题目：三年级数学「认识分数」。听众：小学三年级学生和家长。",
  "目的：用一节课讲清什么是分数、怎么比较大小。必须写进文稿：",
  "- 1/2 大于 1/4 - 把一个苹果平均分成 4 份，其中 1 份是 1/4",
  "- 比较分数时，分母相同看分子",
  "不要做网页，不要给 .html、.bat 或下载按钮，不要只给文字提纲",
].join("");

describe("userAskedAnotherBot", () => {
  it("treats a deck request as this bot's own work", () => {
    expect(userAskedAnotherBot(PPT)).toBe(false);
    expect(userAskedAnotherBot("给小学三年级做一份 5 页的数学课 PPT")).toBe(false);
    expect(userAskedAnotherBot("你好")).toBe(false);
    expect(userAskedAnotherBot("把文件路径发给我")).toBe(false);
    expect(userAskedAnotherBot("这件事交给你")).toBe(false);
  });

  it("recognizes a request to hand work to another bot", () => {
    expect(userAskedAnotherBot("把这周的选题任务发给写手")).toBe(true);
    expect(userAskedAnotherBot("派给温柔做一页")).toBe(true);
    expect(userAskedAnotherBot("交给其他 bot")).toBe(true);
    expect(userAskedAnotherBot("please dispatch this to another bot")).toBe(true);
  });
});
