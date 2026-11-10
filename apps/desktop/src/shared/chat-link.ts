/**
 * Links inside a chat reply. Web and mail links open outside the app.
 * A file link opens only when the file really sits in the bot workspace;
 * the app window never navigates to it.
 */

export type ChatLink =
  | { kind: "web"; href: string }
  | { kind: "mail"; href: string }
  | { kind: "file"; path: string };

export type ChatLinkOpenResult =
  | { ok: true }
  | { ok: false; reason: "blocked" | "missing" | "outside" };

const CONTROL = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
);

function fileUrlPath(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") {
    return null;
  }
  if (url.hostname !== "" && url.hostname !== "localhost") {
    return null;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (/^\/[A-Za-z]:\//.test(pathname)) {
    pathname = pathname.slice(1);
  }
  if (pathname.length === 0 || CONTROL.test(pathname)) {
    return null;
  }
  return pathname;
}

function isFileLike(href: string): boolean {
  if (href.startsWith("./") || href.startsWith("../") || href.startsWith(".\\") || href.startsWith("..\\")) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(href) || href.startsWith("\\\\")) {
    return true;
  }
  if (href.startsWith("/") || href.startsWith("\\")) {
    return true;
  }
  if (href.includes("/") || href.includes("\\")) {
    return true;
  }
  return /\.[A-Za-z0-9]{1,8}$/.test(href);
}

/** What a markdown href is allowed to become. Anything else is plain text. */
export function classifyChatLink(rawHref: string): ChatLink | null {
  const href = rawHref.trim();
  if (href.length === 0 || href.length > 2048 || CONTROL.test(href)) {
    return null;
  }
  if (/^(?:javascript|data|vbscript):/i.test(href)) {
    return null;
  }
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }
      if (url.username !== "" || url.password !== "") {
        return null;
      }
      return { kind: "web", href };
    } catch {
      return null;
    }
  }
  if (/^mailto:/i.test(href)) {
    try {
      const url = new URL(href);
      if (url.protocol !== "mailto:") {
        return null;
      }
      return { kind: "mail", href };
    } catch {
      return null;
    }
  }
  if (/^file:/i.test(href)) {
    const path = fileUrlPath(href);
    return path === null ? null : { kind: "file", path };
  }
  if (href.startsWith("//") || href.includes("://")) {
    return null;
  }
  if (!isFileLike(href)) {
    return null;
  }
  return { kind: "file", path: href };
}

/** Href written into the sanitized chat HTML. File targets use an app scheme. */
export function encodeChatLinkHref(link: ChatLink): string {
  if (link.kind === "file") {
    return `app-file:${encodeURIComponent(link.path)}`;
  }
  return link.href;
}

/** Read back the href a chat anchor actually carries. */
export function parseChatLinkHref(rawHref: string): ChatLink | null {
  const href = rawHref.trim();
  if (href.startsWith("app-file:")) {
    let path: string;
    try {
      path = decodeURIComponent(href.slice("app-file:".length));
    } catch {
      return null;
    }
    if (path.length === 0 || path.length > 2048 || CONTROL.test(path)) {
      return null;
    }
    if (path.includes("://") || /^(?:javascript|data|vbscript):/i.test(path)) {
      return null;
    }
    return { kind: "file", path };
  }
  const classified = classifyChatLink(href);
  if (classified === null || classified.kind === "file") {
    return null;
  }
  return classified;
}

export type WorkspaceFileIo = {
  /** Real path after resolving symlinks, or null when the path does not exist. */
  realpath: (path: string) => string | null;
  kind: (path: string) => "file" | "other";
};

function isOutside(root: string, file: string): boolean {
  const rel = relativePath(root, file);
  return rel === "" || rel === ".." || rel.startsWith(`..${sepOf(root)}`) || isRooted(rel);
}

function sepOf(value: string): string {
  return value.includes("\\") && !value.includes("/") ? "\\" : "/";
}

function isRooted(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value);
}

/** Join with the separator the root already uses, without Node's platform path. */
function samePart(root: string, left: string, right: string): boolean {
  if (/^[A-Za-z]:/.test(root)) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

function relativePath(root: string, file: string): string {
  const sep = sepOf(root);
  const rootParts = root.split(/[\\/]/).filter((part) => part.length > 0);
  const fileParts = file.split(/[\\/]/).filter((part) => part.length > 0);
  if (rootParts.length === 0 || fileParts.length < rootParts.length) {
    return file;
  }
  for (let i = 0; i < rootParts.length; i += 1) {
    const rootPart = rootParts[i];
    const filePart = fileParts[i];
    if (rootPart === undefined || filePart === undefined || !samePart(root, rootPart, filePart)) {
      return file;
    }
  }
  return fileParts.slice(rootParts.length).join(sep);
}

function joinRoot(root: string, linkPath: string): string {
  const sep = sepOf(root);
  const base = root.replace(/[\\/]+$/, "");
  const rest = linkPath.replace(/^[\\/]+/, "").replace(/[\\/]/g, sep);
  return `${base}${sep}${rest}`;
}

/**
 * The file a workspace link may open. Absolute targets must already live
 * under the workspace; relative targets are resolved from its root.
 * Symlinks are judged by the caller's real path.
 */
export function resolveWorkspaceFile(
  workspaceRoot: string,
  linkPath: string,
  io: WorkspaceFileIo,
): string | "missing" | "outside" {
  const root = io.realpath(workspaceRoot);
  if (root === null) {
    return "missing";
  }
  const absolute = isRooted(linkPath) ? linkPath : joinRoot(root, linkPath);
  const file = io.realpath(absolute);
  if (file === null) {
    return "missing";
  }
  if (isOutside(root, file)) {
    return "outside";
  }
  if (io.kind(file) !== "file") {
    return "outside";
  }
  return file;
}
