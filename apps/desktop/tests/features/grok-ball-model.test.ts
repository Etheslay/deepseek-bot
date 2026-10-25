import { describe, expect, it } from "vitest";
import {
  GROK_BALL_SHAPES,
  GROK_BALL_SHAPE_IDS,
  GROK_BALL_SIZES,
  GROK_BALL_STATE_FRAMES,
  contourPath,
  interpolatePoints,
  interpolateStateFrame,
  isStaticVariant,
  mixColor,
  projectEye,
  sampleContour,
  shadePalette,
} from "../../src/renderer/src/features/avatars/grok-ball-model.js";

const REQUIRED_SHAPES = [
  "circle",
  "blob",
  "pebble",
  "cloud",
  "egg",
  "capsule",
  "squircle",
  "diamond",
  "triangle",
  "pentagon",
  "hexagon",
  "star4",
  "star5",
  "flower6",
  "pumpkin",
] as const;

describe("Grok Ball shapes", () => {
  it("exposes the full self-designed shape set", () => {
    for (const id of REQUIRED_SHAPES) {
      expect(GROK_BALL_SHAPE_IDS).toContain(id);
      expect(GROK_BALL_SHAPES[id]).toBeDefined();
    }
  });

  it("keeps the id list in sync with the shape map", () => {
    expect([...GROK_BALL_SHAPE_IDS].sort()).toEqual(
      Object.keys(GROK_BALL_SHAPES).sort(),
    );
  });

  it("gives every shape a closed, in-frame contour with a seat for two eyes", () => {
    for (const id of GROK_BALL_SHAPE_IDS) {
      const shape = GROK_BALL_SHAPES[id];
      expect(shape.points.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of shape.points) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
      // Eye centers must sit inside the horizontal body band.
      expect(shape.eyeSpacing).toBeGreaterThan(12);
      expect(shape.eyeY).toBeGreaterThan(0);
      expect(shape.eyeY).toBeLessThan(100);
    }
  });

  it("samples a contour at the requested resolution", () => {
    const sampled = sampleContour(GROK_BALL_SHAPES.blob.points, 48);
    expect(sampled).toHaveLength(48);
    for (const [x, y] of sampled) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("builds a closed SVG path from a contour", () => {
    const d = contourPath(sampleContour(GROK_BALL_SHAPES.diamond.points, 32));
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("C ");
  });
});

describe("Grok Ball soft-blob shading", () => {
  it("derives a lit tone above and an occluded tone below the base color", () => {
    const palette = shadePalette("#3b93f0");
    expect(palette.mid).toBe("#3b93f0");
    const lit = Number.parseInt(palette.hi.slice(1, 3), 16);
    const base = Number.parseInt(palette.mid.slice(1, 3), 16);
    const shade = Number.parseInt(palette.shade.slice(1, 3), 16);
    expect(lit).toBeGreaterThan(base);
    expect(shade).toBeLessThan(base);
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

describe("Grok Ball eye projection", () => {
  it("keeps both eyes on the front hemisphere for a centered gaze", () => {
    const left = projectEye({ x: 0, y: 0 }, -1);
    const right = projectEye({ x: 0, y: 0 }, 1);
    expect(left.visible).toBe(true);
    expect(right.visible).toBe(true);
    expect(left.x).toBeLessThan(right.x);
  });

  it("swaps the eye order when the gaze crosses to the far side", () => {
    const left = projectEye({ x: 0.9, y: 0 }, -1);
    const right = projectEye({ x: 0.9, y: 0 }, 1);
    expect(right.x).toBeGreaterThan(left.x);
  });

  it("hides an eye that rotates behind the ball (backface culling)", () => {
    const behind = projectEye({ x: 3, y: 0 }, 1);
    expect(behind.z).toBeLessThan(0);
    expect(behind.visible).toBe(false);
  });
});

describe("Grok Ball keyframe interpolation", () => {
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
    expect(isStaticVariant("preview")).toBe(false);
  });
});

