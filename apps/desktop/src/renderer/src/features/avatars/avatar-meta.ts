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
