/**
 * Avatar metadata.
 *
 * The Grok Ball shape set plus the theme-aware black/white bot. A coloured
 * ball maps onto the contract avatar (shape + canonical colour) so an edit
 * survives a restart. The mono ball has no contract value; the bot list
 * keeps that choice locally.
 */
import {
  AVATAR_COLORS,
  AVATAR_COLORS_RETIRED,
  AVATAR_SHAPE_IDS_RETIRED,
  AVATAR_SHAPES,
  type Avatar as ContractAvatar,
} from "@deepseek-bot/contracts";
import {
  GROK_BALL_COLORS,
  GROK_BALL_SHAPE_IDS,
  type GrokBallShapeId,
  type GrokBallState,
} from "./grok-ball-model.js";

const CONTRACT_SHAPES = new Set<string>([...AVATAR_SHAPES, ...AVATAR_SHAPE_IDS_RETIRED]);
const CONTRACT_COLORS = new Set<string>([...AVATAR_COLORS, ...AVATAR_COLORS_RETIRED]);

/** UI accent color derived from the avatar itself. */
export function avatarColor(avatar: Avatar): string {
  switch (avatar.kind) {
    case "mono":
      return "var(--avatar-mono-bg)";
    case "grok":
      return avatar.color === "mono" ? "var(--avatar-mono-bg)" : avatar.color;
  }
}

/** Picker value. Coloured balls persist as a contract avatar; mono stays local. */
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

/** Contract avatar for a coloured ball, or null for mono / an unknown swatch. */
export function toContractAvatar(avatar: Avatar): ContractAvatar | null {
  if (avatar.kind !== "grok") return null;
  if (!CONTRACT_SHAPES.has(avatar.shape) || !CONTRACT_COLORS.has(avatar.color)) return null;
  return {
    shape: avatar.shape as ContractAvatar["shape"],
    color: avatar.color as ContractAvatar["color"],
  };
}

/** UI ball for a stored contract avatar. Null means the bot has none. */
export function fromContractAvatar(
  avatar: ContractAvatar | null | undefined,
): Avatar | null {
  if (avatar === null || avatar === undefined) return null;
  return { kind: "grok", shape: avatar.shape, color: avatar.color };
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
