/**
 * Regression guard for the D22 bilingual sweep.
 *
 * Any Chinese UI copy that reaches `apps/desktop/src` outside the message
 * catalogues is untranslated: it would render as Chinese in the English UI and
 * could never be switched. The scan mirrors what the sweep walked — string
 * literals, template expressions, `+` chains and JSX text runs — and fails on a
 * leftover. Data that must stay Chinese is marked with an `i18n-ignore` comment.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { MESSAGE_KEYS } from "../src/shared/i18n/messages/index.js";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");

const SRC = join(__dirname, "../src");
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // The catalogues are the translation source; they are meant to be Chinese.
      if (full.split(sep).join("/").includes("shared/i18n")) {
        continue;
      }
      sourceFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC).sort();
expect(FILES.length).toBeGreaterThan(20);

function nonDisplay(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  switch (parent.kind) {
    case ts.SyntaxKind.UnionType:
    case ts.SyntaxKind.LiteralType:
    case ts.SyntaxKind.EnumMember:
    case ts.SyntaxKind.TypeAliasDeclaration:
    case ts.SyntaxKind.PropertySignature:
    case ts.SyntaxKind.ImportDeclaration:
      return true;
    case ts.SyntaxKind.PropertyAssignment:
      return (parent as ts.PropertyAssignment).name === node;
    default:
      return false;
  }
}

function scan(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true);
  const lines = text.split("\n");
  const found: string[] = [];
  const lineIgnored = (position: number): boolean => {
    const index = sf.getLineAndCharacterOfPosition(position).line;
    return /i18n-ignore/.test(lines[index] ?? "") || /i18n-ignore/.test(lines[index - 1] ?? "");
  };
  const report = (position: number, value: string): void => {
    if (lineIgnored(position)) {
      return;
    }
    const { line } = sf.getLineAndCharacterOfPosition(position);
    found.push(`${file.replace(SRC, "src").split(sep).join("/")}:${line + 1}  ${value}`);
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      CJK.test(node.text) &&
      !nonDisplay(node)
    ) {
      report(node.getStart(sf), node.text);
    }
    if (ts.isTemplateExpression(node) && CJK.test(text.slice(node.getStart(sf), node.end))) {
      report(node.getStart(sf), text.slice(node.getStart(sf), node.end).replace(/\s+/g, " "));
    }
    if (ts.isJsxText(node) && CJK.test(node.text)) {
      report(node.getStart(sf), node.text.trim());
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

describe("D22 bilingual regression guard", () => {
  it("scans the desktop sources", () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it("leaves no untranslated Chinese UI copy in apps/desktop/src", () => {
    const leftovers = FILES.flatMap(scan);
    expect(leftovers).toEqual([]);
  });

  it("has a message catalogue for every domain the UI imports", () => {
    // Every t("x.y") / tr("x.y") key in the sources must exist in the catalogue.
    const keys = new Set<string>(MESSAGE_KEYS);
    const missing = new Set<string>();
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\b(?:t|tr)\(\s*"([^"]+)"/g)) {
        if (!keys.has(match[1])) {
          missing.add(`${match[1]} (${file.replace(SRC, "src")})`);
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
