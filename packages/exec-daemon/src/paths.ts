import path from "node:path";

/** True when `candidate` is `root` or a path that stays inside it. */
export function isInsideDirectory(root: string, candidate: string): boolean {
  const left = process.platform === "win32" ? root.toLowerCase() : root;
  const right = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const relative = path.relative(left, right);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
