import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PINNED_DSH_VERSION, resolveDshSpec } from "./launch.js";

describe("resolveDshSpec", () => {
  it("resolves the installed pinned runtime and asserts its manifest version", () => {
    const spec = resolveDshSpec();
    expect(spec.version).toBe(PINNED_DSH_VERSION);
    expect(spec.dshBin.toLowerCase().endsWith("bin.js")).toBe(true);
    expect(existsSync(spec.dshBin)).toBe(true);
  });

  it("refuses a runtime whose manifest version drifts from the pin", () => {
    expect(() => resolveDshSpec("9.9.9")).toThrow("pinned for this adapter");
  });
});
