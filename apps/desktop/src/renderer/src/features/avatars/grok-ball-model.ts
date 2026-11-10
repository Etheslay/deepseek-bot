/**
 * Geometry and state model for the Grok Ball avatar.
 *
 * Two jobs, both deterministic and DOM-free so they can be unit tested:
 *
 *   1. compile the body silhouettes (see "Silhouette compiler" below);
 *   2. hold the eye / state keyframes that the renderer interpolates.
 *
 * The renderer lives in `grok-ball.tsx`; the solid that these silhouettes are
 * lofted into lives in `grok-ball-3d.ts`.
 */

export type GrokBallShapeId =
  // The primitive family, i.e. what the picker offers.
  | "blob"
  | "squircle"
  | "cylinder"
  | "hex"
  | "gem"
  | "crystal"
  | "shield"
  | "arch"
  | "cloud"
  | "leaf"
  | "heart"
  // Retained ids: stored avatars keep referring to them, so they must stay
  // renderable even though nothing hands them out any more.
  | "circle"
  | "star4"
  | "star5"
  | "flower6"
  | "pentagon"
  | "hexagon"
  | "pumpkin"
  | "triangle"
  | "egg"
  | "capsule";

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
  /**
   * How fat the body is front-to-back, as a fraction of its own radius
   * (1 = a true sphere, 0.5 = a cushion). The solid loft uses this, so it is
   * part of the silhouette contract, not a render tweak.
   */
  plump?: number;
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
  const { count = 192, scaleX = 1, scaleY = 1, rotateDeg = 0 } = options;
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
 * Circular binomial blur of a radial silhouette r(θ).
 *
 * Used by the retained lobe bodies: it takes the last edge off a harmonic
 * crest without changing the body's size. `step` is in radians and the blur
 * wraps, so the seam at ±π never shows a notch.
 */
function blurRadius(
  radius: (angle: number) => number,
  step: number,
  passes = 2,
): (angle: number) => number {
  const weights = [1, 4, 6, 4, 1];
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let blurred = radius;
  for (let pass = 0; pass < passes; pass++) {
    const source = blurred;
    blurred = (angle) =>
      weights.reduce(
        (sum, weight, index) =>
          sum + weight * source(angle + (index - 2) * step),
        0,
      ) / total;
  }
  return blurred;
}

function harmonic(
  offset: number,
  ...terms: Array<[number, number, number]>
): (angle: number) => number {
  // terms: [amplitude, frequency, phase]
  return (angle) =>
    offset +
    terms.reduce(
      (sum, [amp, freq, phase]) => sum + amp * Math.cos(freq * angle + phase),
      0,
    );
}

// ---------------------------------------------------------------------------
// Silhouette compiler
// ---------------------------------------------------------------------------

/**
 * Every new body is written as one sentence in a small vocabulary of implicit
 * 2D primitives — a disc, a polyline swept by a disc, and smooth weld/carve
 * combiners — then ray-bisected into a silhouette. Nothing is a traced outline.
 *
 * That vocabulary is what enforces the two rules the old harmonic set kept
 * breaking:
 *
 *   · no square corners — a polygon is never drawn as straight edges; it is a
 *     polyline swept by a disc whose radius IS the corner radius, so a corner
 *     cannot come out sharp;
 *   · no needle tips — the same radius blunts every vertex, and `weld`/`carve`
 *     remove the crease where two lobes meet.
 *
 * `f(x, y) < 0` inside, `0` on the edge. Bisecting a ray from the centre also
 * guarantees a single-valued r(θ), which is the property the solid loft and the
 * support-function silhouette depend on.
 */
type Implicit = (x: number, y: number) => number;

const disc = (r: number): Implicit => (x, y) => Math.hypot(x, y) - r;

const shifted =
  (f: Implicit, dx: number, dy: number): Implicit =>
  (x, y) => f(x - dx, y - dy);

/** Union welded over `k` px: lobes meet without a crease. */
const weld =
  (a: Implicit, b: Implicit, k: number): Implicit =>
  (x, y) => {
    const fa = a(x, y);
    const fb = b(x, y);
    const h = Math.max(k - Math.abs(fa - fb), 0) / k;
    return Math.min(fa, fb) - h * h * k * 0.25;
  };

/** Intersection filleted over `k` px: corners and bites stay round. */
const carve =
  (a: Implicit, b: Implicit, k: number): Implicit =>
  (x, y) => {
    const fa = a(x, y);
    const fb = b(x, y);
    const h = Math.max(k - Math.abs(fa - fb), 0) / k;
    return Math.max(fa, fb) + h * h * k * 0.25;
  };

function segmentDistance(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const squared = dx * dx + dy * dy;
  const t =
    squared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / squared));
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
}

/**
 * A closed polyline swept by a disc of `radius` — the rounded-polygon engine.
 * Points are centre-relative in the 100×100 local space.
 */
const swept =
  (points: ReadonlyArray<readonly [number, number]>, radius: number): Implicit =>
  (x, y) => {
    let nearest = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      nearest = Math.min(
        nearest,
        segmentDistance(x, y, a[0], a[1], b[0], b[1]),
      );
    }
    return nearest - radius;
  };

/** Vertices of a regular polygon; `rotateDeg: -90` puts one vertex up. */
function polygonPoints(
  sides: number,
  radius: number,
  rotateDeg = -90,
  squashY = 1,
): Array<[number, number]> {
  const rot = (rotateDeg * Math.PI) / 180;
  return Array.from({ length: sides }, (_, i) => {
    const angle = (TAU * i) / sides + rot;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius * squashY];
  });
}

/** A rounded rectangle with the given half-size and corner radius. */
function roundedBox(halfW: number, halfH: number, corner: number): Implicit {
  const insetW = Math.max(halfW - corner, 0);
  const insetH = Math.max(halfH - corner, 0);
  const corners: Array<[number, number]> = [
    [-insetW, -insetH],
    [insetW, -insetH],
    [insetW, insetH],
    [-insetW, insetH],
  ];
  return swept(corners, corner);
}

/** Ray-bisect an implicit outline into a radial function r(θ). */
function implicitRadius(f: Implicit, samples = 192): (angle: number) => number {
  const table: number[] = [];
  for (let i = 0; i < samples; i++) {
    const angle = (TAU * i) / samples;
    const cx = Math.cos(angle);
    const cy = Math.sin(angle);
    let lo = 0;
    let hi = 66;
    if (f(cx * hi, cy * hi) < 0) {
      // Never escapes the probe circle: keep the sample finite.
      table.push(hi);
      continue;
    }
    for (let step = 0; step < 24; step++) {
      const mid = (lo + hi) / 2;
      if (f(cx * mid, cy * mid) < 0) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    table.push((lo + hi) / 2);
  }
  return (angle: number) => {
    let a = angle % TAU;
    if (a < 0) {
      a += TAU;
    }
    const pos = (a / TAU) * samples;
    const base = Math.floor(pos);
    const t = pos - base;
    const x = table[base % samples]!;
    const y = table[(base + 1) % samples]!;
    return x * (1 - t) + y * t;
  };
}

/**
 * Compile an implicit body into a dense contour ring in the 100×100 space.
 *
 * `fit` keeps the plate honest: `weld` bulges outward by up to k/4 and a swept
 * corner sits at (vertex distance + radius), so a body can quietly grow past
 * the 50 px radius the slot allows. Rather than hand-tune every radius, the
 * compiled outline is scaled back into the plate once.
 */
function outline(f: Implicit, options: { rotateDeg?: number; fit?: number } = {}): Point[] {
  const radius = implicitRadius(f);
  let peak = 0;
  for (let i = 0; i < 192; i++) {
    peak = Math.max(peak, radius((TAU * i) / 192));
  }
  const limit = options.fit ?? 47;
  const scale = peak > limit ? limit / peak : 1;
  return radialRing(scale === 1 ? radius : (angle: number) => radius(angle) * scale, options);
}

export const GROK_BALL_SHAPES: Record<GrokBallShapeId, ShapeDefinition> = {
  blob: {
    id: "blob",
    points: outline(weld(disc(40), shifted(disc(34), 8, -7), 22)),
    eyeY: 48,
    eyeSpacing: 24,
    plump: 0.94,
  },
  squircle: {
    id: "squircle",
    points: outline(roundedBox(38, 38, 21)),
    eyeY: 50,
    eyeSpacing: 24,
    plump: 0.76,
  },
  cylinder: {
    id: "cylinder",
    points: outline(roundedBox(33, 43, 13)),
    eyeY: 49,
    eyeSpacing: 24,
    plump: 0.72,
  },
  hex: {
    id: "hex",
    points: outline(swept(polygonPoints(6, 37, 0), 9)),
    eyeY: 50,
    eyeSpacing: 24,
    plump: 0.7,
  },
  gem: {
    id: "gem",
    points: outline(swept(polygonPoints(4, 34, -90), 16)),
    eyeY: 50,
    eyeSpacing: 22,
    plump: 0.6,
  },
  crystal: {
    id: "crystal",
    points: outline(swept(polygonPoints(6, 38, -90, 0.74), 9)),
    eyeY: 49,
    eyeSpacing: 22,
    plump: 0.66,
  },
  shield: {
    id: "shield",
    points: outline(
      swept(
        [
          [-29, -33],
          [29, -33],
          [27, 4],
          [0, 33],
          [-27, 4],
        ],
        16,
      ),
    ),
    eyeY: 44,
    eyeSpacing: 22,
    plump: 0.68,
  },
  arch: {
    id: "arch",
    points: outline(
      weld(shifted(disc(27), 0, -14), roundedBox(27, 43, 7), 9),
    ),
    eyeY: 44,
    eyeSpacing: 22,
    plump: 0.66,
  },
  cloud: {
    id: "cloud",
    points: outline(
      weld(
        weld(shifted(disc(23), -20, 7), disc(28), 12),
        shifted(disc(22), 22, 8),
        12,
      ),
    ),
    eyeY: 51,
    eyeSpacing: 24,
    plump: 0.7,
  },
  leaf: {
    id: "leaf",
    // Two long arcs crossing top and bottom: a lens, points included.
    points: outline(
      carve(shifted(disc(54), -26, 0), shifted(disc(54), 26, 0), 16),
    ),
    eyeY: 50,
    eyeSpacing: 22,
    plump: 0.6,
  },
  heart: {
    id: "heart",
    points: outline(
      weld(
        weld(
          shifted(disc(22), -14, -10),
          shifted(disc(22), 14, -10),
          10,
        ),
        swept(
          [
            [-29, -5],
            [0, 31],
            [29, -5],
          ],
          13,
        ),
        10,
      ),
    ),
    eyeX: 3,
    eyeY: 44,
    eyeSpacing: 20,
    eyeScale: 0.92,
    plump: 0.66,
  },
  // --- retired ids: still renderable, no longer handed out -----------------
  circle: {
    id: "circle",
    points: radialRing(() => 44),
    eyeY: 48,
    eyeSpacing: 24,
    plump: 1,
  },
  egg: {
    id: "egg",
    points: radialRing(blurRadius((a) => 40 * (1 - 0.1 * Math.cos(a)), 0.1), {
      scaleY: 1.1,
    }),
    eyeY: 47,
    eyeSpacing: 22,
    plump: 0.95,
  },
  capsule: {
    id: "capsule",
    // A stadium: a segment swept by a disc, written directly as r(θ).
    points: radialRing(blurRadius((a) => 24 + 22 * Math.abs(Math.cos(a)), 0.1), {
      rotateDeg: -8,
    }),
    eyeY: 50,
    eyeSpacing: 24,
    plump: 0.64,
  },
  star4: {
    id: "star4",
    points: radialRing(blurRadius(harmonic(40, [4.2, 4, 0]), 0.2)),
    eyeY: 48,
    eyeSpacing: 22,
    creases: 4,
    plump: 0.52,
  },
  star5: {
    id: "star5",
    points: radialRing(blurRadius(harmonic(40, [4.6, 5, 0]), 0.19), {
      rotateDeg: -90,
    }),
    eyeY: 49,
    eyeSpacing: 22,
    creases: 5,
    plump: 0.5,
  },
  flower6: {
    id: "flower6",
    points: radialRing(blurRadius(harmonic(40, [3.2, 6, 0]), 0.17)),
    eyeY: 48,
    eyeSpacing: 22,
    creases: 6,
    plump: 0.48,
  },
  pentagon: {
    id: "pentagon",
    points: outline(swept(polygonPoints(5, 33, -90), 12)),
    eyeY: 51,
    eyeSpacing: 23,
    plump: 0.68,
  },
  hexagon: {
    id: "hexagon",
    points: outline(swept(polygonPoints(6, 33, 0), 12)),
    eyeY: 50,
    eyeSpacing: 24,
    plump: 0.7,
  },
  pumpkin: {
    id: "pumpkin",
    points: radialRing(blurRadius(harmonic(40, [3.4, 6, 0]), 0.12), {
      scaleY: 1.03,
    }),
    eyeY: 48,
    eyeSpacing: 22,
    creases: 6,
    stem: true,
    plump: 0.86,
  },
  triangle: {
    id: "triangle",
    // The old ▽: kept renderable, and now standing on its base.
    points: outline(swept(polygonPoints(3, 31, -90), 12)),
    eyeY: 58,
    eyeSpacing: 21,
    plump: 0.66,
  },
};

/**
 * The shapes the picker offers. Ids that are not listed here stay renderable —
 * stored avatars keep referring to them — they are simply no longer handed out.
 */
export const GROK_BALL_SHAPE_IDS: GrokBallShapeId[] = [
  "blob",
  "squircle",
  "cylinder",
  "hex",
  "gem",
  "crystal",
  "shield",
  "arch",
  "cloud",
  "leaf",
  "heart",
];

/**
 * Angle → silhouette radius, in the 100×100 local space.
 */
export type RadiusLookup = (theta: number) => number;

const RADIAL_SLOTS = 240;

/**
 * Reduce a point ring to one radial function r(θ) about the shape center.
 *
 * Every body here is star-shaped about its center (a ray from the center
 * crosses the outline once) — which is exactly what the compiler above
 * guarantees — so the whole silhouette collapses to a single function, and that
 * is what the solid loft and the support-function outline consume.
 */
export function radialLookupOf(
  points: Point[],
  slots = RADIAL_SLOTS,
): RadiusLookup {
  const sums = new Array<number>(slots).fill(0);
  const counts = new Array<number>(slots).fill(0);
  for (const [x, y] of points) {
    const dx = x - CENTER;
    const dy = y - CENTER;
    const slot =
      Math.round((Math.atan2(dy, dx) / TAU) * slots + slots) % slots;
    sums[slot]! += Math.hypot(dx, dy);
    counts[slot]! += 1;
  }
  const table: number[] = [];
  for (let i = 0; i < slots; i++) {
    table.push(counts[i]! > 0 ? sums[i]! / counts[i]! : 0);
  }
  // Borrow from the nearest filled slot (wrap both ways).
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < slots; i++) {
      if (table[i] === 0) {
        const prev = table[(i - 1 + slots) % slots]!;
        const next = table[(i + 1) % slots]!;
        table[i] = (prev + next) / 2;
      }
    }
  }
  return (theta: number) => {
    let angle = theta % TAU;
    if (angle < 0) {
      angle += TAU;
    }
    const pos = (angle / TAU) * slots;
    const base = Math.floor(pos);
    const t = pos - base;
    const a = table[base % slots]!;
    const b = table[(base + 1) % slots]!;
    return a * (1 - t) + b * t;
  };
}

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
    left: eyeRing(6.2, 9.6, -0.3),
    right: eyeRing(6.2, 9.6, -0.3),
    bodyTilt: 0,
    bodyScale: 1,
    aura: null,
  },
  thinking: {
    left: eyeRing(5.2, 8.4, -0.2),
    right: eyeRing(5.8, 9.2, 0.16),
    bodyTilt: -0.03,
    bodyScale: 0.99,
    aura: "#60a5fa",
  },
  working: {
    left: eyeRing(5.6, 8.0, 0.14),
    right: eyeRing(5.6, 8.0, -0.14),
    bodyTilt: 0.02,
    bodyScale: 1.01,
    aura: "#22c55e",
  },
  waiting: {
    left: eyeRing(6.8, 10.6, -0.1),
    right: eyeRing(6.8, 10.6, -0.1),
    bodyTilt: 0,
    bodyScale: 1,
    aura: "#f59e0b",
  },
  blocked: {
    left: eyeRing(5.6, 7.2, 0.42, 0, "#fecaca"),
    right: eyeRing(5.6, 7.2, -0.42, 0, "#fecaca"),
    bodyTilt: 0,
    bodyScale: 1,
    aura: "#ef4444",
  },
  done: {
    left: eyeRing(6.6, 8.2, -0.18, 0, "#bbf7d0"),
    right: eyeRing(6.6, 8.2, 0.18, 0, "#bbf7d0"),
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

/**
 * Body palette. The extreme black/white is deliberately absent: that is the
 * theme-aware mono ball, whose swatch renders black on the light theme and
 * white on the dark one.
 *
 * `light` is what the contract stores. `dark` is the colour painted on the
 * dark theme: a brighter, more saturated step, because the old deep tones
 * disappeared into the dark panel. `legacy` keeps those deep hexes, and the
 * retired contract swatches, mapped to the same tone so an already-saved bot
 * picks up the brighter paint without a rewrite.
 */
export const GROK_BALL_TONES = [
  { key: "brown", light: "#A27952", dark: "#C49A6A", legacy: ["#855C36", "#8b5e3c"] },
  { key: "red", light: "#FF3E51", dark: "#FF5C6C", legacy: ["#E02135", "#e8483f"] },
  { key: "orange", light: "#FF781C", dark: "#FF9340", legacy: ["#FF6700", "#f08a24"] },
  { key: "yellow", light: "#FFAF38", dark: "#FFBE4D", legacy: ["#FF9800", "#f0b429"] },
  { key: "green", light: "#00C972", dark: "#22E090", legacy: ["#009957", "#3ecf8e"] },
  { key: "cyan", light: "#1CC3B0", dark: "#36D9C8", legacy: ["#00A592", "#2fbfa0"] },
  { key: "blue", light: "#2A92FE", dark: "#54AEFF", legacy: ["#0E74E0", "#3b93f0"] },
  { key: "violet", light: "#A97EFE", dark: "#C09BFF", legacy: ["#804EE0", "#8b5cf6"] },
  { key: "magenta", light: "#FF5EB1", dark: "#FF7EC4", legacy: ["#E02A88", "#e152b0"] },
  { key: "gray", light: "#959595", dark: "#B0B0B0", legacy: ["#777777", "#a3a3a3"] },
] as const;

export type GrokBallToneKey = (typeof GROK_BALL_TONES)[number]["key"];

/** The canonical (light-theme) swatch values, i.e. what the contract stores. */
export const GROK_BALL_COLORS: string[] = GROK_BALL_TONES.map((tone) => tone.light);

/**
 * The CSS hook for a colour: the tone key when the colour is in the palette,
 * and `null` for anything else (a retired or hand-picked hex), which then
 * renders as itself in both themes.
 */
export function toneKeyFor(color: string): GrokBallToneKey | null {
  const wanted = color.trim().toLowerCase();
  for (const tone of GROK_BALL_TONES) {
    if (tone.light.toLowerCase() === wanted || tone.dark.toLowerCase() === wanted) {
      return tone.key;
    }
    for (const old of tone.legacy) {
      if (old.toLowerCase() === wanted) return tone.key;
    }
  }
  return null;
}

/** The hex the ball and the bubble actually paint for this theme. */
export function paintHex(color: string, theme: "dark" | "light"): string {
  const key = toneKeyFor(color);
  if (key === null) return color;
  const tone = GROK_BALL_TONES.find((item) => item.key === key);
  if (tone === undefined) return color;
  return theme === "light" ? tone.light : tone.dark;
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
