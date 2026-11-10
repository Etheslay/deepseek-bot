import { describe, expect, it } from "vitest";
import { userBubbleInk, type Avatar } from "../../src/renderer/src/features/avatars/avatar-meta.js";

describe("userBubbleInk", () => {
  it("flips only the theme-aware black/white body", () => {
    const mono: Avatar = { kind: "mono" };
    const whiteOnDark: Avatar = { kind: "grok", shape: "blob", color: "mono" };
    const picture: Avatar = { kind: "image", dataUrl: "data:image/jpeg;base64,AAAA" };
    expect(userBubbleInk(mono)).toBe("mono");
    expect(userBubbleInk(whiteOnDark)).toBe("mono");
    expect(userBubbleInk(picture)).toBe("mono");
  });

  it("keeps a coloured bot on the theme default", () => {
    const blue: Avatar = { kind: "grok", shape: "blob", color: "#2A92FE" };
    const yellow: Avatar = { kind: "grok", shape: "blob", color: "#FFAF38" };
    expect(userBubbleInk(blue)).toBe("theme");
    expect(userBubbleInk(yellow)).toBe("theme");
  });
});
