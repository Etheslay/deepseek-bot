// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const cssPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/renderer/src/styles.css",
);

const css = readFileSync(cssPath, "utf8");

describe("history replay row", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("keeps history text as bright as a live row", () => {
    expect(css).not.toMatch(/\.msg-row\.replay\s*\{[^}]*opacity:\s*0\.7\b/);
    expect(css).not.toMatch(/@keyframes grokFadeUpReplay/);
    expect(css).toMatch(/@keyframes grokFadeUp\s*\{[\s\S]*?to\s*\{[^}]*opacity:\s*1\b/);
  });

  it("computes the same opacity on a replay row as on a live row", () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const live = document.createElement("div");
    live.className = "msg-row bot";
    const replay = document.createElement("div");
    replay.className = "msg-row bot replay";
    replay.setAttribute("data-history", "true");
    document.body.append(live, replay);
    const liveOpacity = Number(getComputedStyle(live).opacity);
    const replayOpacity = Number(getComputedStyle(replay).opacity);
    expect(replayOpacity).toBe(liveOpacity);
    expect(replayOpacity).toBe(1);
  });
});
