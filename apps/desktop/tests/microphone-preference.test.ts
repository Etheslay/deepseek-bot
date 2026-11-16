import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureMicrophonePreference,
  readMicrophoneEnabled,
  setMicrophoneEnabled,
} from "../src/main/microphone-preference.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function directory(): string {
  const root = mkdtempSync(join(tmpdir(), "dsb-mic-"));
  roots.push(root);
  configureMicrophonePreference(root);
  return root;
}

describe("microphone preference", () => {
  it("stays on until the switch is turned off, and the file survives a fresh read", () => {
    const root = directory();
    expect(readMicrophoneEnabled()).toBe(true);
    expect(setMicrophoneEnabled(false)).toEqual({ enabled: false });
    expect(readMicrophoneEnabled()).toBe(false);
    configureMicrophonePreference(root);
    expect(readMicrophoneEnabled()).toBe(false);
    expect(setMicrophoneEnabled(true)).toEqual({ enabled: true });
    configureMicrophonePreference(root);
    expect(readMicrophoneEnabled()).toBe(true);
  });

  it("treats a broken file as on", () => {
    const root = directory();
    writeFileSync(join(root, "microphone.json"), "{", "utf8");
    configureMicrophonePreference(root);
    expect(readMicrophoneEnabled()).toBe(true);
  });
});
