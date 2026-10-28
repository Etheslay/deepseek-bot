import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { placeCustomSelectMenu } from "../../src/renderer/src/components/custom-select.js";
import { shellMessages } from "../../src/shared/i18n/messages/shell.js";

const css = readFileSync(join(process.cwd(), "src/renderer/src/styles.css"), "utf8");

describe("appearance theme label", () => {
  it("uses 深 色 for the row label and leaves the option words unspaced", () => {
    expect(shellMessages["shell.theme"].zh).toBe("深 色");
    expect(shellMessages["shell.themeDark"].zh).toBe("深色");
    expect(shellMessages["shell.themeLight"].zh).toBe("浅色");
  });

  it("keeps a clear gap between the label and the chevron on every trigger", () => {
    const rule = css.slice(css.indexOf(".custom-select-trigger {"), css.indexOf(".custom-select-trigger:hover"));
    expect(rule).toMatch(/gap:\s*1rem;/);
    expect(rule).toContain("justify-content: space-between");
  });

  it("keeps that label outside a full-width theme pill", () => {
    const app = readFileSync(join(process.cwd(), "src/renderer/src/App.tsx"), "utf8");
    expect(app).toContain('className="appearance-theme-label">{t("shell.theme")}');
    expect(app).toContain('className="theme-select"');
    expect(css).toMatch(/\.settings-row \.custom-select\.theme-select \.custom-select-trigger\s*\{[^}]*width:\s*100%;/);
  });
});

describe("settings dropdown right edge", () => {
  it("pulls the appearance card's right edge in by 12px", () => {
    expect(css).toMatch(/\.settings-card\.appearance-card\s*\{[^}]*padding-right:\s*calc\(1rem - 12px\);/);
  });

  it("pulls the appearance dropdowns onto the card's right edge", () => {
    expect(css).toMatch(
      /\.appearance-card \.settings-row \.custom-select\s*\{[^}]*margin-right:\s*calc\(-0\.2rem - \(1rem - 12px\)\);/,
    );
  });

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
