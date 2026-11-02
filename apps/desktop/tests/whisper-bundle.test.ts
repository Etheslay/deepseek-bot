import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWhisperBundleDirectory, whisperEnvFromBundles } from "../src/main/whisper-bundle.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function bundle(): string {
  const root = mkdtempSync(join(tmpdir(), "dsb-desktop-whisper-"));
  roots.push(root);
  writeFileSync(join(root, "whisper-cli.exe"), "bin");
  writeFileSync(join(root, "model.bin"), "model");
  writeFileSync(
    join(root, "bundle.json"),
    JSON.stringify({ binary: "whisper-cli.exe", model: "model.bin" }),
  );
  return root;
}

describe("whisperEnvFromBundles", () => {
  it("fills the host environment from the first bundle on disk", () => {
    const root = bundle();
    expect(whisperEnvFromBundles([join(root, "missing"), root], {})).toEqual({
      DEEPSEEK_BOT_WHISPER_BIN: join(root, "whisper-cli.exe"),
      DEEPSEEK_BOT_WHISPER_MODEL: join(root, "model.bin"),
    });
  });

  it("keeps an explicit parent path and skips a missing bundle", () => {
    const root = bundle();
    expect(
      whisperEnvFromBundles([root], {
        DEEPSEEK_BOT_WHISPER_BIN: "D:\\custom\\whisper-cli.exe",
      }),
    ).toEqual({
      DEEPSEEK_BOT_WHISPER_MODEL: join(root, "model.bin"),
    });
    expect(whisperEnvFromBundles([join(root, "nope")], {})).toEqual({});
  });

  it("does not follow a stamp that names a path", () => {
    const root = bundle();
    writeFileSync(
      join(root, "bundle.json"),
      JSON.stringify({ binary: "..\\whisper-cli.exe", model: "model.bin" }),
    );
    expect(readWhisperBundleDirectory(root)).toBeUndefined();
  });
});
