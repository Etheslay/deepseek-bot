import { describe, expect, it } from "vitest";
import {
  classifyChatLink,
  encodeChatLinkHref,
  parseChatLinkHref,
  resolveWorkspaceFile,
  type WorkspaceFileIo,
} from "../../src/shared/chat-link.js";

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function io(root: string, files: ReadonlyMap<string, "file" | "other">): WorkspaceFileIo {
  const known = new Map<string, "file" | "other">(files);
  known.set(normalize(root), "other");
  return {
    realpath: (path) => {
      const abs = normalize(path);
      return known.has(abs) ? abs : null;
    },
    kind: (path) => known.get(normalize(path)) ?? "other",
  };
}

describe("chat links", () => {
  it("keeps http and mailto, and turns a file name into an app link", () => {
    expect(classifyChatLink("https://api.deepseek.com")).toEqual({
      kind: "web",
      href: "https://api.deepseek.com",
    });
    expect(classifyChatLink("mailto:a@b.c")).toEqual({ kind: "mail", href: "mailto:a@b.c" });
    expect(classifyChatLink("javascript:alert(1)")).toBeNull();
    const file = classifyChatLink("下载PPT.html");
    expect(file).toEqual({ kind: "file", path: "下载PPT.html" });
    expect(file === null ? "" : encodeChatLinkHref(file)).toBe("app-file:%E4%B8%8B%E8%BD%BDPPT.html");
    expect(parseChatLinkHref("app-file:%E4%B8%8B%E8%BD%BDPPT.html")).toEqual({
      kind: "file",
      path: "下载PPT.html",
    });
  });

  it("reads a file url back as the path the workspace check will see", () => {
    expect(classifyChatLink("file:///C:/Users/me/DeepSeekBot/workspace/%E4%B8%8B%E8%BD%BDPPT.html")).toEqual({
      kind: "file",
      path: "C:/Users/me/DeepSeekBot/workspace/下载PPT.html",
    });
  });

  it("opens a file inside the workspace and refuses one outside it", () => {
    const root = "/data/workspace";
    const files = io(
      root,
      new Map([
        ["/data/workspace/下载PPT.html", "file"],
        ["/etc/passwd", "file"],
      ]),
    );
    expect(resolveWorkspaceFile(root, "下载PPT.html", files)).toBe("/data/workspace/下载PPT.html");
    expect(resolveWorkspaceFile(root, "/etc/passwd", files)).toBe("outside");
    expect(resolveWorkspaceFile(root, "../passwd", files)).toBe("missing");
    expect(resolveWorkspaceFile(root, "missing.html", files)).toBe("missing");
  });

  it("treats a symlink that leaves the workspace as outside", () => {
    const root = "/data/workspace";
    const files = io(root, new Map([["/data/workspace", "other"]]));
    const linked: WorkspaceFileIo = {
      realpath: (path) => (normalize(path) === "/data/workspace/alias.html" ? "/etc/passwd" : files.realpath(path)),
      kind: (path) => (path === "/etc/passwd" ? "file" : files.kind(path)),
    };
    expect(resolveWorkspaceFile(root, "alias.html", linked)).toBe("outside");
  });
});
