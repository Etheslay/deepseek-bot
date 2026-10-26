/**
 * Solid-geometry meshes for the Grok Ball avatars (D29 follow-up).
 *
 * Every shape renders from a real 3D model, not a flat path: the circle is a
 * sphere, the triangle is a tetrahedron, the four-point star is an octahedron,
 * and the remaining silhouettes (star5, heart, cloud, pentagon…) are extruded
 * prisms built from the 2D contour. The renderer rotates the mesh by the gaze
 * (yaw/pitch), applies perspective, painter-sorts the faces and shades each
 * face against a fixed light at the upper-left, so turning the head changes
 * the silhouette and the lit faces — a solid, not a sticker.
 */
import { GROK_BALL_SHAPES, sampleContour, type GrokBallShapeId } from "./grok-ball-model.js";

export type Vec3 = readonly [number, number, number];

export interface Mesh {
  readonly vertices: ReadonlyArray<Vec3>;
  /** Index triples/quads, wound so the outward normal faces the viewer. */
  readonly faces: ReadonlyArray<readonly number[]>;
}

export interface ProjectedFace {
  readonly d: string;
  readonly shade: number;
  readonly depth: number;
}

const SPHERE_SHAPES: Partial<Record<GrokBallShapeId, Vec3>> = {
  circle: [1, 1, 1],
  blob: [1.02, 0.98, 1],
  egg: [0.86, 1.06, 0.86],
};

function sphereMesh(rx: number, ry: number, rz: number, segU = 18, segV = 10): Mesh {
  // One shared vertex at each pole: duplicating pole vertices per segment
  // makes degenerate fan triangles whose strokes show as spikes.
  const vertices: Vec3[] = [[0, -ry, 0]];
  for (let v = 1; v < segV; v += 1) {
    const phi = (v / segV) * Math.PI - Math.PI / 2;
    for (let u = 0; u < segU; u += 1) {
      const theta = (u / segU) * Math.PI * 2;
      vertices.push([
        rx * Math.cos(phi) * Math.sin(theta),
        -ry * Math.sin(phi),
        rz * Math.cos(phi) * Math.cos(theta),
      ]);
    }
  }
  const south = vertices.length;
  vertices.push([0, ry, 0]);
  const ring = (v: number, u: number): number => (v - 1) * segU + ((u % segU + segU) % segU) + 1;
  const faces: number[][] = [];
  for (let u = 0; u < segU; u += 1) {
    faces.push([0, ring(1, u), ring(1, u + 1)]);
  }
  for (let v = 1; v < segV - 1; v += 1) {
    for (let u = 0; u < segU; u += 1) {
      faces.push([ring(v, u), ring(v, u + 1), ring(v + 1, u + 1), ring(v + 1, u)]);
    }
  }
  for (let u = 0; u < segU; u += 1) {
    faces.push([south, ring(segV - 1, u + 1), ring(segV - 1, u)]);
  }
  return { vertices, faces };
}

/** Regular tetrahedron standing on a triangular base, one face to the camera. */
function tetraMesh(): Mesh {
  const base = 0.95;
  const vertices: Vec3[] = [
    [0, -0.62, base * Math.sin(Math.PI / 6)],
    [-base * Math.cos(Math.PI / 6), -0.62, -base * Math.sin(Math.PI / 6) * 0.5],
    [base * Math.cos(Math.PI / 6), -0.62, -base * Math.sin(Math.PI / 6) * 0.5],
    [0, 0.95, 0],
  ];
  // Re-aim: apex toward +z so the front silhouette is a triangle.
  const rotated = vertices.map(
    ([x, y, z]): Vec3 => [x, z * 0.9 - 0.15, y * 0.9 + 0.25],
  );
  const faces = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 1],
    [1, 3, 2],
  ];
  return { vertices: rotated, faces };
}

/** Octahedron: front silhouette is the four-point star. */
function octaMesh(): Mesh {
  const s = 1.05;
  const vertices: Vec3[] = [
    [s, 0, 0],
    [-s, 0, 0],
    [0, s, 0],
    [0, -s, 0],
    [0, 0, s],
    [0, 0, -s],
  ];
  const faces = [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ];
  return { vertices, faces };
}

/** Extrude a 2D contour (x right, y down in shape space) into a solid prism. */
function extrudeMesh(contour: ReadonlyArray<readonly [number, number]>, depth: number): Mesh {
  const half = depth / 2;
  const n = contour.length;
  const vertices: Vec3[] = [];
  for (const [x, y] of contour) {
    vertices.push([x, y, half]);
  }
  for (const [x, y] of contour) {
    vertices.push([x, y, -half]);
  }
  vertices.push([0, 0, half], [0, 0, -half]);
  const frontCenter = 2 * n;
  const backCenter = 2 * n + 1;
  const faces: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    faces.push([frontCenter, i, j]);
    faces.push([backCenter, n + j, n + i]);
    faces.push([i, j, n + j, n + i]);
  }
  return { vertices, faces };
}

const meshCache = new Map<GrokBallShapeId, Mesh>();

export function buildMesh(shape: GrokBallShapeId): Mesh {
  const cached = meshCache.get(shape);
  if (cached !== undefined) {
    return cached;
  }
  let mesh: Mesh;
  const sphere = SPHERE_SHAPES[shape];
  if (sphere !== undefined) {
    mesh = sphereMesh(sphere[0], sphere[1], sphere[2]);
  } else if (shape === "triangle") {
    mesh = tetraMesh();
  } else if (shape === "star4") {
    mesh = octaMesh();
  } else {
    const definition = GROK_BALL_SHAPES[shape];
    // Contour points live in the 100x100 local space; normalize to the unit
    // model so all solids share one projection scale.
    const contour = sampleContour(definition.points, 26).map(
      (p): [number, number] => [(p[0] - 50) / 34, (p[1] - 50) / 34],
    );
    mesh = extrudeMesh(contour, 0.42);
  }
  meshCache.set(shape, mesh);
  return mesh;
}

/** Fixed key light: upper-left, slightly in front, y-down screen space. */
const LIGHT: Vec3 = (() => {
  const [x, y, z] = [-0.42, -0.52, 0.74] as const;
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
})();

const PERSPECTIVE = 2.4;

export interface Projection {
  readonly yaw: number;
  readonly pitch: number;
  readonly scale: number;
}

function rotate(v: Vec3, cosY: number, sinY: number, cosP: number, sinP: number): Vec3 {
  const [x, y, z] = v;
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  const y2 = y * cosP - z1 * sinP;
  const z2 = y * sinP + z1 * cosP;
  return [x1, y2, z2];
}

function project(v: Vec3, scale: number): [number, number] {
  const f = PERSPECTIVE / (PERSPECTIVE + v[2]);
  return [50 + v[0] * scale * f, 50 + v[1] * scale * f];
}

/** Rotate + project every face, back-to-front, with Lambert shading. */
export function projectMesh(mesh: Mesh, projection: Projection): ProjectedFace[] {
  const { yaw, pitch, scale } = projection;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const points = mesh.vertices.map((v) => rotate(v, cosY, sinY, cosP, sinP));
  const faces: ProjectedFace[] = [];
  for (const face of mesh.faces) {
    const a = points[face[0]!]!;
    const b = points[face[1]!]!;
    const c = points[face[2]!]!;
    // Outward normal from the first triangle of the face.
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const d = face.length > 3 ? points[face[3]!]! : c;
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl === 0) {
      continue;
    }
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // Winding is not guaranteed across generators: flip the normal toward the
    // viewer instead of culling, and let the painter sort hide back faces.
    if (nz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const shade = 0.42 + 0.58 * lambert;
    const depth = (a[2] + b[2] + c[2] + (face.length > 3 ? d[2] : c[2])) / (face.length > 3 ? 4 : 3);
    let path = "";
    for (let i = 0; i < face.length; i += 1) {
      const [px, py] = project(points[face[i]!]!, scale);
      path += `${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`;
    }
    faces.push({ d: `${path}Z`, shade, depth });
  }
  // Far faces first (+z is toward the camera), so near faces paint over them.
  faces.sort((p, q) => p.depth - q.depth);
  return faces;
}

/** Transform an anchor point on the model into screen space (for eyes). */
export function projectPoint(
  v: Vec3,
  projection: Projection,
): { x: number; y: number; z: number; s: number } {
  const cosY = Math.cos(projection.yaw);
  const sinY = Math.sin(projection.yaw);
  const cosP = Math.cos(projection.pitch);
  const sinP = Math.sin(projection.pitch);
  const r = rotate(v, cosY, sinY, cosP, sinP);
  const [x, y] = project(r, projection.scale);
  return { x, y, z: r[2], s: PERSPECTIVE / (PERSPECTIVE + r[2]) };
}
