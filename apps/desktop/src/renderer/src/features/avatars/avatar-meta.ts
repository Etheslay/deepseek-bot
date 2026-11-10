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
  toneKeyFor,
  type GrokBallShapeId,
  type GrokBallState,
} from "./grok-ball-model.js";
import { isAccountAvatarDataUrl } from "../../../../shared/account-avatar.js";

const CONTRACT_SHAPES = new Set<string>([...AVATAR_SHAPES, ...AVATAR_SHAPE_IDS_RETIRED]);
const CONTRACT_COLORS = new Set<string>([...AVATAR_COLORS, ...AVATAR_COLORS_RETIRED]);

/** UI accent color derived from the avatar itself. */
export function avatarColor(avatar: Avatar): string {
  switch (avatar.kind) {
    case "mono":
      return "var(--avatar-mono-bg)";
    case "grok": {
      if (avatar.color === "mono") return "var(--avatar-mono-bg)";
      const tone = toneKeyFor(avatar.color);
      // Palette bots follow the theme paint, so a saved deep or retired hex
      // still shows the brighter body. Anything else stays the stored colour.
      return tone === null ? avatar.color : `var(--gb-body-${tone})`;
    }
    case "image":
      return "var(--avatar-mono-bg)";
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
    }
  | { kind: "image"; dataUrl: string };

/** A local account photo, or null when the data URL is not a small JPEG. */
export function accountImageAvatar(dataUrl: string): Avatar | null {
  if (!isAccountAvatarDataUrl(dataUrl)) return null;
  return { kind: "image", dataUrl };
}

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
    case "image":
      return `image:${avatar.dataUrl.length}:${avatar.dataUrl.slice(-24)}`;
  }
}

/**
 * User-bubble type against a fill painted with the bot colour.
 *
 * Coloured bots keep the theme default: white type on a dark theme, black
 * type on a light theme. The mono body is that same colour — white on dark,
 * black on light — so its type has to flip or the sentence disappears.
 */
export function userBubbleInk(avatar: Avatar): "theme" | "mono" {
  return avatarColor(avatar).includes("--avatar-mono-bg") ? "mono" : "theme";
}

/** Readable text ink for a bubble painted with the exact bot colour. */
export function bubbleInk(color: string): string {
  if (color.includes("--avatar-mono-bg")) {
    return "var(--avatar-mono-fg)";
  }
  const tone = /^var\(--gb-body-([a-z]+)\)$/.exec(color.trim());
  if (tone !== null) {
    return `var(--gb-ink-${tone[1]})`;
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
