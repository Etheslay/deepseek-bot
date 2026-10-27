import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_IMPORT_MAX_BYTES,
  KNOWLEDGE_IMPORT_MAX_CHARS,
  importKnowledgeText,
} from "../../src/shared/knowledge-import.js";

const encoder = new TextEncoder();

/**
 * The shared module takes the fallback title from its caller: it is imported by
 * the main process too, so it cannot read the renderer's language store (D22).
 * A sentinel proves the value is injected rather than baked in.
 */
const FALLBACK = "<unnamed-title>";

describe("knowledge file import", () => {
  it("accepts a trimmed txt or md note and derives the document title", () => {
    expect(
      importKnowledgeText("Notes.MD", encoder.encode("  Private note  "), FALLBACK),
    ).toEqual({
      ok: true,
      title: "Notes",
      text: "Private note",
    });
    expect(importKnowledgeText("notes.txt", encoder.encode("﻿alpha"), FALLBACK)).toEqual({
      ok: true,
      title: "notes",
      text: "alpha",
    });
    for (const name of ["notes.pdf", "notes.markdown", "notes.txt.exe", "notes", "notes.md.bin"]) {
      expect(importKnowledgeText(name, encoder.encode("alpha"), FALLBACK).ok).toBe(false);
      expect(importKnowledgeText(name, encoder.encode("alpha"), FALLBACK)).toEqual({
        ok: false,
        code: "format",
      });
    }
    // A file named only ".txt" still imports under the caller's fallback title.
    expect(importKnowledgeText(".txt", encoder.encode("alpha"), FALLBACK)).toEqual({
      ok: true,
      title: FALLBACK,
      text: "alpha",
    });
  });

  it("rejects an empty file, a file over 256 KiB, text over the contract limit, and invalid UTF-8", () => {
    expect(importKnowledgeText("empty.txt", encoder.encode("  \n"), FALLBACK)).toEqual({
      ok: false,
      code: "empty",
    });
    expect(
      importKnowledgeText(
        "fit.txt",
        encoder.encode("a".repeat(KNOWLEDGE_IMPORT_MAX_CHARS)),
        FALLBACK,
      ),
    ).toEqual({
      ok: true,
      title: "fit",
      text: "a".repeat(KNOWLEDGE_IMPORT_MAX_CHARS),
    });
    expect(
      importKnowledgeText(
        "long.txt",
        encoder.encode("a".repeat(KNOWLEDGE_IMPORT_MAX_CHARS + 1)),
        FALLBACK,
      ),
    ).toEqual({ ok: false, code: "size" });
    const tooBig = new Uint8Array(KNOWLEDGE_IMPORT_MAX_BYTES + 1);
    tooBig.fill(97);
    expect(importKnowledgeText("big.txt", tooBig, FALLBACK)).toEqual({ ok: false, code: "size" });
    expect(importKnowledgeText("bad.txt", Uint8Array.of(0xff), FALLBACK)).toEqual({
      ok: false,
      code: "encoding",
    });
  });
});
