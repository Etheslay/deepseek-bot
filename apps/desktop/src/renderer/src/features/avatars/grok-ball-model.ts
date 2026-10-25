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
  | "squircle"
  | "star4"
  | "cloud"
  | "heart"
  | "flower6"
  | "egg"
  | "capsule"
  | "triangle"
  | "pentagon"
  | "star5"
  | "hexagon"
  | "pumpkin";

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
  /** Horizontal offset of the eye pair, relative to the shape center. */
  eyeX?: number;
  /** Vertical placement of the eye pair, relative to the shape center. */
  eyeY: number;
  /** Horizontal distance between eye centers. */
  eyeSpacing: number;
  /** Optional eye scale multiplier for narrow shapes. */
  eyeScale?: number;
  /** Soft radial creases for multi-lobe (pumpkin / flower) bodies. */
  creases?: number;
  /** Draw the little pumpkin stalk on top of the body. */
  stem?: boolean;
};

const CENTER = 50;

const TAU = Math.PI * 2;

/**
 * Sample a radial silhouette r(θ) into a dense ring of points.
 *
 * The dense sampling is deliberate: with ~180 points the cubic path builder
 * follows the analytic curve instead of exposing the low-poly corners that
 * made the earlier 18–36 point silhouettes look faceted.
 */
function radialRing(
  radius: (angle: number) => number,
  options: {
    count?: number;
    scaleX?: number;
    scaleY?: number;
    rotateDeg?: number;
  } = {},
): Point[] {
  const { count = 180, scaleX = 1, scaleY = 1, rotateDeg = 0 } = options;
  const rot = (rotateDeg * Math.PI) / 180;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (TAU * i) / count;
    const r = radius(angle);
    const x = Math.cos(angle) * r * scaleX;
    const y = Math.sin(angle) * r * scaleY;
    points.push([CENTER + x * cosR - y * sinR, CENTER + x * sinR + y * cosR]);
  }
  return points;
}

/**
 * Regular n-gon radius, blended (`round` 0→1) toward a circle so the corners
 * become soft instead of sharp.
 */
function roundedPolygonRadius(
  sides: number,
  round: number,
  size: number,
): (angle: number) => number {
  const inner = Math.cos(Math.PI / sides);
  const step = TAU / sides;
  return (angle) => {
    const wrapped = ((angle % step) + step) % step;
    const poly = (size * inner) / Math.cos(wrapped - step / 2);
    return size + (poly - size) * (1 - round);
  };
}

/** Polar form of a superellipse |x|^n + |y|^n = a^n. */
function superellipseRadius(
  exponent: number,
  size: number,
): (angle: number) => number {
  return (angle) => {
    const c = Math.abs(Math.cos(angle)) ** exponent;
    const s = Math.abs(Math.sin(angle)) ** exponent;
    return size / Math.max(c + s, 1e-6) ** (1 / exponent);
  };
}

/** Stadium silhouette: a segment swept by a disk. */
function capsuleRadius(length: number, thickness: number): (angle: number) => number {
  return (angle) => thickness + (length / 2) * Math.abs(Math.cos(angle));
}

function harmonic(offset: number, ...terms: Array<[number, number, number]>): (angle: number) => number {
  // terms: [amplitude, frequency, phase]
  return (angle) =>
    offset +
    terms.reduce(
      (sum, [amp, freq, phase]) => sum + amp * Math.cos(freq * angle + phase),
      0,
    );
}

/** Classic parametric heart, normalised into the 100×100 box. */
function heartPoints(): Point[] {
  const raw: Point[] = [];
  const count = 180;
  for (let i = 0; i < count; i++) {
    const t = (Math.PI * 2 * i) / count;
    const x = 16 * Math.sin(t) ** 3;
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    raw.push([x, y]);
  }
  const xs = raw.map(([x]) => x);
  const ys = raw.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = 82 / Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Tilt the heart so the tip points down-left, like the reference picker.
  const rot = (-28 * Math.PI) / 180;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  return raw.map(([x, y]) => {
    const px = (x - cx) * scale;
    const py = -(y - cy) * scale + 2;
    return [CENTER + px * cosR - py * sinR, CENTER + px * sinR + py * cosR];
  });
}
export const GROK_BALL_SHAPES: Record<GrokBallShapeId, ShapeDefinition> = {
  circle: {
    id: "circle",
    points: radialRing(() => 44),
    eyeY: 48,
    eyeSpacing: 24,
  },
  blob: {
    id: "blob",
    points: radialRing(harmonic(40, [3.8, 3, 0.5], [1.4, 2, -0.6]), { rotateDeg: 8 }),
    eyeY: 48,
    eyeSpacing: 24,
  },
  squircle: {
    id: "squircle",
    points: radialRing(superellipseRadius(4.4, 44), { rotateDeg: 18 }),
    eyeY: 50,
    eyeSpacing: 24,
  },
  star4: {
    id: "star4",
    points: radialRing(harmonic(40, [6, 4, 0])),
    eyeY: 48,
    eyeSpacing: 22,
    creases: 4,
  },
  cloud: {
    id: "cloud",
    points: radialRing(harmonic(39.5, [4.5, 3, 1.1]), { scaleY: 0.97 }),
    eyeY: 49,
    eyeSpacing: 24,
  },
  heart: {
    id: "heart",
    points: heartPoints(),
    eyeX: 6,
    eyeY: 40,
    eyeSpacing: 20,
    eyeScale: 0.92,
  },
  flower6: {
    id: "flower6",
    points: radialRing(harmonic(40, [4.2, 6, 0])),
    eyeY: 48,
    eyeSpacing: 22,
    creases: 6,
  },
  egg: {
    id: "egg",
    points: radialRing((a) => 40 * (1 - 0.1 * Math.cos(a)), { scaleY: 1.1 }),
    eyeY: 47,
    eyeSpacing: 22,
  },
  capsule: {
    id: "capsule",
    points: radialRing(capsuleRadius(44, 24), { rotateDeg: -8 }),
    eyeY: 50,
    eyeSpacing: 26,
  },
  triangle: {
    id: "triangle",
    points: radialRing(roundedPolygonRadius(3, 0.52, 45), { rotateDeg: 90 }),
    eyeY: 54,
    eyeSpacing: 22,
  },
  pentagon: {
    id: "pentagon",
    points: radialRing(roundedPolygonRadius(5, 0.5, 45), { rotateDeg: 90 }),
    eyeY: 51,
    eyeSpacing: 23,
  },
  star5: {
    id: "star5",
    points: radialRing(harmonic(40, [6.5, 5, 0])),
    eyeY: 48,
    eyeSpacing: 22,
    creases: 5,
  },
  hexagon: {
    id: "hexagon",
    points: radialRing(roundedPolygonRadius(6, 0.56, 45)),
    eyeY: 50,
    eyeSpacing: 24,
  },
  pumpkin: {
    id: "pumpkin",
    points: radialRing(harmonic(40, [3.4, 6, 0]), { scaleY: 1.03 }),
    eyeY: 48,
    eyeSpacing: 22,
    creases: 6,
    stem: true,
  },
};

export const GROK_BALL_SHAPE_IDS: GrokBallShapeId[] = [
  "circle",
  "blob",
  "squircle",
  "star4",
  "cloud",
  "heart",
  "flower6",
  "egg",
  "capsule",
  "triangle",
  "pentagon",
  "star5",
  "hexagon",
  "pumpkin",
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

export type ShadePalette = {
  /** Lit tone, sampled toward the upper-left highlight. */
  hi: string;
  /** Base body tone. */
  mid: string;
  /** Occluded tone for the lower-right side. */
  shade: string;
};

/**
 * Three-stop palette for the soft-blob body gradient.
 *
 * The light source is fixed at the upper-left (~45° azimuth), so the model
 * only has to derive a lit tone and an occluded tone from the base color.
 */
export function shadePalette(base: string): ShadePalette {
  return {
    hi: mixColor(base, "#ffffff", 0.55),
    mid: base,
    shade: mixColor(base, "#000000", 0.34),
  };
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

/**
 * Body palette, matching the reference picker's swatches. The black/white
 * extreme is not listed here: it is the theme-aware mono ball, whose swatch
 * renders black on the light theme and white on the dark theme.
 */
export const GROK_BALL_COLORS = [
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
];








