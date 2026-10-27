import { describe, expect, it } from "vitest";
import {
  buildMesh,
  buildSolid,
  glossAnchor,
  projectMesh,
  projectPoint,
  projectSilhouette,
  solidLodFor,
  surfaceFrontZ,
  type ProjectedFace,
} from "../../src/renderer/src/features/avatars/grok-ball-3d.js";
import {
  GROK_BALL_SHAPES,
  GROK_BALL_SHAPE_IDS,
} from "../../src/renderer/src/features/avatars/grok-ball-model.js";

const UNIT = 34;
const LOD = solidLodFor(96);

/** Horizontal span of a painted shell, in viewBox px. */
function width(faces: ProjectedFace[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const face of faces) {
    const numbers = (face.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    for (let i = 0; i < numbers.length; i += 2) {
      min = Math.min(min, numbers[i]!);
      max = Math.max(max, numbers[i]!);
    }
  }
  return max - min;
}

/** Where the lit side sits: mean x of the ten brightest faces. */
function glossX(faces: ProjectedFace[]): number {
  const top = [...faces].sort((a, b) => b.shade - a.shade).slice(0, 10);
  const xs = top.flatMap((face) => {
    const numbers = (face.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    return numbers.filter((_, index) => index % 2 === 0);
  });
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

describe("lofted solids", () => {
  it("builds a closed outward shell for every shape", () => {
    for (const id of GROK_BALL_SHAPE_IDS) {
      const mesh = buildMesh(id, LOD);
      expect(mesh.vertices.length, id).toBeGreaterThan(20);
      // Outward normals: a star-shaped body's normal always leans away from
      // its own centre, which is what lets the renderer cull the far half.
      for (let i = 0; i < mesh.vertices.length; i++) {
        const v = mesh.vertices[i]!;
        const n = mesh.normals[i]!;
        if (Math.hypot(v[0], v[1], v[2]) < 1e-6) {
          continue; // poles
        }
        expect(n[0] * v[0] + n[1] * v[1] + n[2] * v[2], `${id} vertex ${i}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the designed silhouette as the widest ring of the body", () => {
    for (const id of GROK_BALL_SHAPE_IDS) {
      const mesh = buildMesh(id, LOD);
      const contour = GROK_BALL_SHAPES[id].points;
      for (let probe = 0; probe < 8; probe++) {
        const theta = (probe / 8) * Math.PI * 2;
        const dx = Math.cos(theta);
        const dy = Math.sin(theta);
        // Compare like with like: the front-view outline is the *support
        // function* (how far the body reaches along a direction), not the
        // radial distance — for any curved outline the two differ.
        let designed = 0;
        for (const [x, y] of contour) {
          designed = Math.max(designed, ((x - 50) * dx + (y - 50) * dy) / UNIT);
        }
        let reached = 0;
        for (const [x, y] of mesh.vertices) {
          reached = Math.max(reached, x * dx + y * dy);
        }
        // The loft only samples the outline at the ring azimuths, so a peak
        // can fall between two rings; it must not fall far short.
        expect(reached, `${id} @${theta.toFixed(2)}`).toBeGreaterThan(designed * 0.9);
        expect(reached, `${id} @${theta.toFixed(2)}`).toBeLessThanOrEqual(designed * 1.02);
      }
    }
  });

  it("culls the far half of the shell", () => {
    const mesh = buildMesh("blob", LOD);
    const front = projectMesh(mesh, { yaw: 0, pitch: 0, scale: UNIT });
    expect(front.length).toBeGreaterThan(10);
    expect(front.length).toBeLessThan(mesh.faces.length);
  });

  it("changes the outline when an asymmetric body turns (not a flat pie)", () => {
    // Chosen for a real difference between the front half-width and the body's
    // own depth. The capsule is deliberately NOT here: it is 28 px wide and
    // 28 px deep, so its outline is legitimately invariant under a yaw.
    for (const id of ["squircle", "cylinder", "gem", "shield"] as const) {
      const mesh = buildMesh(id, LOD);
      const front = width(projectMesh(mesh, { yaw: 0, pitch: 0, scale: UNIT }));
      const side = width(projectMesh(mesh, { yaw: Math.PI / 2, pitch: 0, scale: UNIT }));
      expect(Math.abs(front - side), id).toBeGreaterThan(2);
    }
  });

  it("keeps a true sphere's outline fixed but slides its shading", () => {
    const mesh = buildMesh("circle", LOD);
    const rest = projectMesh(mesh, { yaw: 0, pitch: 0, scale: UNIT });
    const turned = projectMesh(mesh, { yaw: 0.31, pitch: 0, scale: UNIT });
    // A sphere's silhouette is rotation-invariant, so the volume cue has to
    // come from the gloss riding the body — which is why the key light is
    // locked to the body instead of to the screen. (Within 1%: the outline is
    // read off a tessellated shell, so the sampling grid moves under rotation.)
    const restWidth = width(rest);
    expect(Math.abs(width(turned) - restWidth) / restWidth).toBeLessThan(0.01);
    expect(Math.abs(glossX(turned) - glossX(rest))).toBeGreaterThan(1);
    const ramp = Math.max(...turned.map((f) => f.shade)) - Math.min(...turned.map((f) => f.shade));
    expect(ramp).toBeGreaterThan(0.3);
  });

  it("reduces the rotated shell to one smooth outline", () => {
    for (const id of GROK_BALL_SHAPE_IDS) {
      const solid = buildSolid(id, LOD);
      const outline = projectSilhouette(solid, { yaw: 0.24, pitch: 0.1, scale: UNIT });
      expect(outline.length, id).toBe(96);
      for (const [x, y] of outline) {
        expect(Number.isFinite(x) && Number.isFinite(y), id).toBe(true);
        // Nothing may fly off the slot: the outline stays inside the viewBox.
        expect(Math.hypot(x - 50, y - 50), id).toBeLessThan(50);
      }
      // One closed ring, no duplicate spikes from the tessellation grid.
      let longest = 0;
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i]!;
        const b = outline[(i + 1) % outline.length]!;
        longest = Math.max(longest, Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      expect(longest, id).toBeLessThan(9);
    }
  });

  it("keeps the gloss anchored to the body, not to the screen", () => {
    const solid = buildSolid("circle", LOD);
    const facing = glossAnchor(solid, { yaw: 0, pitch: 0, scale: UNIT });
    const turned = glossAnchor(solid, { yaw: 0.31, pitch: 0, scale: UNIT });
    expect(Math.abs(turned.x - facing.x)).toBeGreaterThan(2);
    expect(facing.strength).toBeGreaterThan(0);
  });

  it("ramps the structure view from lit to terminator", () => {
    // projectMesh is the debug/structure view only: the shipped body is one
    // flat colour. This ramp must still exist for that view to be meaningful.
    const faces = projectMesh(buildMesh("blob", LOD), { yaw: 0.2, pitch: 0.1, scale: UNIT });
    const shades = faces.map((f) => f.shade);
    expect(Math.max(...shades)).toBeGreaterThan(0.85);
    expect(Math.min(...shades)).toBeLessThan(0.7);
    expect(Math.max(...faces.map((f) => f.rim))).toBeGreaterThan(0.05);
    expect(Math.min(...faces.map((f) => f.gloss))).toBe(0);
  });

  it("puts the eye anchors on the front shell, inside the body", () => {
    for (const id of GROK_BALL_SHAPE_IDS) {
      const solid = buildSolid(id, LOD);
      const definition = GROK_BALL_SHAPES[id];
      const x = (definition.eyeSpacing ?? 22) / 2 / UNIT;
      const y = (definition.eyeY - 50) / UNIT;
      const z = surfaceFrontZ(solid, x, y);
      expect(Number.isFinite(z), id).toBe(true);
      expect(z, id).toBeGreaterThan(0);
      expect(z, id).toBeLessThanOrEqual(solid.depth + 1e-6);
    }
  });

  it("projects eye anchors", () => {
    const p = projectPoint([0.34, -0.05, 0.93], { yaw: 0.3, pitch: 0, scale: UNIT });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(p.s).toBeGreaterThan(0);
  });

  it("coarsens the mesh for small slots", () => {
    const small = solidLodFor(26);
    const large = solidLodFor(96);
    expect(small.segU * small.segV).toBeLessThan(large.segU * large.segV);
    expect(buildMesh("circle", small).vertices.length).toBeLessThan(
      buildMesh("circle", large).vertices.length,
    );
  });
});
