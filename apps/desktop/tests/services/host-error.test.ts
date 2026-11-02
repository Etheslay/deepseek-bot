import { describe, expect, it } from "vitest";
import { hostErrorCode, isHostDownError } from "../../src/renderer/src/services/host-error.js";

describe("host error mapping", () => {
  it("keeps RUNTIME_UNAVAILABLE when the bridge only preserved the error name", () => {
    const error = new Error("host process has exited");
    error.name = "RUNTIME_UNAVAILABLE";
    expect(hostErrorCode(error)).toBe("RUNTIME_UNAVAILABLE");
    expect(isHostDownError(error)).toBe(true);
  });

  it("does not treat a validation failure or an unrelated message as the host being down", () => {
    const invalid = new Error("name is too short");
    invalid.name = "INVALID_INPUT";
    expect(isHostDownError(invalid)).toBe(false);
    expect(isHostDownError(new Error("secret-host"))).toBe(false);
  });
});
