import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { placeCustomSelectMenu } from "../../src/renderer/src/components/custom-select.js";

const css = readFileSync(join(process.cwd(), "src/renderer/src/styles.css"), "utf8");

describe("settings dropdown right edge", () => {
  it("pins the closed settings-row control to the end of its min-width box", () => {
    const rule = css.slice(
      css.indexOf(".settings-row .custom-select {"),
      css.indexOf(".settings-row .custom-select-trigger"),
    );
    expect(rule).toContain("justify-content: flex-end");
    expect(rule).toContain("display: flex");
  });

  it("keeps an open settings menu on the trigger's right edge even left of center", () => {
    const placed = placeCustomSelectMenu(
      { left: 200, right: 280, bottom: 400, width: 80 },
      1200,
      true,
    );
    expect(placed.left).toBe("auto");
    expect(placed.right).toBe(1200 - 280);
    expect(placed.minWidth).toBe(80);
  });

  it("still grows a left-half menu rightward outside settings rows", () => {
    const placed = placeCustomSelectMenu(
      { left: 40, right: 160, bottom: 80, width: 120 },
      1000,
      false,
    );
    expect(placed.left).toBe(40);
    expect(placed.right).toBe("auto");
  });
});
