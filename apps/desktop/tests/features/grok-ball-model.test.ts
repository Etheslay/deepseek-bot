import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GROK_BALL_SHAPES,
  GROK_BALL_SHAPE_IDS,
  GROK_BALL_SIZES,
  GROK_BALL_STATE_FRAMES,
  GROK_BALL_COLORS,
  GROK_BALL_TONES,
  toneKeyFor,
  contourPath,
  interpolatePoints,
  interpolateStateFrame,
  isStaticVariant,
  mixColor,
  radialLookupOf,
  sampleContour,
  type GrokBallShapeId,
} from "../../src/renderer/src/features/avatars/grok-ball-model.js";

/** What the picker hands out. */
const OFFERED_SHAPES = [
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
] as const;

/** Ids kept only so stored avatars still render. */
const RETIRED_SHAPES = [
  "circle",
  "star4",
  "star5",
  "flower6",
  "pentagon",
  "hexagon",
  "pumpkin",
  "triangle",
  "egg",
  "capsule",
] as const;

const ALL_POINTS = (id: GrokBallShapeId) => GROK_BALL_SHAPES[id].points;

describe("Grok Ball silhouette compiler", () => {
  it("offers the primitive family and keeps retired ids renderable", () => {
    for (const id of [...OFFERED_SHAPES, ...RETIRED_SHAPES]) {
      expect(GROK_BALL_SHAPES[id], id).toBeDefined();
    }
    expect([...GROK_BALL_SHAPE_IDS].sort()).toEqual([...OFFERED_SHAPES].sort());
  });

  it("keeps the id list in sync with the shape map", () => {
    expect([...GROK_BALL_SHAPE_IDS].sort()).toEqual(
      Object.keys(GROK_BALL_SHAPES)
        .filter((id) => (GROK_BALL_SHAPE_IDS as string[]).includes(id))
        .sort(),
    );
  });

  it("gives every shape a closed, in-frame contour with a seat for two eyes", () => {
    for (const id of GROK_BALL_SHAPE_IDS) {
      const shape = GROK_BALL_SHAPES[id];
      expect(shape.points.length, id).toBeGreaterThanOrEqual(3);
      for (const [x, y] of shape.points) {
        expect(Number.isFinite(x) && Number.isFinite(y), id).toBe(true);
        expect(x, id).toBeGreaterThanOrEqual(0);
        expect(x, id).toBeLessThanOrEqual(100);
        expect(y, id).toBeGreaterThanOrEqual(0);
        expect(y, id).toBeLessThanOrEqual(100);
      }
      expect(shape.eyeSpacing, id).toBeGreaterThan(12);
      expect(shape.eyeY, id).toBeGreaterThan(0);
      expect(shape.eyeY, id).toBeLessThan(100);
    }
  });

  it("fills its slot: no body is a stub, none overflows the plate", () => {
    for (const id of GROK_BALL_SHAPE_IDS) {
      const lookup = radialLookupOf(ALL_POINTS(id));
      let min = Infinity;
      let max = 0;
      for (let i = 0; i < 360; i++) {
        const r = lookup((i * Math.PI) / 180);
        min = Math.min(min, r);
        max = Math.max(max, r);
      }
      expect(max, id).toBeGreaterThan(38);
      expect(max, id).toBeLessThan(50);
      // A body that collapsed to a sliver in some direction would read as a
      // scratch, not a character.
      expect(min / max, id).toBeGreaterThan(0.42);
    }
  });

  it("has no square corner or needle tip in any silhouette", () => {
    // Adjacent samples of r(θ) must not jump: a cliff is a hard corner (square)
    // or a needle (spike), and both were rejected in favour of soft solids.
    for (const id of GROK_BALL_SHAPE_IDS) {
      const lookup = radialLookupOf(ALL_POINTS(id));
      const step = (Math.PI * 2) / 720;
      let peak = 0;
      let jump = 0;
      for (let i = 0; i < 720; i++) {
        const theta = i * step;
        const r = lookup(theta);
        peak = Math.max(peak, r);
        jump = Math.max(jump, Math.abs(r - lookup(theta + step)));
      }
      expect(jump / peak, id).toBeLessThan(0.045);
    }
  });

  it("stands every single-apex body on its width, not its point", () => {
    // The old ▽ read as a warning sign. Anything that comes to one point must
    // keep that point up and rest on its width. (A pentagon is deliberately not
    // in this list: vertex-up, its widest ring sits above the middle, which is
    // correct for that body.)
    for (const id of ["triangle"] as const) {
      const points = ALL_POINTS(id);
      const span = (list: [number, number][]) =>
        Math.max(...list.map(([x]) => x)) - Math.min(...list.map(([x]) => x));
      const upper = points.filter(([, y]) => y < 32);
      const lower = points.filter(([, y]) => y > 66);
      expect(upper.length, id).toBeGreaterThan(2);
      expect(lower.length, id).toBeGreaterThan(2);
      expect(span(upper), id).toBeLessThan(span(lower));
    }
  });

  it("gives every body a plumpness the solid loft can use", () => {
    for (const id of GROK_BALL_SHAPE_IDS) {
      const plump = GROK_BALL_SHAPES[id].plump;
      expect(plump, id).toBeGreaterThan(0);
      expect(plump, id).toBeLessThanOrEqual(1);
    }
    // A circle must loft into a true sphere, so it keeps the full depth.
    expect(GROK_BALL_SHAPES.circle.plump).toBe(1);
  });

  it("samples a contour at the requested resolution", () => {
    const sampled = sampleContour(GROK_BALL_SHAPES.cloud.points, 48);
    expect(sampled).toHaveLength(48);
    for (const [x, y] of sampled) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });

  it("builds a closed SVG path from a contour", () => {
    const d = contourPath(sampleContour(GROK_BALL_SHAPES.squircle.points, 32));
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("C ");
    // A malformed control point would show up as NaN in the path data.
    expect(d).not.toContain("NaN");
  });

  it("marks the multi-lobe bodies with soft creases", () => {
    expect(GROK_BALL_SHAPES.pumpkin.creases).toBe(6);
    expect(GROK_BALL_SHAPES.flower6.creases).toBe(6);
    expect(GROK_BALL_SHAPES.star4.creases).toBe(4);
    expect(GROK_BALL_SHAPES.star5.creases).toBe(5);
    for (const id of GROK_BALL_SHAPE_IDS) {
      const creases = GROK_BALL_SHAPES[id].creases;
      if (creases !== undefined) {
        expect(Number.isInteger(creases)).toBe(true);
        expect(creases).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("Grok Ball palette", () => {
  it("offers ten body colours plus the theme-aware mono ball", () => {
    expect(GROK_BALL_COLORS).toHaveLength(10);
    for (const color of GROK_BALL_COLORS) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("pairs every colour with a deeper value for the dark theme", () => {
    for (const tone of GROK_BALL_TONES) {
      expect(tone.light).toMatch(/^#[0-9A-F]{6}$/);
      expect(tone.dark).toMatch(/^#[0-9A-F]{6}$/);
      expect(tone.dark, tone.key).not.toBe(tone.light);
    }
  });

  it("resolves a stored colour back to its tone, either theme or not", () => {
    for (const tone of GROK_BALL_TONES) {
      expect(toneKeyFor(tone.light), tone.key).toBe(tone.key);
      // A row saved while the app was dark still maps to the same pair.
      expect(toneKeyFor(tone.dark), tone.key).toBe(tone.key);
      expect(toneKeyFor(tone.light.toLowerCase()), tone.key).toBe(tone.key);
    }
    // A retired or hand-picked hex has no pair: it renders as itself.
    expect(toneKeyFor("#3b93f0")).toBeNull();
    expect(toneKeyFor("mono")).toBeNull();
  });

  it("keeps the stylesheet in step with the palette", () => {
    // The tone values live in CSS because they are theme-scoped, so nothing in
    // the type system catches a colour added here but not there.
    const css = readFileSync(
      new URL("../../src/renderer/src/styles.css", import.meta.url),
      "utf8",
    );
    for (const tone of GROK_BALL_TONES) {
      expect(css, `${tone.key} dark`).toContain(`--gb-body-${tone.key}: ${tone.dark}`);
      expect(css, `${tone.key} light`).toContain(`--gb-body-${tone.key}: ${tone.light}`);
      expect(css, `${tone.key} rule`).toContain(`[data-tone="${tone.key}"]`);
    }
  });
});

describe("Grok Ball state keyframes", () => {
  it("interpolates points linearly", () => {
    const mid = interpolatePoints(
      [
        [0, 0],
        [10, 10],
      ],
      [
        [10, 10],
        [20, 20],
      ],
      0.5,
    );
    expect(mid[0]).toEqual([5, 5]);
    expect(mid[1]).toEqual([15, 15]);
  });

  it("mixes colors channel-wise", () => {
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixColor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixColor("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  it("morphs state frames without hard cuts", () => {
    const from = GROK_BALL_STATE_FRAMES.idle;
    const to = GROK_BALL_STATE_FRAMES.done;
    const start = interpolateStateFrame(from, to, 0);
    const end = interpolateStateFrame(from, to, 1);
    expect(start.left.points).toEqual(from.left.points);
    expect(end.left.points).toEqual(to.left.points);
    expect(start.left.points.length).toBe(to.left.points.length);
  });

  it("keeps every state frame's eye ring point count identical", () => {
    const counts = Object.values(GROK_BALL_STATE_FRAMES).map(
      (frame) => frame.left.points.length,
    );
    expect(new Set(counts).size).toBe(1);
  });
});

describe("Grok Ball fixed-slot variants", () => {
  it("provides a pixel size for every identity slot", () => {
    for (const variant of ["sidebar", "message-header", "preview", "inline"] as const) {
      expect(GROK_BALL_SIZES[variant]).toBeGreaterThan(0);
    }
    expect(GROK_BALL_SIZES["message-header"]).toBeLessThan(GROK_BALL_SIZES.preview);
    expect(GROK_BALL_SIZES.sidebar).toBeLessThan(GROK_BALL_SIZES.preview);
  });

  it("treats only the inline variant as a static (non-animated) glyph", () => {
    expect(isStaticVariant("inline")).toBe(true);
    expect(isStaticVariant("sidebar")).toBe(false);
    expect(isStaticVariant("message-header")).toBe(false);
  });
});
