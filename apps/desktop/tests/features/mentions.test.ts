import { describe, expect, it } from "vitest";
import { linkMentions, type MentionTable } from "../../src/renderer/src/features/chat/mentions.js";

const mentions: MentionTable = new Map([
  ["create", { botKey: 4, color: "#f472b6", shape: "circle" }],
  ["writer", { botKey: 2, color: "#60a5fa", shape: "circle" }],
]);

describe("linkMentions", () => {
  it("links a known name with or without @", () => {
    const html = linkMentions("<p>交给 create 开渲，并 @writer 终审</p>", mentions);
    expect(html).toContain('data-bot-key="4"');
    expect(html).toContain('data-bot-key="2"');
    expect(html).toContain('data-mention="create"');
    expect(html).toContain('data-mention="writer"');
  });

  it("links a name sitting against CJK", () => {
    const html = linkMentions("<p>交给create开渲</p>", mentions);
    expect(html).toContain('data-bot-key="4"');
  });

  it("does not link a name inside a longer latin word", () => {
    const html = linkMentions("<p>recreate the plan</p>", mentions);
    expect(html).not.toContain("mention-chip");
  });
});
