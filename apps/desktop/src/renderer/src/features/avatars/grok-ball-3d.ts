/**
 * Solid geometry for the Grok Ball avatars.
 *
 * ONE construction for every shape — this is the design rule, not a per-shape
 * hack. The 2D silhouette r(θ) is lofted about the look axis:
 *
 *   ring(v):  x = r(θ)·cos v · cos θ
 *             y = r(θ)·cos v · sin θ
 *             z = depth · sin v          v ∈ [-π/2, +π/2]
 *
 * The equator (v = 0) reproduces the silhouette exactly and the two poles on
 * the look axis close the body, so a circle lofts into a real sphere, a star
 * into a star-cushion and a rounded triangle into a pillow solid. Nothing is
 * drawn as a flat path, and every body changes its outline when the head
 * turns — the old "flat pie" came from stroking the contour and calling it 3D.
 *
 * Shading uses smooth (area-weighted, averaged) vertex normals, so no facet
 * edge is ever visible:
 *   · a key light locked to the BODY, so the gloss travels across the surface
 *     as it rotates — the only cue that a round body is a ball, not a disc;
 *   · a soft Blinn sheen on top of the diffuse ramp;
 *   · a view-space Fresnel rim, which brightens the silhouette edge and is
 *     what separates the body from the panel behind it.
 * Back faces are culled by their outward normal, so the visible half of the
 * mesh costs about half of what painting the whole shell would.
 */
import {
  GROK_BALL_SHAPES,
  radialLookupOf,
  type GrokBallShapeId,
  type RadiusLookup,
} from "./grok-ball-model.js";

export type Vec3 = readonly [number, number, number];

const TAU = Math.PI * 2;

/** viewBox px per model unit: the silhouettes are drawn around a 34 px body. */
const UNIT = 34;

export interface Mesh {
  readonly vertices: ReadonlyArray<Vec3>;
  /** Index triples/quads, wound so the outward normal faces the viewer. */
  readonly faces: ReadonlyArray<readonly number[]>;
  /** One smooth unit normal per vertex, in model space. */
  readonly normals: ReadonlyArray<Vec3>;
}

export interface Solid {
  readonly mesh: Mesh;
  /** Silhouette radius in model units, so the eyes can sit on the surface. */
  readonly radiusAt: RadiusLookup;
  /**
   * A dense point cloud of the shell (model units), used to reduce the rotated
   * body to its silhouette. Far denser than `mesh`, because the outline is read
   * off it per angle bucket and a sparse cloud scallops at the seams.
   */
  readonly cloud: ReadonlyArray<readonly [number, number, number]>;
  readonly maxRadius: number;
  /** Half-depth along the look axis, in model units. */
  readonly depth: number;
}

export interface ProjectedFace {
  readonly d: string;
  /** Diffuse ramp, ~0.5 (terminator) → ~1.07 (lit). */
  readonly shade: number;
  /** Blinn sheen, 0..1. */
  readonly gloss: number;
  /** Fresnel rim, 0..1. */
  readonly rim: number;
  readonly depth: number;
}

export interface Projection {
  readonly yaw: number;
  readonly pitch: number;
  /** Optional body roll (a thinking head tips; see GROK_BALL_STATE_FRAMES). */
  readonly roll?: number;
  readonly scale: number;
}

interface Lod {
  readonly segU: number;
  readonly segV: number;
}

/**
 * Tessellation follows the pixels actually available.
 *
 * The body is painted as one silhouette, so extra arcs cost a loop over the
 * shell, not a path per face — enough of them that the outline never shows the
 * grid, even in a chat list where many balls animate at once.
 */
export function solidLodFor(pixelSize: number): Lod {
  if (pixelSize <= 30) {
    return { segU: 28, segV: 8 };
  }
  if (pixelSize <= 56) {
    return { segU: 36, segV: 10 };
  }
  return { segU: 46, segV: 13 };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Loft a silhouette into a closed solid.
 *
 * Winding is derived from the parameterization (∂θ × ∂φ points outward), so the
 * renderer can cull back faces instead of guessing, and vertex normals stay
 * consistent across the whole shell.
 */
function loftMesh(
  radiusAt: RadiusLookup,
  segU: number,
  segV: number,
  depth: number,
): Mesh {
  const vertices: Vec3[] = [[0, 0, -depth]];
  for (let v = 1; v < segV; v++) {
    const phi = (v / segV) * Math.PI - Math.PI / 2;
    const squash = Math.cos(phi);
    const z = depth * Math.sin(phi);
    for (let u = 0; u < segU; u++) {
      const theta = (u / segU) * TAU;
      const r = radiusAt(theta) * squash;
      vertices.push([r * Math.cos(theta), r * Math.sin(theta), z]);
    }
  }
  const frontPole = vertices.length;
  vertices.push([0, 0, depth]);

  const ring = (v: number, u: number): number =>
    (v - 1) * segU + ((u % segU + segU) % segU) + 1;

  const faces: number[][] = [];
  for (let u = 0; u < segU; u++) {
    faces.push([0, ring(1, u + 1), ring(1, u)]);
  }
  for (let v = 1; v < segV - 1; v++) {
    for (let u = 0; u < segU; u++) {
      faces.push([ring(v, u), ring(v, u + 1), ring(v + 1, u + 1), ring(v + 1, u)]);
    }
  }
  for (let u = 0; u < segU; u++) {
    faces.push([frontPole, ring(segV - 1, u), ring(segV - 1, u + 1)]);
  }

  // Area-weighted accumulation: a vertex shared by a big lit quad and a small
  // shaded one leans toward the big one, which is what keeps the terminator
  // smooth instead of creased.
  const sums = vertices.map((): [number, number, number] => [0, 0, 0]);
  for (const face of faces) {
    const a = vertices[face[0]!]!;
    const b = vertices[face[1]!]!;
    const c = vertices[face[2]!]!;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const index of face) {
      const slot = sums[index]!;
      slot[0] += nx;
      slot[1] += ny;
      slot[2] += nz;
    }
  }
  const normals: Vec3[] = sums.map(
    ([x, y, z]): Vec3 => (x === 0 && y === 0 && z === 0 ? [0, 0, 1] : normalize([x, y, z])),
  );
  return { vertices, faces, normals };
}

const solidCache = new Map<string, Solid>();

/** Build (or reuse) the solid for a shape at a given tessellation. */
export function buildSolid(shape: GrokBallShapeId, lod: Lod = solidLodFor(96)): Solid {
  const key = `${shape}|${lod.segU}|${lod.segV}`;
  const cached = solidCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const definition = GROK_BALL_SHAPES[shape];
  // Contour points live in the 100×100 local space; /UNIT puts them in model
  // units so every solid shares one projection scale.
  const lookup = radialLookupOf(definition.points);
  const radiusAt = (theta: number): number => lookup(theta) / UNIT;
  let maxRadius = 0;
  for (let i = 0; i < 240; i++) {
    maxRadius = Math.max(maxRadius, radiusAt((i / 240) * TAU));
  }
  const plump = definition.plump ?? 0.75;
  const depth = maxRadius * plump;
  // The silhouette cloud: the same loft, sampled finely enough that every
  // angle bucket sees several latitudes and the outline cannot step.
  const cloud: Array<[number, number, number]> = [];
  for (let v = 0; v <= CLOUD_SEGS_V; v++) {
    const phi = (v / CLOUD_SEGS_V) * Math.PI - Math.PI / 2;
    const squash = Math.cos(phi);
    const z = depth * Math.sin(phi);
    for (let u = 0; u < CLOUD_SEGS_U; u++) {
      const theta = (u / CLOUD_SEGS_U) * TAU;
      const r = radiusAt(theta) * squash;
      cloud.push([r * Math.cos(theta), r * Math.sin(theta), z]);
    }
  }
  const solid: Solid = {
    mesh: loftMesh(radiusAt, lod.segU, lod.segV, depth),
    radiusAt,
    cloud,
    maxRadius,
    depth,
  };
  solidCache.set(key, solid);
  return solid;
}

/** Mesh-only view of the solid, for callers that do not need the surface. */
export function buildMesh(shape: GrokBallShapeId, lod?: Lod): Mesh {
  return buildSolid(shape, lod).mesh;
}

/**
 * z of the front shell above a point of the front view.
 *
 * The eye anchors use this so the eyes ride the surface: they slide toward the
 * limb and flatten as the body turns, instead of floating over a sticker.
 */
export function surfaceFrontZ(solid: Solid, x: number, y: number): number {
  const rho = Math.hypot(x, y);
  const r = solid.radiusAt(Math.atan2(y, x));
  const k = Math.min(0.97, rho / Math.max(r, 1e-6));
  return solid.depth * Math.sqrt(Math.max(0.04, 1 - k * k));
}

/**
 * Key light, in BODY space: upper-left and slightly forward.
 *
 * Keeping it in body space (rather than screen space) is deliberate — a light
 * that stays put while the head turns produces a shading pattern that never
 * moves, and a ball whose shading never moves reads as a painted disc.
 */
const LIGHT_BODY: Vec3 = normalize([-0.4, -0.52, 0.75]);

/**
 * Camera distance in model units. +z is toward the viewer, so a nearer point
 * must project LARGER: the divide is `P - z`. (An earlier `P + z` inverted
 * this and made the near limb shrink, which is what let a sphere's outline
 * swell past the slot as it turned.) It is kept far away on purpose: the
 * pseudo-3D read comes from the gloss and the silhouette, not from a strong
 * perspective that would break the fixed-size slots in the sidebar.
 */
const PERSPECTIVE = 6;

function rotation(cosY: number, sinY: number, cosP: number, sinP: number, cosR: number, sinR: number) {
  return (v: Vec3): Vec3 => {
    const [x, y, z] = v;
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;
    const y2 = y * cosP - z1 * sinP;
    const z2 = y * sinP + z1 * cosP;
    return [x1 * cosR - y2 * sinR, x1 * sinR + y2 * cosR, z2];
  };
}

/** Depth factor of a view-space point: 1 at the body centre, > 1 in front. */
function depthFactor(z: number): number {
  return PERSPECTIVE / Math.max(PERSPECTIVE - z, 0.4);
}

function project(v: Vec3, scale: number): [number, number] {
  const f = depthFactor(v[2]);
  return [50 + v[0] * scale * f, 50 + v[1] * scale * f];
}

/** Rotate the shell, cull the back faces, shade the rest, sort near-to-far. */
export function projectMesh(mesh: Mesh, projection: Projection): ProjectedFace[] {
  const { yaw, pitch, scale } = projection;
  const roll = projection.roll ?? 0;
  const rotate = rotation(
    Math.cos(yaw),
    Math.sin(yaw),
    Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(roll),
    Math.sin(roll),
  );
  const points = mesh.vertices.map(rotate);
  const normals = mesh.normals.map(rotate);
  // The light rides the body: turning the head carries the gloss with it.
  const light = rotate(LIGHT_BODY);
  // Half vector for the Blinn term: the viewer sits at +z.
  const half = normalize([light[0], light[1], light[2] + 1]);

  const faces: ProjectedFace[] = [];
  for (const face of mesh.faces) {
    let nz = 0;
    let nx = 0;
    let ny = 0;
    let depth = 0;
    for (const index of face) {
      const n = normals[index]!;
      nx += n[0];
      ny += n[1];
      nz += n[2];
      depth += points[index]![2];
    }
    depth /= face.length;
    // Outward normal already points away from the viewer on the far half.
    if (nz <= 0) {
      continue;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const diffuse = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
    const facing = nx * half[0] + ny * half[1] + nz * half[2];
    const gloss = facing > 0 ? facing ** 16 : 0;
    const rim = (1 - nz) ** 2.4;
    let path = "";
    for (let i = 0; i < face.length; i++) {
      const [px, py] = project(points[face[i]!]!, scale);
      path += `${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`;
    }
    faces.push({
      d: `${path}Z`,
      shade: 0.5 + 0.57 * diffuse,
      gloss,
      rim,
      depth,
    });
  }
  // +z is toward the camera: paint the far shell first, then the near one.
  faces.sort((p, q) => p.depth - q.depth);
  return faces;
}

/** Transform a point on the model into screen space (eyes, gloss anchor). */
export function projectPoint(
  v: Vec3,
  projection: Projection,
): { x: number; y: number; z: number; s: number } {
  const { yaw, pitch, scale } = projection;
  const roll = projection.roll ?? 0;
  const rotate = rotation(
    Math.cos(yaw),
    Math.sin(yaw),
    Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(roll),
    Math.sin(roll),
  );
  const r = rotate(v);
  const [x, y] = project(r, scale);
  return { x, y, z: r[2], s: depthFactor(r[2]) };
}

const SILHOUETTE_SLOTS = 96;
/** Latitude rings and longitude samples of the silhouette point cloud. */
const CLOUD_SEGS_U = 128;
const CLOUD_SEGS_V = 16;

/**
 * The body outline at a pose, as 96 samples about (50, 50).
 *
 * The shell is sampled densely (see `Solid.cloud`), rotated, and reduced per
 * angle bucket to the furthest projected point — which is what the silhouette
 * of a star-shaped body actually is.
 *
 * A tempting shortcut that is NOT correct, and was here until it waisted every
 * rectangular body: maximise `p·û` over the surface (the support function) and
 * plot that value as a radius. The support function is the distance to the
 * tangent line perpendicular to û; it equals the radial distance only for a
 * circle. Plotting it as a radius balloons a square on its diagonals and pinches
 * it on its edges — precisely the "peanut" the cylinder and the arch showed.
 *
 * Perspective is left out deliberately: the body sits on the view axis, so it
 * is a second-order effect, and applying it per point made the apparent size
 * drift with rotation.
 */
export function projectSilhouette(
  solid: Solid,
  projection: Projection,
): Array<[number, number]> {
  const { yaw, pitch, scale } = projection;
  const roll = projection.roll ?? 0;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const cosR = Math.cos(roll);
  const sinR = Math.sin(roll);
  const slots = SILHOUETTE_SLOTS;
  const reach = new Array<number>(slots).fill(0);
  for (const [x, y, z] of solid.cloud) {
    // yaw about the vertical axis, pitch about the horizontal one, roll in the
    // view plane — the same order the rest of the module uses.
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;
    const y2 = y * cosP - z1 * sinP;
    const px = (x1 * cosR - y2 * sinR) * scale;
    const py = (x1 * sinR + y2 * cosR) * scale;
    const rho = Math.hypot(px, py);
    const slot =
      Math.round((Math.atan2(py, px) / TAU) * slots + slots) % slots;
    if (rho > reach[slot]!) {
      reach[slot] = rho;
    }
  }
  // One pass across the bucket seams: neighbouring buckets may catch their
  // furthest sample from a slightly different latitude, which would step.
  const smoothed = reach.map((value, i) =>
    (reach[(i - 1 + slots) % slots]! + value * 2 + reach[(i + 1) % slots]!) / 4,
  );
  const points: Array<[number, number]> = [];
  for (let i = 0; i < slots; i++) {
    const u = (i / slots) * TAU;
    const rho = smoothed[i]!;
    points.push([50 + Math.cos(u) * rho, 50 + Math.sin(u) * rho]);
  }
  return points;
}

/**
 * Where a horizontal line crosses the body: `[left, right]` in viewBox px.
 *
 * The eyes are clamped with this so they can never leave the silhouette,
 * however the outline deforms — the detail that stops a wrapped eye from
 * floating outside the body while it turns.
 */
export function spanAtY(
  ring: ReadonlyArray<readonly [number, number]>,
  y: number,
  centre = 50,
): [number, number] {
  let left = -Infinity;
  let right = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (a[1] <= y === b[1] <= y) {
      continue;
    }
    const x = a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
    if (x <= centre) {
      left = Math.max(left, x);
    } else {
      right = Math.min(right, x);
    }
  }
  return [Number.isFinite(left) ? left : centre, Number.isFinite(right) ? right : centre];
}

/**
 * Where the body-locked key light would sit on the front shell, in screen
 * space. The shipped avatar is one flat colour and paints no highlight, so this
 * exists for the structure/debug view that shows the body is a solid.
 */
export function glossAnchor(
  solid: Solid,
  projection: Projection,
): { x: number; y: number; strength: number } {
  const light = LIGHT_BODY;
  const azimuth = Math.atan2(light[1], light[0]);
  const radial = Math.hypot(light[0], light[1]);
  const r = solid.radiusAt(azimuth);
  const denominator = Math.sqrt(
    (radial * radial) / Math.max(r * r, 1e-6) + (light[2] * light[2]) / Math.max(solid.depth * solid.depth, 1e-6),
  );
  const lambda = 1 / Math.max(denominator, 1e-6);
  const point: Vec3 = [light[0] * lambda, light[1] * lambda, light[2] * lambda];
  const p = projectPoint(point, projection);
  return { x: p.x, y: p.y, strength: Math.max(0, p.z) };
}
