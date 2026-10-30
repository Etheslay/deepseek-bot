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

function ruleBody(selector: string): string {
  const pattern = new RegExp(`${selector.replaceAll(".", "\\.")}\\s*\\{([^}]+)\\}`);
  const match = css.match(pattern);
  expect(match, selector).not.toBeNull();
  return match![1] ?? "";
}

describe("history replay row", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("stays quieter than a live row after the entrance animation fills", () => {
    expect(ruleBody(".msg-row.replay")).toMatch(/opacity:\s*0\.7\b/);
    expect(ruleBody(".msg-row.replay")).toMatch(/animation-name:\s*grokFadeUpReplay/);
    expect(css).toMatch(/@keyframes grokFadeUp\s*\{[\s\S]*?to\s*\{[^}]*opacity:\s*1\b/);
    expect(css).toMatch(/@keyframes grokFadeUpReplay\s*\{[\s\S]*?to\s*\{[^}]*opacity:\s*0\.7\b/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.msg-row\.replay\s*\{[^}]*animation:\s*none;[^}]*opacity:\s*0\.7\b/,
    );
  });

  it("computes a lower opacity on a replay row than on a live row", () => {
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
    expect(replayOpacity).toBeLessThan(liveOpacity);
    expect(replayOpacity).toBe(0.7);
  });
});
