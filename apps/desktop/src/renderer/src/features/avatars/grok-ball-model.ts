/**
 * Pure geometry and state model for the Grok Ball avatar.
 *
 * The renderer keeps all animation in `grok-ball.tsx`; this module stays
 * deterministic so the projection, contour sampling and keyframe interpolation
 * can be unit tested without a DOM.
 */

export type GrokBallShapeId =
  | "circle"
  | "blob"
  | "pebble"
  | "bean"
  | "egg"
  | "squircle"
  | "capsule"
  | "hex"
  | "cloud"
  | "soft-diamond"
  | "droplet-tilt"
  | "pill-wave"
  | "moon-slice"
  | "petal"
  | "soft-triangle";

export type GrokBallState =
  | "idle"
  | "thinking"
  | "working"
  | "waiting"
  | "blocked"
  | "done";

export type Point = [number, number];

export type ShapeDefinition = {
  id: GrokBallShapeId;
  /** Silhouette control points in a 100×100 local space. */
  points: Point[];
  /** Vertical placement of the eye pair, relative to the shape center. */
  eyeY: number;
  /** Horizontal distance between eye centers. */
  eyeSpacing: number;
  /** Optional eye scale multiplier for narrow shapes. */
  eyeScale?: number;
};

const CENTER = 50;

function ring(
  count: number,
  radius: (index: number) => number,
  angleOffset = 0,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + angleOffset;
    const r = radius(i);
    points.push([
      CENTER + Math.cos(angle) * r,
      CENTER + Math.sin(angle) * r,
    ]);
  }
  return points;
}

function ellipseRing(
  count: number,
  rx: number,
  ry: number,
  rotation = 0,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const x = Math.cos(angle) * rx;
    const y = Math.sin(angle) * ry;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    points.push([
      CENTER + x * cos - y * sin,
      CENTER + x * sin + y * cos,
    ]);
  }
  return points;
}

function squirclePoints(): Point[] {
  const count = 20;
  const exponent = 4;
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const x = Math.sign(Math.cos(angle)) * Math.abs(Math.cos(angle)) ** (2 / exponent);
    const y = Math.sign(Math.sin(angle)) * Math.abs(Math.sin(angle)) ** (2 / exponent);
    points.push([
      CENTER + x * 43,
      CENTER + y * 43,
    ]);
  }
  return points;
}

function capsulePoints(): Point[] {
  const points: Point[] = [];
  const count = 24;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    const capX = x >= 0 ? 30 + x * 15 : -30 + x * 15;
    const capY = y * 25;
    points.push([CENTER + capX, CENTER + capY]);
  }
  return points;
}

function hexPoints(): Point[] {
  const points: Point[] = [];
  const count = 18;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count - Math.PI / 6;
    const radius = i % 3 === 0 ? 46 : 38;
    points.push([
      CENTER + Math.cos(angle) * radius,
      CENTER + Math.sin(angle) * radius,
    ]);
  }
  return points;
}

function rotatePoints(points: Point[], deg: number): Point[] {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return points.map(([x, y]) => {
    const dx = x - CENTER;
    const dy = y - CENTER;
    return [CENTER + dx * cos - dy * sin, CENTER + dx * sin + dy * cos];
  });
}

function superellipsePoints(
  exponent: number,
  size: number,
  count: number,
  rotationDeg = 0,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const x = Math.sign(Math.cos(angle)) * Math.abs(Math.cos(angle)) ** (2 / exponent);
    const y = Math.sign(Math.sin(angle)) * Math.abs(Math.sin(angle)) ** (2 / exponent);
    points.push([CENTER + x * size, CENTER + y * size]);
  }
  return rotationDeg ? rotatePoints(points, rotationDeg) : points;
}

/** Three-lobed petal body: an oval whose radius bulges three times around. */
function petalPoints(): Point[] {
  const points: Point[] = [];
  const count = 30;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const r = 40 + 7 * Math.cos(3 * (angle + Math.PI / 2));
    points.push([CENTER + Math.cos(angle) * r, CENTER + Math.sin(angle) * r]);
  }
  return points;
}

/** Blunt, super-rounded triangle (shield-like) with three soft vertices. */
function softTrianglePoints(): Point[] {
  const points: Point[] = [];
  const count = 36;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const r = 40 + 8 * Math.cos(3 * (angle + Math.PI / 2));
    points.push([CENTER + Math.cos(angle) * r * 1.05, CENTER + Math.sin(angle) * r]);
  }
  return points;
}

/** Pointed-top teardrop, tilted for a more dynamic silhouette. */
function dropletTiltPoints(): Point[] {
  const base: Point[] = [
    [50, 8],
    [63, 22],
    [73, 40],
    [75, 58],
    [67, 77],
    [50, 87],
    [33, 77],
    [25, 58],
    [27, 40],
    [37, 22],
  ];
  return rotatePoints(base, 16);
}

/** Capsule whose lower edge carries two gentle wave bumps. */
function pillWavePoints(): Point[] {
  return [
    [24, 30],
    [50, 28],
    [76, 30],
    [90, 40],
    [90, 60],
    [76, 70],
    [63, 77],
    [50, 70],
    [37, 77],
    [24, 70],
    [10, 60],
    [10, 40],
  ];
}

/** Thick upward-opening crescent; the broad bottom still seats both eyes. */
function moonSlicePoints(): Point[] {
  return [
    [22, 30],
    [14, 46],
    [18, 64],
    [30, 78],
    [50, 84],
    [70, 78],
    [82, 64],
    [86, 46],
    [78, 30],
    [66, 40],
    [50, 44],
    [34, 40],
  ];
}

export const GROK_BALL_SHAPES: Record<GrokBallShapeId, ShapeDefinition> = {
  circle: {
    id: "circle",
    points: ring(24, () => 46),
    eyeY: 48,
    eyeSpacing: 24,
  },
  blob: {
    id: "blob",
    points: ring(18, (i) => (i % 4 === 0 ? 46 : i % 3 === 0 ? 41 : 44)),
    eyeY: 48,
    eyeSpacing: 24,
  },
  pebble: {
    id: "pebble",
    points: ring(20, (i) => (i % 5 === 0 ? 44 : i % 3 === 0 ? 48 : 41)),
    eyeY: 50,
    eyeSpacing: 25,
  },
  bean: {
    id: "bean",
    points: [
      [30, 18],
      [52, 10],
      [76, 22],
      [86, 44],
      [78, 68],
      [58, 88],
      [34, 86],
      [18, 70],
      [14, 46],
      [22, 28],
    ],
    eyeY: 48,
    eyeSpacing: 24,
    eyeScale: 0.9,
  },
  egg: {
    id: "egg",
    points: ellipseRing(20, 34, 45),
    eyeY: 47,
    eyeSpacing: 22,
  },
  squircle: {
    id: "squircle",
    points: squirclePoints(),
    eyeY: 50,
    eyeSpacing: 24,
  },
  capsule: {
    id: "capsule",
    points: capsulePoints(),
    eyeY: 50,
    eyeSpacing: 26,
  },
  hex: {
    id: "hex",
    points: hexPoints(),
    eyeY: 50,
    eyeSpacing: 24,
  },
  cloud: {
    id: "cloud",
    points: [
      [26, 68],
      [18, 56],
      [24, 42],
      [38, 34],
      [50, 26],
      [66, 28],
      [80, 38],
      [86, 52],
      [80, 66],
      [66, 76],
      [50, 82],
      [34, 78],
    ],
    eyeY: 52,
    eyeSpacing: 24,
    eyeScale: 0.95,
  },
  "soft-diamond": {
    id: "soft-diamond",
    points: superellipsePoints(2.4, 44, 24, 45),
    eyeY: 50,
    eyeSpacing: 22,
  },
  "droplet-tilt": {
    id: "droplet-tilt",
    points: dropletTiltPoints(),
    eyeY: 56,
    eyeSpacing: 22,
    eyeScale: 0.95,
  },
  "pill-wave": {
    id: "pill-wave",
    points: pillWavePoints(),
    eyeY: 46,
    eyeSpacing: 24,
  },
  "moon-slice": {
    id: "moon-slice",
    points: moonSlicePoints(),
    eyeY: 60,
    eyeSpacing: 22,
    eyeScale: 0.9,
  },
  petal: {
    id: "petal",
    points: petalPoints(),
    eyeY: 48,
    eyeSpacing: 23,
  },
  "soft-triangle": {
    id: "soft-triangle",
    points: softTrianglePoints(),
    eyeY: 54,
    eyeSpacing: 22,
  },
};

export const GROK_BALL_SHAPE_IDS: GrokBallShapeId[] = [
  "circle",
  "blob",
  "pebble",
  "bean",
  "egg",
  "squircle",
  "capsule",
  "hex",
  "cloud",
  "soft-diamond",
  "droplet-tilt",
  "pill-wave",
  "moon-slice",
  "petal",
  "soft-triangle",
];

/** Sample a closed contour at an even parameter resolution. */
export function sampleContour(points: Point[], resolution = 64): Point[] {
  if (points.length === 0) {
    return [];
  }
  const sampled: Point[] = [];
  for (let i = 0; i < resolution; i++) {
    const position = (points.length * i) / resolution;
    const index = Math.floor(position);
    const t = position - index;
    const current = points[index % points.length]!;
    const next = points[(index + 1) % points.length]!;
    sampled.push([
      current[0] + (next[0] - current[0]) * t,
      current[1] + (next[1] - current[1]) * t,
    ]);
  }
  return sampled;
}

/** Convert a point ring into a smooth closed SVG path. */
export function contourPath(points: Point[]): string {
  if (points.length < 3) {
    return "";
  }
  const first = points[0]!;
  const parts: string[] = [`M ${first[0].toFixed(2)} ${first[1].toFixed(2)}`];
  for (let i = 0; i < points.length; i++) {
    const p0 = points[(i - 1 + points.length) % points.length]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % points.length]!;
    const p3 = points[(i + 2) % points.length]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    parts.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`,
    );
  }
  parts.push("Z");
  return parts.join(" ");
}

export type EyeProjection = {
  x: number;
  y: number;
  z: number;
  visible: boolean;
};

/**
 * Project one eye from a unit sphere.
 *
 * `gaze` is a 2D vector in [-1, 1]. The eye is rotated around the Y and X
 * axes, then orthographically projected. A negative z means the eye rotated
 * behind the ball and must be hidden.
 */
export function projectEye(
  gaze: { x: number; y: number },
  side: -1 | 1,
): EyeProjection {
  const baseX = side * 0.34;
  const yaw = gaze.x * 0.55;
  const pitch = gaze.y * 0.42;

  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const x1 = baseX * cosYaw + 1 * sinYaw;
  const z1 = -baseX * sinYaw + 1 * cosYaw;

  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const y2 = 0 * cosPitch - z1 * sinPitch;
  const z2 = 0 * sinPitch + z1 * cosPitch;

  return {
    x: x1,
    y: y2,
    z: z2,
    visible: z2 > 0,
  };
}

export function interpolatePoints(a: Point[], b: Point[], t: number): Point[] {
  if (a.length !== b.length) {
    return t < 0.5 ? a : b;
  }
  return a.map((point, index) => {
    const target = b[index]!;
    return [
      point[0] + (target[0] - point[0]) * t,
      point[1] + (target[1] - point[1]) * t,
    ];
  });
}

export function mixColor(a: string, b: string, t: number): string {
  const parse = (value: string): [number, number, number] => {
    const clean = value.replace("#", "");
    if (clean.length !== 6) {
      return [0, 0, 0];
    }
    return [
      Number.parseInt(clean.slice(0, 2), 16),
      Number.parseInt(clean.slice(2, 4), 16),
      Number.parseInt(clean.slice(4, 6), 16),
    ];
  };
  const from = parse(a);
  const to = parse(b);
  const mixed = from.map((channel, index) =>
    Math.round(channel + (to[index]! - channel) * t),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export type EyeRingFrame = {
  /** Eight control points around one eye, in local eye space. */
  points: Point[];
  color: string;
};

function eyeRing(
  rx: number,
  ry: number,
  tilt: number,
  offsetY = 0,
  color = "#f8fafc",
): EyeRingFrame {
  const points: Point[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8;
    const x = Math.cos(angle) * rx;
    const y = Math.sin(angle) * ry + offsetY;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    points.push([x * cos - y * sin, x * sin + y * cos]);
  }
  return { points, color };
}

export type StateFrame = {
  left: EyeRingFrame;
  right: EyeRingFrame;
  bodyTilt: number;
  bodyScale: number;
  aura: string | null;
};

export const GROK_BALL_STATE_FRAMES: Record<GrokBallState, StateFrame> = {
  idle: {
    left: eyeRing(4.4, 7.2, 0),
    right: eyeRing(4.4, 7.2, 0),
    bodyTilt: 0,
    bodyScale: 1,
    aura: null,
  },
  thinking: {
    left: eyeRing(3.6, 6.2, -0.16),
    right: eyeRing(4.0, 6.8, 0.12),
    bodyTilt: -0.03,
    bodyScale: 0.99,
    aura: "#60a5fa",
  },
  working: {
    left: eyeRing(3.9, 6.4, 0.08),
    right: eyeRing(3.9, 6.4, -0.08),
    bodyTilt: 0.02,
    bodyScale: 1.01,
    aura: "#22c55e",
  },
  waiting: {
    left: eyeRing(5.0, 8.0, 0),
    right: eyeRing(5.0, 8.0, 0),
    bodyTilt: 0,
    bodyScale: 1,
    aura: "#f59e0b",
  },
  blocked: {
    left: eyeRing(4.0, 5.8, 0.22, 0, "#fecaca"),
    right: eyeRing(4.0, 5.8, -0.22, 0, "#fecaca"),
    bodyTilt: 0,
    bodyScale: 1,
    aura: "#ef4444",
  },
  done: {
    left: eyeRing(4.8, 6.2, -0.1, 0, "#bbf7d0"),
    right: eyeRing(4.8, 6.2, 0.1, 0, "#bbf7d0"),
    bodyTilt: 0,
    bodyScale: 1,
    aura: "#22c55e",
  },
};

export function interpolateStateFrame(
  from: StateFrame,
  to: StateFrame,
  t: number,
): StateFrame {
  return {
    left: {
      points: interpolatePoints(from.left.points, to.left.points, t),
      color: mixColor(from.left.color, to.left.color, t),
    },
    right: {
      points: interpolatePoints(from.right.points, to.right.points, t),
      color: mixColor(from.right.color, to.right.color, t),
    },
    bodyTilt: from.bodyTilt + (to.bodyTilt - from.bodyTilt) * t,
    bodyScale: from.bodyScale + (to.bodyScale - from.bodyScale) * t,
    aura: t < 0.5 ? from.aura : to.aura,
  };
}


/** Fixed-slot identity roles; `inline` renders a static (non-animated) glyph. */
export type GrokBallVariant = "sidebar" | "message-header" | "preview" | "inline";

export const GROK_BALL_SIZES: Record<GrokBallVariant, number> = {
  sidebar: 40,
  "message-header": 26,
  preview: 96,
  inline: 26,
};

/** Variants that must not run the animation loop (in-message + thumbnails). */
export const GROK_BALL_STATIC_VARIANTS: readonly GrokBallVariant[] = ["inline"];

export function isStaticVariant(variant: GrokBallVariant): boolean {
  return GROK_BALL_STATIC_VARIANTS.includes(variant);
}

export const GROK_BALL_COLORS = [
  "#0a0a0c",
  "#8b5e3c",
  "#e8483f",
  "#f08a24",
  "#f0b429",
  "#3ecf8e",
  "#2fbfa0",
  "#3b93f0",
  "#8b5cf6",
  "#e152b0",
  "#a3a3a3",
  "#f1efe9",
];
