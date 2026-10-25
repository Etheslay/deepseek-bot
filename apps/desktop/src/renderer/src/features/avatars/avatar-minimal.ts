/** Minimal avatar shapes: rounded polygons and soft organic silhouettes. */
export type MinimalShape = {
  id: string;
  path: string;
  eyeY?: number;
};

const CENTER = 50;
const RADIUS = 46;

function n(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function polygonPoints(
  sides: number,
  rotationDeg: number,
  outer = RADIUS,
  inner?: number,
): [number, number][] {
  const count = inner === undefined ? sides : sides * 2;
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const radius = inner === undefined || i % 2 === 0 ? outer : inner;
    const angle = ((rotationDeg + (360 / count) * i - 90) * Math.PI) / 180;
    points.push([CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius]);
  }
  return points;
}

/** Rounds every corner of a polygon with a quadratic curve. */
function roundedPath(points: [number, number][], k = 0.18): string {
  const count = points.length;
  const point = (i: number): [number, number] => points[(i + count) % count]!;
  const toward = (from: [number, number], to: [number, number]): [number, number] => [
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
  ];

  const start = toward(point(0), point(1));
  let d = `M ${n(start[0])} ${n(start[1])}`;
  for (let i = 1; i < count; i++) {
    const vertex = point(i);
    const next = toward(vertex, point(i + 1));
    const previous = toward(vertex, point(i - 1));
    d += ` L ${n(previous[0])} ${n(previous[1])} Q ${n(vertex[0])} ${n(vertex[1])} ${n(next[0])} ${n(next[1])}`;
  }
  const first = point(0);
  const firstNext = toward(first, point(1));
  const firstPrevious = toward(first, point(count - 1));
  d += ` L ${n(firstPrevious[0])} ${n(firstPrevious[1])} Q ${n(first[0])} ${n(first[1])} ${n(firstNext[0])} ${n(firstNext[1])} Z`;
  return d;
}

const circlePath =
  "M 50 4 A 46 46 0 1 1 49.99 4 Z";

const ovalPath =
  "M 50 8 C 72 8 94 26 94 50 C 94 74 72 92 50 92 C 28 92 6 74 6 50 C 6 26 28 8 50 8 Z";

const eggPath =
  "M 50 6 C 70 6 86 26 86 50 C 86 76 70 94 50 94 C 30 94 14 76 14 50 C 14 26 30 6 50 6 Z";

const cloudPath =
  "M 28 74 C 12 74 4 62 8 50 C 12 38 24 34 32 38 C 34 24 46 14 58 18 C 70 20 78 30 78 40 C 90 42 96 52 92 62 C 88 74 76 78 64 76 C 54 84 38 84 28 74 Z";

const pebblePath =
  "M 30 20 C 48 4 76 10 88 30 C 100 50 92 78 72 88 C 52 98 24 90 12 70 C 0 50 12 36 30 20 Z";

const dropPath =
  "M 50 6 C 58 20 84 44 84 62 C 84 82 68 94 50 94 C 32 94 16 82 16 62 C 16 44 42 20 50 6 Z";

const pillPath =
  "M 22 28 H 78 C 90 28 94 38 94 50 C 94 62 90 72 78 72 H 22 C 10 72 6 62 6 50 C 6 38 10 28 22 28 Z";

export const MINIMAL_SHAPES: MinimalShape[] = [
  { id: "circle", path: circlePath },
  { id: "squircle", path: roundedPath(polygonPoints(4, -45), 0.32) },
  { id: "soft-square", path: roundedPath(polygonPoints(4, -45), 0.18) },
  { id: "triangle", path: roundedPath(polygonPoints(3, 0), 0.2), eyeY: 58 },
  { id: "diamond", path: roundedPath(polygonPoints(4, 0), 0.24), eyeY: 50 },
  { id: "hexagon", path: roundedPath(polygonPoints(6, 0), 0.18), eyeY: 50 },
  { id: "star", path: roundedPath(polygonPoints(5, 0, 46, 22), 0.16), eyeY: 48 },
  { id: "flower", path: roundedPath(polygonPoints(8, 0, 46, 32), 0.14), eyeY: 50 },
  { id: "pentagon", path: roundedPath(polygonPoints(5, 0), 0.2), eyeY: 50 },
  { id: "oval", path: ovalPath },
  { id: "egg", path: eggPath, eyeY: 48 },
  { id: "cloud", path: cloudPath, eyeY: 52 },
  { id: "pebble", path: pebblePath, eyeY: 52 },
  { id: "drop", path: dropPath, eyeY: 54 },
  { id: "pill", path: pillPath, eyeY: 50 },
];

export const MINIMAL_COLORS = [
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
