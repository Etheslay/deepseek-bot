/**
 * Avatar metadata (D05 UI brief §2): 16 preset animal face SVGs plus the
 * DeepSeek dolphin brand logo.
 *
 * Provenance (2026-10-24): the animal faces in apps/desktop/assets/avatars are
 * OpenMoji color SVGs (https://github.com/hfg-gmuend/openmoji, CC BY-SA 4.0),
 * chosen because they are transparent, round, and need no cropping. Attribution
 * is in docs/THIRD_PARTY_NOTICES.md. dolphin.png is the brand mark and is
 * unchanged.
 */

export type PresetId =
  | "mouse"
  | "dog"
  | "bear"
  | "cat"
  | "frog"
  | "cow"
  | "pig"
  | "chicken"
  | "fox"
  | "lion"
  | "panda"
  | "koala"
  | "monkey"
  | "rabbit"
  | "hamster"
  | "tiger";

export type PresetAvatarMeta = { id: PresetId; name: string };

/** Order matches the brief's 4×4 grid table. */
export const PRESET_AVATARS: readonly PresetAvatarMeta[] = [
  { id: "mouse", name: "小老鼠" },
  { id: "dog", name: "小狗" },
  { id: "bear", name: "小熊" },
  { id: "cat", name: "小猫" },
  { id: "frog", name: "小青蛙" },
  { id: "cow", name: "小牛" },
  { id: "pig", name: "小猪" },
  { id: "chicken", name: "小鸡" },
  { id: "fox", name: "小狐狸" },
  { id: "lion", name: "小狮子" },
  { id: "panda", name: "小熊猫" },
  { id: "koala", name: "小考拉" },
  { id: "monkey", name: "小猴子" },
  { id: "rabbit", name: "小兔子" },
  { id: "hamster", name: "小仓鼠" },
  { id: "tiger", name: "小老虎" },
] as const;

export const PRESET_IDS: readonly PresetId[] = PRESET_AVATARS.map((a) => a.id);

/** Signature UI color per preset: speaker labels and accents follow the animal's own palette. */
export const PRESET_COLORS: Record<PresetId, string> = {
  mouse: "#94a3b8",
  dog: "#c2410c",
  bear: "#a16207",
  cat: "#fb923c",
  frog: "#4ade80",
  cow: "#d6d3d1",
  pig: "#ec4899",
  chicken: "#fbbf24",
  fox: "#f97316",
  lion: "#eab308",
  panda: "#f5f5f4",
  koala: "#94a3b8",
  monkey: "#a16207",
  rabbit: "#f9a8d4",
  hamster: "#fbbf24",
  tiger: "#f97316",
};

const EMOJI_NAME_COLORS = [
  "#fb923c",
  "#4ade80",
  "#3b82f6",
  "#ec4899",
  "#c084fc",
  "#14b8a6",
  "#eab308",
  "#38bdf8",
] as const;

const IMAGE_FALLBACK_COLOR = "#94a3b8";
const LOGO_COLOR = "#4d6bfe";

/** UI accent color derived from the avatar itself, so labels always match the animal. */
export function avatarColor(avatar: Avatar): string {
  switch (avatar.kind) {
    case "mono":
      return "var(--avatar-mono-bg)";
    case "minimal":
      return avatar.color;
    case "preset":
      return PRESET_COLORS[avatar.preset];
    case "logo":
      return LOGO_COLOR;
    case "emoji": {
      let hash = 0;
      for (let i = 0; i < avatar.emoji.length; i++) {
        hash = (hash * 31 + avatar.emoji.charCodeAt(i)) >>> 0;
      }
      return EMOJI_NAME_COLORS[hash % EMOJI_NAME_COLORS.length]!;
    }
    case "image":
      return IMAGE_FALLBACK_COLOR;
  }
}

/** 40 curated emoji: 24 expressions + 16 animals (8 columns × 5 rows). */
export const EMOJI_AVATARS: { group: "expression" | "animal"; emoji: string; name: string }[] = [
  { group: "expression", emoji: "😀", name: "笑脸" },
  { group: "expression", emoji: "😄", name: "大笑" },
  { group: "expression", emoji: "😊", name: "害羞" },
  { group: "expression", emoji: "🤖", name: "机器人" },
  { group: "expression", emoji: "😎", name: "墨镜" },
  { group: "expression", emoji: "🤓", name: "书呆" },
  { group: "expression", emoji: "😇", name: "天使" },
  { group: "expression", emoji: "🥳", name: "庆祝" },
  { group: "expression", emoji: "😴", name: "睡着" },
  { group: "expression", emoji: "🤔", name: "思考" },
  { group: "expression", emoji: "😲", name: "惊讶" },
  { group: "expression", emoji: "🥺", name: "请求" },
  { group: "expression", emoji: "😤", name: "生气" },
  { group: "expression", emoji: "🤯", name: "爆炸" },
  { group: "expression", emoji: "🥰", name: "喜爱" },
  { group: "expression", emoji: "🤗", name: "拥抱" },
  { group: "expression", emoji: "😵‍💫", name: "晕" },
  { group: "expression", emoji: "🫠", name: "融化" },
  { group: "expression", emoji: "👻", name: "幽灵" },
  { group: "expression", emoji: "🎃", name: "南瓜" },
  { group: "expression", emoji: "🌟", name: "星星" },
  { group: "expression", emoji: "🔥", name: "火" },
  { group: "expression", emoji: "💧", name: "水滴" },
  { group: "expression", emoji: "🧠", name: "大脑" },
  { group: "animal", emoji: "🐶", name: "狗" },
  { group: "animal", emoji: "🐱", name: "猫" },
  { group: "animal", emoji: "🐭", name: "鼠" },
  { group: "animal", emoji: "🐹", name: "仓鼠" },
  { group: "animal", emoji: "🦊", name: "狐" },
  { group: "animal", emoji: "🐻", name: "熊" },
  { group: "animal", emoji: "🐼", name: "熊猫" },
  { group: "animal", emoji: "🐨", name: "考拉" },
  { group: "animal", emoji: "🐯", name: "虎" },
  { group: "animal", emoji: "🦁", name: "狮" },
  { group: "animal", emoji: "🐮", name: "牛" },
  { group: "animal", emoji: "🐷", name: "猪" },
  { group: "animal", emoji: "🐸", name: "蛙" },
  { group: "animal", emoji: "🐙", name: "章鱼" },
  { group: "animal", emoji: "🦈", name: "鲨鱼" },
  { group: "animal", emoji: "🐳", name: "鲸" },
];

/** UI-only avatar shape (brief §2.5); NOT a contract field, never persisted. */
export type Avatar =
  | { kind: "mono" }
  | { kind: "minimal"; shape: number; color: string }
  | { kind: "preset"; preset: PresetId }
  | { kind: "logo"; logo: "deepseek-dolphin" }
  | { kind: "emoji"; emoji: string }
  | { kind: "image"; dataUrl: string; alt?: string };

/** Stable default mapping: same bot id → same preset avatar. */
export function defaultAvatarFor(seed: string): Avatar {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return { kind: "preset", preset: PRESET_IDS[hash % PRESET_IDS.length]! };
}

export function avatarKey(avatar: Avatar): string {
  switch (avatar.kind) {
    case "mono":
      return "mono";
    case "minimal":
      return `minimal:${avatar.shape}:${avatar.color}`;
    case "preset":
      return `preset:${avatar.preset}`;
    case "logo":
      return "logo:deepseek-dolphin";
    case "emoji":
      return `emoji:${avatar.emoji}`;
    case "image":
      return `image:${avatar.dataUrl.length}`;
  }
}
