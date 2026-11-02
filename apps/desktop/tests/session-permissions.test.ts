import { describe, expect, it } from "vitest";
import { rendererPermissionAllowed } from "../src/main/session-permissions.js";

describe("rendererPermissionAllowed", () => {
  it("allows clipboard write and microphone audio only", () => {
    expect(rendererPermissionAllowed("clipboard-sanitized-write")).toBe(true);
    expect(rendererPermissionAllowed("media", { mediaType: "audio" })).toBe(true);
    expect(rendererPermissionAllowed("media", { mediaTypes: ["audio"] })).toBe(true);
  });

  it("denies camera, mixed capture, and every other permission", () => {
    expect(rendererPermissionAllowed("media", { mediaType: "video" })).toBe(false);
    expect(rendererPermissionAllowed("media", { mediaType: "unknown" })).toBe(false);
    expect(rendererPermissionAllowed("media", { mediaTypes: ["video"] })).toBe(false);
    expect(rendererPermissionAllowed("media", { mediaTypes: ["audio", "video"] })).toBe(false);
    expect(rendererPermissionAllowed("media", { mediaTypes: [] })).toBe(false);
    expect(rendererPermissionAllowed("media")).toBe(false);
    for (const permission of [
      "clipboard-read",
      "notifications",
      "geolocation",
      "display-capture",
      "mediaKeySystem",
      "openExternal",
    ]) {
      expect(rendererPermissionAllowed(permission)).toBe(false);
      expect(rendererPermissionAllowed(permission, { mediaType: "audio" })).toBe(false);
    }
  });
});
