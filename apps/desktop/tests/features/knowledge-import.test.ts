import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_IMPORT_MAX_BYTES,
  KNOWLEDGE_IMPORT_MAX_CHARS,
  importKnowledgeText,
} from "../../src/shared/knowledge-import.js";

const encoder = new TextEncoder();

describe("knowledge file import", () => {
  it("accepts a trimmed txt or md note and rejects other formats", () => {
    expect(importKnowledgeText("Notes.MD", encoder.encode("  Private note  "))).toEqual({
      ok: true,
      text: "Private note",
    });
    expect(importKnowledgeText("notes.txt", encoder.encode("\uFEFFalpha"))).toEqual({
      ok: true,
      text: "alpha",
    });
    for (const name of ["notes.pdf", "notes.markdown", "notes.txt.exe", "notes", "notes.md.bin"]) {
      expect(importKnowledgeText(name, encoder.encode("alpha")).ok).toBe(false);
      expect(importKnowledgeText(name, encoder.encode("alpha"))).toEqual({ ok: false, code: "format" });
    }
  });

  it("rejects an empty file, a file over 16 KiB, text over 4000 characters, and invalid UTF-8", () => {
    expect(importKnowledgeText("empty.txt", encoder.encode("  \n"))).toEqual({ ok: false, code: "empty" });
    expect(importKnowledgeText("fit.txt", encoder.encode("a".repeat(KNOWLEDGE_IMPORT_MAX_CHARS)))).toEqual({
      ok: true,
      text: "a".repeat(KNOWLEDGE_IMPORT_MAX_CHARS),
    });
    expect(importKnowledgeText("long.txt", encoder.encode("a".repeat(KNOWLEDGE_IMPORT_MAX_CHARS + 1)))).toEqual({
      ok: false,
      code: "size",
    });
    const tooBig = new Uint8Array(KNOWLEDGE_IMPORT_MAX_BYTES + 1);
    tooBig.fill(97);
    expect(importKnowledgeText("big.txt", tooBig)).toEqual({ ok: false, code: "size" });
    expect(importKnowledgeText("bad.txt", Uint8Array.of(0xff))).toEqual({ ok: false, code: "encoding" });
  });
});
