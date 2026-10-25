/** Minimal avatars: simple math shapes + two eyes (eyes track the cursor). */
export type MinimalShape = {
  id: string;
  radius?: string;
  clipPath?: string;
};

export const MINIMAL_SHAPES: MinimalShape[] = [
  { id: "circle", radius: "50%" },
  { id: "square", radius: "18%" },
  { id: "rounded", radius: "32%" },
  { id: "triangle", clipPath: "polygon(50% 0, 100% 100%, 0 100%)" },
  { id: "diamond", clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" },
  {
    id: "hexagon",
    clipPath: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)",
  },
  { id: "oval", radius: "50% / 38%" },
  {
    id: "star",
    clipPath:
      "polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
  },
];

export const MINIMAL_COLORS = [
  "#f4f4f5",
  "#a16207",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#6b7280",
];
