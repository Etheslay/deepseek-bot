// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const cssPath = join(process.cwd(), "src/renderer/src/styles.css");
const rendererRoot = join(process.cwd(), "src/renderer");
const css = readFileSync(cssPath, "utf8");

const blockStart = css.indexOf("/* ---------- dropdown-option-selection");
const blockEnd = css.indexOf("/* ---------- D28", blockStart);
const block = css.slice(blockStart, blockEnd);

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
      continue;
    }
    if (entry.endsWith(".tsx") || entry.endsWith(".jsx")) files.push(path);
  }
  return files;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("dropdown option selection style", () => {
  it("uses a dark-gray wash for the chosen and hovered row, not a white bar", () => {
    const dark = css.slice(0, css.indexOf(':root[data-theme="light"]'));
    expect(dark).toMatch(/--dropdown-selected-bg:\s*rgba\(127,\s*127,\s*127,\s*0\.14\);/);
    expect(dark).toMatch(/--dropdown-hover-bg:\s*rgba\(127,\s*127,\s*127,\s*0\.1\);/);
    expect(dark).not.toMatch(/--dropdown-selected-bg:\s*#fff;/);
    expect(dark).not.toMatch(/--dropdown-selected-fg:\s*#000;/);
    const light = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf("box-sizing"));
    expect(light).toMatch(/--dropdown-selected-bg:\s*rgba\(15,\s*23,\s*42,\s*0\.06\);/);
    expect(light).toMatch(/--dropdown-hover-bg:\s*rgba\(15,\s*23,\s*42,\s*0\.04\);/);
    expect(light).not.toMatch(/--dropdown-selected-bg:\s*#000;/);
  });

  it("covers selected, hover, focus, aria-selected, and text selection from the shared tokens", () => {
    expect(blockStart).toBeGreaterThan(0);
    expect(blockEnd).toBeGreaterThan(blockStart);
    for (const selector of [
      ".custom-select-item.current",
      '.custom-select-item[aria-selected="true"]',
      ".custom-select-item:hover",
      ".custom-select-item:focus",
      ".custom-select-item:focus-visible",
      "select option:checked",
      "select option:hover",
      "select option:focus",
      ".custom-select-item::selection",
      "select option::selection",
    ]) {
      expect(block).toContain(selector);
    }
    expect(block).toContain("var(--dropdown-selected-bg)");
    expect(block).toContain("var(--dropdown-hover-bg)");
    expect(block).toContain("var(--dropdown-selected-fg)");
    expect(block).toContain("outline: none");
    const painted = withoutComments(block);
    expect(painted).not.toMatch(/#(?:8ab4ff|3b82f6|4f7cff|6ea8ff|0a84ff|0078d4)/i);
    expect(painted).not.toMatch(/\b(?:blue|Highlight)\b/);
  });

  it("does not leave a second selected or hover fill on the custom option", () => {
    const elsewhere = withoutComments(css.slice(0, blockStart) + css.slice(blockEnd));
    expect(elsewhere).not.toMatch(/\.custom-select-item\.current\s*\{/);
    expect(elsewhere).not.toMatch(/\.custom-select-item:hover\s*\{/);
    expect(elsewhere).not.toMatch(/\.custom-select-item:focus-visible\s*\{/);
  });

  it("keeps the desktop renderer off the native select popup", () => {
    const offenders = walk(rendererRoot).filter((path) =>
      /<select[\s>]/.test(withoutComments(readFileSync(path, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });
});
