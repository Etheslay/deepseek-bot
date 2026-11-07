import { describe, expect, it } from "vitest";
import { avatarFileKind, isAccountAvatarDataUrl } from "../../src/shared/account-avatar.js";
import { accountImageAvatar } from "../../src/renderer/src/features/avatars/avatar-meta.js";

describe("account avatar pictures", () => {
  it("recognises the picture formats the picker accepts", () => {
    expect(avatarFileKind(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0))).toBe("png");
    expect(avatarFileKind(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe("jpeg");
    expect(avatarFileKind(Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0))).toBe("gif");
    const webp = Uint8Array.of(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
    expect(avatarFileKind(webp)).toBe("webp");
    expect(avatarFileKind(Uint8Array.of(0x3c, 0x73, 0x76, 0x67))).toBeNull();
  });

  it("accepts only a short jpeg data URL", () => {
    expect(isAccountAvatarDataUrl("data:image/jpeg;base64,AAAA")).toBe(true);
    expect(accountImageAvatar("data:image/jpeg;base64,AAAA")).toEqual({
      kind: "image",
      dataUrl: "data:image/jpeg;base64,AAAA",
    });
    expect(accountImageAvatar("data:image/svg+xml;base64,PHN2Zy8+")).toBeNull();
    expect(accountImageAvatar("javascript:alert(1)")).toBeNull();
  });
});
