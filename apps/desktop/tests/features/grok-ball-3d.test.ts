import { describe, expect, it } from "vitest";
import { buildMesh, projectMesh, projectPoint } from "../../src/renderer/src/features/avatars/grok-ball-3d.js";
import { GROK_BALL_SHAPES } from "../../src/renderer/src/features/avatars/grok-ball-model.js";

describe("solid meshes", () => {
  it("projects every shape without throwing", () => {
    for (const id of Object.keys(GROK_BALL_SHAPES)) {
      const mesh = buildMesh(id as never);
      const faces = projectMesh(mesh, { yaw: 0.3, pitch: -0.1, scale: 34 });
      expect(faces.length, id).toBeGreaterThan(2);
    }
  });
  it("projects eye anchors", () => {
    const p = projectPoint([0.34, -0.05, 0.93], { yaw: 0.3, pitch: 0, scale: 34 });
    expect(Number.isFinite(p.x)).toBe(true);
  });
});
