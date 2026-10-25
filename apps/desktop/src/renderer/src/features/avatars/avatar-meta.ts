/**
 * Avatar metadata (UI-only, never persisted).
 *
 * Minimal geometric shapes plus a theme-aware black/white bot.
 */
import { MINIMAL_COLORS, MINIMAL_SHAPES } from "./avatar-minimal.js";

/** UI accent color derived from the avatar itself. */
export function avatarColor(avatar: Avatar): string {
  switch (avatar.kind) {
    case "mono":
      return "var(--avatar-mono-bg)";
    case "minimal":
      return avatar.color;
  }
}

/** UI-only avatar value; NOT a contract field, never persisted. */
export type Avatar =
  | { kind: "mono"; shape: number }
  | { kind: "minimal"; shape: number; color: string };

/** Stable default mapping: same bot id → same geometric avatar. */
export function defaultAvatarFor(seed: string): Avatar {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return {
    kind: "minimal",
    shape: hash % MINIMAL_SHAPES.length,
    color: MINIMAL_COLORS[hash % MINIMAL_COLORS.length]!,
  };
}

export function avatarKey(avatar: Avatar): string {
  switch (avatar.kind) {
    case "mono":
      return `mono:${avatar.shape}`;
    case "minimal":
      return `minimal:${avatar.shape}:${avatar.color}`;
  }
}
