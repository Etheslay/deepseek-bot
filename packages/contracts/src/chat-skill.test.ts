import { describe, expect, it } from "vitest";
import { MAX_CHAT_SKILLS, METHOD_CONTRACTS, PROTOCOL_VERSION } from "./index.js";

const botId = "11111111-1111-4111-8111-111111111111";

describe("chat.send skill injection", () => {
  const request = METHOD_CONTRACTS["chat.send"].request;

  it("stays on the current protocol and still accepts a turn without skills", () => {
    // v0.14 (G12) added the chat.session.* group; chat.send itself only grew
    // the optional sessionId (and, from B3'', the optional images array plus
    // the vision.status flag) — a plain turn still parses exactly as before.
    expect(PROTOCOL_VERSION).toBe("0.14");
    expect(request.safeParse({ botId, text: "你好" }).success).toBe(true);
  });

  it("accepts admitted raster attachments and rejects others (B3'' 视觉输入)", () => {
    expect(
      request.safeParse({
        botId,
        text: "看这张图",
        images: [{ data: "aGk=", mimeType: "image/png" }],
      }).success,
    ).toBe(true);
    expect(
      request.safeParse({
        botId,
        text: "看这张图",
        images: [{ data: "aGk=", mimeType: "image/heic" }],
      }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: 5 }, () => ({
      data: "aGk=",
      mimeType: "image/png" as const,
    }));
    expect(request.safeParse({ botId, text: "看", images: tooMany }).success).toBe(false);
  });

  it("accepts capability ids and rejects an unknown declaration", () => {
    expect(
      request.safeParse({
        botId,
        text: "你好",
        skills: [{ name: "周报", version: 1, instructions: "三段", capabilities: ["fs.read"] }],
      }).success,
    ).toBe(true);
    const rejected = request.safeParse({
      botId,
      text: "你好",
      skills: [{ name: "周报", version: 1, instructions: "三段", capabilities: ["read"] }],
    });
    expect(rejected.success).toBe(false);
  });

  it("rejects duplicate capabilities and more skills than one turn can carry", () => {
    expect(
      request.safeParse({
        botId,
        text: "你好",
        skills: [
          { name: "周报", version: 1, instructions: "三段", capabilities: ["fs.read", "fs.read"] },
        ],
      }).success,
    ).toBe(false);
    const skills = Array.from({ length: MAX_CHAT_SKILLS + 1 }, (_, index) => ({
      name: `s${index}`,
      version: 1,
      instructions: "x",
      capabilities: [] as const,
    }));
    expect(request.safeParse({ botId, text: "你好", skills }).success).toBe(false);
  });
});
