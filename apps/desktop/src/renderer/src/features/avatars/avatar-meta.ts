/**
 * Avatar metadata (UI-only, never persisted).
 *
 * The Grok Ball shape set plus the theme-aware black/white bot.
 */
import {
  GROK_BALL_COLORS,
  GROK_BALL_SHAPE_IDS,
  type GrokBallShapeId,
  type GrokBallState,
} from "./grok-ball-model.js";

/** UI accent color derived from the avatar itself. */
export function avatarColor(avatar: Avatar): string {
  switch (avatar.kind) {
    case "mono":
      return "var(--avatar-mono-bg)";
    case "grok":
      return avatar.color === "mono" ? "var(--avatar-mono-bg)" : avatar.color;
  }
}

/** UI-only avatar value; NOT a contract field, never persisted. */
export type Avatar =
  | { kind: "mono" }
  | {
      kind: "grok";
      shape: GrokBallShapeId;
      color: string;
      state?: GrokBallState;
    };

/** Stable default mapping: same bot id → same Grok Ball avatar. */
export function defaultAvatarFor(seed: string): Avatar {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return {
    kind: "grok",
    shape: GROK_BALL_SHAPE_IDS[hash % GROK_BALL_SHAPE_IDS.length]!,
    color: GROK_BALL_COLORS[hash % GROK_BALL_COLORS.length]!,
  };
}

export function avatarKey(avatar: Avatar): string {
  switch (avatar.kind) {
    case "mono":
      return "mono";
    case "grok":
      return `grok:${avatar.shape}:${avatar.color}:${avatar.state ?? "idle"}`;
  }
}

/** Readable text ink for a bubble painted with the exact bot colour. */
export function bubbleInk(color: string): string {
  if (color.includes("--avatar-mono-bg")) {
    return "var(--avatar-mono-fg)";
  }
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (m === null) {
    return "var(--text)";
  }
  const n = Number.parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "#15151a" : "#ffffff";
}
