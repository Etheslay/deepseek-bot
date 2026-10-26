/**
 * Grok Ball avatar.
 *
 * Four rules, learned from studying how the well-made desktop characters of
 * this kind pull it off (see docs/THIRD_PARTY_NOTICES.md — the behaviour was
 * re-implemented here, not copied):
 *
 *   1. The body is ONE flat fill. No gradient, no facets, no darkened side: the
 *      avatar must read as exactly the colour of its swatch. Volume is never
 *      bought with tone.
 *   2. The three-dimensionality is geometric. The outline is the silhouette of
 *      a solid of revolution re-derived at the current yaw (`grok-ball-3d.ts`),
 *      so a turn changes the SHAPE — which is what a flat cut-out cannot do.
 *   3. The eyes are decals on that solid: they wrap the body's cylinder at
 *      their own latitude, foreshorten as they near the limb, are clamped
 *      inside the live outline and slide off the edge instead of popping.
 *   4. Idle is nearly still. A ball that keeps swivelling reads as nervous, not
 *      alive: idle gets a slow ±1.5° sway, a sub-pixel drift and a ~1 % breath,
 *      and the gaze holds the centre. Real turns belong to thinking, working
 *      and pointer-follow.
 */
import { useEffect, useMemo, useRef, type CSSProperties, type JSX, type RefObject } from "react";
import {
  GROK_BALL_SHAPES,
  GROK_BALL_SIZES,
  GROK_BALL_STATE_FRAMES,
  contourPath,
  interpolateStateFrame,
  isStaticVariant,
  toneKeyFor,
  type GrokBallShapeId,
  type GrokBallState,
  type GrokBallVariant,
  type StateFrame,
} from "./grok-ball-model.js";
import {
  buildSolid,
  projectSilhouette,
  solidLodFor,
  spanAtY,
  type Projection,
  type Solid,
} from "./grok-ball-3d.js";

export type { GrokBallVariant };
export { GROK_BALL_SIZES };

const MORPH_MS = 260;
/** Body radius in viewBox units; the silhouettes are drawn around 34. */
const BODY_R = 34;
/** Gaze authority, in degrees: a full deflection is a glance, not a spin. */
const TURN_GAIN = 14;
const TILT_GAIN = 8;
/**
 * Idle life. Two incommensurate sines keep the sway from looking like a
 * metronome; everything is under a degree and a pixel on purpose.
 */
const IDLE_SPIN_A = 1.1;
const IDLE_SPIN_B = 0.45;
const IDLE_SPIN_WA = 0.42;
const IDLE_SPIN_WB = 0.13;
const IDLE_TX = 0.8;
const IDLE_TX_W = 0.23;
const IDLE_TY = 1;
const IDLE_TY_W = 0.7;
const IDLE_SQUASH = 0.009;
/**
 * How wide the per-ball phase spread is, in seconds. It has to exceed the
 * slowest idle cycle (the 0.13 rad/s roll, ~48 s) so no two balls can share a
 * beat.
 */
const IDLE_PHASE_SPAN_S = 60;
/** Resting eye height multiplier (taller eyes read better at small sizes). */
const EYE_OPEN_STRETCH = 1.16;
/**
 * Per-state gaze and blink windows. `x` / `y` are fractions of the ±14° / ±8°
 * authority, so a state decides *where* the character looks and how often it
 * re-decides — and idle decides to look straight ahead.
 */
type GazeProfile = {
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  readonly hold: readonly [number, number];
  readonly blink: readonly [number, number];
};
const GAZE_BY_STATE: Record<GrokBallState, GazeProfile> = {
  // Straight ahead, held. The ball is resting, not scanning the room.
  idle: { x: [0, 0], y: [0, 0], hold: [3200, 6400], blink: [5200, 12500] },
  // Away and upward: the classic "thinking" look, re-picked every couple of s.
  thinking: { x: [0.45, 0.95], y: [-0.95, -0.4], hold: [1700, 3000], blink: [3400, 6800] },
  // Down at the work, small side to side.
  working: { x: [-0.35, 0.35], y: [0.35, 0.9], hold: [1400, 2600], blink: [2600, 5200] },
  // Attentive: almost centred, a hair of drift.
  waiting: { x: [-0.25, 0.25], y: [-0.2, 0.2], hold: [2400, 4600], blink: [3000, 6600] },
  // Side-eyed at whatever is blocking it.
  blocked: { x: [0.85, 1], y: [0.2, 0.35], hold: [2400, 4600], blink: [3400, 6800] },
  // Bright and slightly lifted.
  done: { x: [-0.6, 0.6], y: [-0.55, 0], hold: [2000, 3600], blink: [2400, 4800] },
};
/**
 * The pose is repainted only once it has moved by a visible amount (or after a
 * safety interval), so a still idle ball costs almost nothing in a long chat.
 */
const MESH_EPS_POSE = 0.004;
const MESH_FORCE_MS = 400;
/**
 * Gaze spring: stiffness 13, damping 1 (critically damped, no bounce). A spring
 * rather than a low-pass filter, because a glance has to *arrive* — an
 * exponential ease never quite gets there and reads as floaty.
 */
const GAZE_FREQ = 13;
const GAZE_DAMP = 1;
/**
 * Pointer → gaze, mapped onto an ellipse instead of a square: the horizontal
 * authority is wider than the vertical one (a character glances sideways more
 * than it gapes up and down) and the distance is square-root compressed, so a
 * cursor at the far corner does not slam the gaze to its limit.
 */
const POINTER_REACH = 0.6;
const POINTER_ASPECT = 1.57;
/**
 * Standing micro-shimmer, in viewBox px, per eye and out of phase. The body is
 * allowed to be still; the face is never quite dead.
 */
const SHIMMER_X_A = 0.9;
const SHIMMER_X_B = 0.35;
const SHIMMER_Y = 0.5;
/**
 * Idle tricks. A character that is *always* moving is twitchy; one that is
 * occasionally doing something distinct is alive. So the first trick lands a
 * few seconds after mount and the next one 9–18 s after that — rare enough that
 * each one reads as an event.
 *
 * A spin is also the one moment the body's real geometry is fully on display:
 * the outline is re-projected from the solid every frame, so a full turn
 * visibly changes the silhouette instead of sliding a sticker around.
 */
const TRICK_FIRST_MS: readonly [number, number] = [2500, 5000];
const TRICK_GAP_MS: readonly [number, number] = [9000, 18000];
/** Landing bounce: successive hops, each shorter and quicker than the last. */
const HOP_SEGS: ReadonlyArray<{ h: number; d: number }> = [
  { h: 44, d: 0.48 },
  { h: 23, d: 0.34 },
  { h: 10, d: 0.24 },
  { h: 4, d: 0.17 },
];
const HOP_TOTAL_MS =
  HOP_SEGS.reduce((sum, seg) => sum + seg.d, 0) * 1000;
/** One full turn, eased in and out, then the landing hop. */
const SPIN_MS = 760;

type Trick = { kind: "spin" | "hop"; start: number };

/** Height of the decaying bounce at `elapsed` ms, or null once it has ended. */
export function hopOffset(elapsed: number): number | null {
  if (elapsed < 0 || elapsed >= HOP_TOTAL_MS) {
    return null;
  }
  let acc = 0;
  for (const seg of HOP_SEGS) {
    const duration = seg.d * 1000;
    if (elapsed < acc + duration) {
      const t = (elapsed - acc) / duration;
      // A parabola that starts and ends at zero: the apex is the hop height.
      // The `=== 0` guard normalises -0, which the negation below would
      // otherwise leak into the transform string.
      const height = -4 * seg.h * t * (1 - t);
      return height === 0 ? 0 : height;
    }
    acc += duration;
  }
  return 0;
}

/** Progress of a spin in [0,1], or null once it is over. */
export function spinPhase(elapsed: number): number | null {
  if (elapsed < 0 || elapsed >= SPIN_MS) {
    return null;
  }
  const t = elapsed / SPIN_MS;
  // Smoothstep: it has to leave and arrive at zero angular velocity, or the
  // turn looks like a slideshow cut rather than a flick.
  return t * t * (3 - 2 * t);
}

type Spring = { x: number; v: number; t: number };

function stepSpring(s: Spring, freq: number, damp: number, dt: number): void {
  s.v += (-2 * damp * freq * s.v - freq * freq * (s.x - s.t)) * dt;
  s.x += s.v * dt;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) {
    s.x = s.t;
    s.v = 0;
  }
}

function pointerGaze(pointer: { x: number; y: number }): { x: number; y: number } {
  const distance = Math.hypot(pointer.x, pointer.y);
  const reach = Math.min(1, Math.sqrt(distance / 2)) * POINTER_REACH;
  const angle = Math.atan2(pointer.y, pointer.x);
  return {
    x: Math.max(-1, Math.min(1, Math.cos(angle) * reach * POINTER_ASPECT)),
    y: Math.max(-1, Math.min(1, -Math.sin(angle) * reach)),
  };
}

type GrokBallProps = {
  /** Explicit pixel size; overrides the variant preset when provided. */
  size?: number | undefined;
  /** Fixed-slot role: sets a default size and whether the ball is animated. */
  variant?: GrokBallVariant;
  shape?: GrokBallShapeId;
  /** Hex color, or `"mono"` for the theme-aware black/white ball. */
  color?: string;
  state?: GrokBallState;
  /** Force animation on/off; defaults to true except for the inline variant. */
  motion?: boolean | undefined;
  /** Live pointer gaze (-1..1); overrides the idle glances while non-null. */
  gazeSource?: { readonly current: { x: number; y: number } | null } | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
};

function isMono(color: string): boolean {
  return color === "mono";
}

function eyePathFromFrame(frame: StateFrame["left"]): string {
  return contourPath(frame.points);
}

const DEG = Math.PI / 180;

const rand = (range: readonly [number, number]): number =>
  range[0] + Math.random() * (range[1] - range[0]);

/**
 * The body: the projected silhouette of the solid, filled with one pure colour.
 *
 * A round-joined stroke in the same colour closes the last half-pixel of
 * tessellation faceting without introducing a second tone.
 */
function bodyMarkup(projection: Projection, solid: Solid, fill: string): string {
  const outline = contourPath(projectSilhouette(solid, projection));
  return `<path d="${outline}" fill="${fill}" stroke="${fill}" stroke-width="1" stroke-linejoin="round"/>`;
}

export function GrokBall({
  size,
  variant = "preview",
  shape = "blob",
  color = "mono",
  state = "idle",
  motion,
  gazeSource,
  className,
  style,
}: GrokBallProps): JSX.Element {
  const pixelSize = size ?? GROK_BALL_SIZES[variant];
  const animate = motion ?? !isStaticVariant(variant);
  const mono = isMono(color);
  const definition = GROK_BALL_SHAPES[shape];
  const lod = useMemo(() => solidLodFor(pixelSize), [pixelSize]);
  const solid = useMemo(() => buildSolid(shape, lod), [shape, lod]);

  const stageRef = useRef<SVGGElement | null>(null);
  const meshGroupRef = useRef<SVGGElement | null>(null);
  const leftEyeGroupRef = useRef<SVGGElement | null>(null);
  const rightEyeGroupRef = useRef<SVGGElement | null>(null);
  const leftEyePathRef = useRef<SVGPathElement | null>(null);
  const rightEyePathRef = useRef<SVGPathElement | null>(null);
  const auraRef = useRef<SVGCircleElement | null>(null);

  const frameRef = useRef<StateFrame>(GROK_BALL_STATE_FRAMES[state]);
  const targetFrameRef = useRef<StateFrame>(GROK_BALL_STATE_FRAMES[state]);
  const morphRef = useRef<{ start: number; from: StateFrame } | null>(null);

  const gazeXRef = useRef<Spring>({ x: 0, v: 0, t: 0 });
  const gazeYRef = useRef<Spring>({ x: 0, v: 0, t: 0 });
  const nextGazeRef = useRef(0);
  const blinkRef = useRef({ value: 0, velocity: 0, target: 0, next: 0 });
  const burstRef = useRef<{ start: number } | null>(null);
  const stateRef = useRef<GrokBallState>(state);
  const paintedRef = useRef<{ yaw: number; pitch: number; at: number } | null>(null);
  const ringRef = useRef<Array<[number, number]> | null>(null);
  const trickRef = useRef<Trick | null>(null);
  const nextTrickRef = useRef(0);
  const trickOutRef = useRef<{ spin: number; hop: number }>({ spin: 0, hop: 0 });
  const reducedMotionRef = useRef(false);
  /** First frame error, kept so the console sees exactly one report per ball. */
  const frameErrorRef = useRef<unknown>(null);
  const mountedAtRef = useRef(performance.now());
  /**
   * This ball's offset into the idle cycle, in seconds.
   *
   * Every sidebar ball mounts in the same frame, so a clock that starts at
   * `performance.now()` puts them all at the same point of the sway and breath
   * sines — and a row of bots that all rock and turn on the same beat looks
   * eerie, not lively. Each instance draws its own offset once, which is what
   * makes them feel like separate creatures sharing a room.
   */
  const phaseRef = useRef(Math.random() * IDLE_PHASE_SPAN_S);

  // Eye band, in model units: centred unless the shape offsets it.
  const eyeOffsetX = (definition.eyeX ?? 0) / BODY_R;
  const eyeY = (definition.eyeY - 50) / BODY_R;
  const eyeHalf = Math.min(0.42, (definition.eyeSpacing ?? 22) / 2 / BODY_R);

  const render = (now: number): void => {
    // Offset by this ball's own phase: the sway, drift and breath of two balls
    // must never line up, or the sidebar reads as one puppet on a string.
    const t = (now - mountedAtRef.current) / 1000 + phaseRef.current;
    const turn = gazeXRef.current.x * TURN_GAIN;
    const tilt = gazeYRef.current.x * TILT_GAIN;
    // Idle life: two slow sines for the roll, a sub-pixel drift, a shallow breath.
    const spin =
      Math.sin(t * IDLE_SPIN_WA) * IDLE_SPIN_A + Math.sin(t * IDLE_SPIN_WB) * IDLE_SPIN_B;
    const tx = Math.sin(t * IDLE_TX_W) * IDLE_TX;
    const ty = Math.sin(t * IDLE_TY_W) * IDLE_TY + trickOutRef.current.hop;
    const squash = 1 + Math.sin(t * IDLE_TY_W) * IDLE_SQUASH;
    // A trick's spin rides on top of the gaze turn: the outline is re-projected
    // from the solid every frame, so this is the moment the body's geometry is
    // fully on display — a real silhouette for a full 360°, not a sticker.
    const yaw = turn * DEG + trickOutRef.current.spin * Math.PI * 2;
    const pitch = tilt * DEG;

    const stage = stageRef.current;
    if (stage !== null) {
      stage.setAttribute(
        "transform",
        `translate(${(50 + tx).toFixed(2)} ${(50 + ty).toFixed(2)}) rotate(${spin.toFixed(
          2,
        )}) scale(${(1 / squash).toFixed(4)} ${squash.toFixed(4)}) translate(-50 -50)`,
      );
    }

    const group = meshGroupRef.current;
    if (group !== null) {
      const painted = paintedRef.current;
      const stale = painted === null || now - painted.at > MESH_FORCE_MS;
      const moved =
        painted === null ||
        Math.abs(painted.yaw - yaw) > MESH_EPS_POSE ||
        Math.abs(painted.pitch - pitch) > MESH_EPS_POSE;
      if (moved || stale) {
        ringRef.current = projectSilhouette(solid, { yaw, pitch, scale: BODY_R });
        group.innerHTML = bodyMarkup(
          { yaw, pitch, scale: BODY_R },
          solid,
          // The tone variable resolves per theme (see styles.css); the literal
          // colour is the fallback for a hex outside the palette.
          mono ? "var(--avatar-mono-bg)" : `var(--gb-body, ${color})`,
        );
        paintedRef.current = { yaw, pitch, at: now };
      }
    }
    // The eyes are clamped to the outline that is actually on screen, so they
    // can never cross the body's edge however the shape morphs. The ring is
    // reused while the pose holds, so a resting ball projects nothing.
    const liveRing = ringRef.current ?? projectSilhouette(solid, { yaw, pitch, scale: BODY_R });
    if (ringRef.current === null) {
      ringRef.current = liveRing;
    }

    const frame = frameRef.current;
    const blink = blinkRef.current;
    let topSpan = Infinity;
    let bottomSpan = -Infinity;
    for (const [, y] of liveRing) {
      if (y < topSpan) {
        topSpan = y;
      }
      if (y > bottomSpan) {
        bottomSpan = y;
      }
    }
    const lid =
      (1 - Math.max(0, Math.min(1, blink.value)) * 0.86) * EYE_OPEN_STRETCH;
    const eyeScale = definition.eyeScale ?? 1;
    const eyes: ReadonlyArray<
      readonly [
        -1 | 1,
        RefObject<SVGGElement | null>,
        RefObject<SVGPathElement | null>,
        StateFrame["left"],
      ]
    > = [
      [-1, leftEyeGroupRef, leftEyePathRef, frame.left],
      [1, rightEyeGroupRef, rightEyePathRef, frame.right],
    ];
    for (const [side, groupRef, pathRef, frameEye] of eyes) {
      const node = groupRef.current;
      if (node === null) {
        continue;
      }
      const restX = eyeOffsetX + side * eyeHalf;
      const restPx = 50 + restX * BODY_R;
      const restPy = 50 + eyeY * BODY_R;
      const [left, right] = spanAtY(liveRing, restPy);
      const centre = (left + right) / 2;
      const radius = Math.max((right - left) / 2, 12);
      // Wrap the eye on the body's cylinder at its own latitude, then turn it.
      const angle = Math.asin(Math.max(-1, Math.min(1, (restPx - centre) / radius)));
      const turned = angle + yaw;
      const cosRest = Math.max(Math.cos(angle), 0.02);
      const cosNow = Math.cos(turned);
      const foreshorten = Math.max(cosNow, 0.02) / cosRest;
      const onSurface = cosNow > 0.02;
      // Smoothstep of the facing term: an eye nearing the limb is dragged
      // along with the edge and fades, instead of disappearing at a threshold.
      const facing = Math.max(0, Math.min(1, cosNow / 0.5));
      const slide = facing * facing * (3 - 2 * facing);
      // The shimmer is added BEFORE the clamp, so a drifting eye can be pushed
      // against the outline but never through it.
      const phase = side === -1 ? 0 : 1;
      const shimmerX =
        Math.sin(now * 0.00042 + phase) * SHIMMER_X_A +
        Math.sin(now * 0.001 + phase * 2) * SHIMMER_X_B;
      const shimmerY = Math.sin(now * 0.00058 + phase) * SHIMMER_Y;
      const x = centre + radius * Math.sin(turned) + shimmerX;
      const half = (frameEye.points.reduce((m, p) => Math.max(m, Math.abs(p[0])), 0) + 1) * eyeScale * foreshorten;
      const clampedX = Math.max(left + half, Math.min(right - half, x));
      const drawX = clampedX + (x - clampedX) * (1 - slide);
      const margin = 4 * eyeScale * lid;
      const drawY = Math.max(
        topSpan + margin,
        Math.min(bottomSpan - margin, restPy + shimmerY),
      );

      node.setAttribute(
        "transform",
        `translate(${drawX.toFixed(2)} ${drawY.toFixed(2)}) scale(${(
          eyeScale * foreshorten
        ).toFixed(3)} ${(eyeScale * lid).toFixed(3)})`,
      );
      node.setAttribute("opacity", onSurface ? slide.toFixed(3) : "0");

      const path = pathRef.current;
      if (path !== null) {
        path.setAttribute("d", eyePathFromFrame(frameEye));
        if (!mono) {
          if (stateRef.current === "idle") {
            path.style.removeProperty("fill");
          } else {
            path.style.fill = frameEye.color;
          }
        }
      }
    }

    const aura = auraRef.current;
    if (aura !== null) {
      if (stateRef.current === "thinking") {
        const dashOffset = (now / 1400) % 1;
        aura.setAttribute("stroke", frame.aura ?? "#60a5fa");
        aura.setAttribute("stroke-dasharray", "5 7");
        aura.setAttribute("stroke-dashoffset", String(dashOffset * 12));
        aura.setAttribute("opacity", "0.65");
        aura.setAttribute("r", "56");
      } else if (stateRef.current === "done" && burstRef.current !== null) {
        const progress = Math.min(1, (now - burstRef.current.start) / 650);
        aura.setAttribute("stroke", frame.aura ?? "#22c55e");
        aura.setAttribute("stroke-dasharray", "none");
        aura.setAttribute("opacity", ((1 - progress) * 0.8).toFixed(3));
        aura.setAttribute("r", (48 + progress * 16).toFixed(2));
      } else {
        aura.setAttribute("opacity", "0");
      }
    }
  };

  useEffect(() => {
    paintedRef.current = null;
    ringRef.current = null;
  }, [shape, mono, color, solid]);

  // Static (inline) avatars: one fixed three-quarter pose, no animation loop.
  useEffect(() => {
    if (animate) {
      return;
    }
    frameRef.current = GROK_BALL_STATE_FRAMES[state];
    targetFrameRef.current = GROK_BALL_STATE_FRAMES[state];
    gazeXRef.current = { x: 0.5, v: 0, t: 0.5 };
    gazeYRef.current = { x: -0.2, v: 0, t: -0.2 };
    blinkRef.current.value = 0;
    render(performance.now());
  }, [animate, state, shape, mono, color, definition, solid]);

  useEffect(() => {
    if (!animate) {
      return;
    }
    if (stateRef.current === state) {
      return;
    }
    const from = frameRef.current;
    targetFrameRef.current = GROK_BALL_STATE_FRAMES[state];
    morphRef.current = { start: performance.now(), from };
    stateRef.current = state;
    gazeXRef.current.t = 0;
    gazeYRef.current.t = 0;
    nextGazeRef.current = performance.now() + rand(GAZE_BY_STATE[state].hold);
    if (state === "done") {
      burstRef.current = { start: performance.now() };
    }
  }, [state, animate]);

  useEffect(() => {
    if (!animate) {
      return;
    }
    let raf = 0;
    let lastTime = performance.now();
    mountedAtRef.current = lastTime;
    reducedMotionRef.current =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    nextTrickRef.current =
      lastTime + rand(TRICK_FIRST_MS) + phaseRef.current * 250;

    const step = (now: number): void => {
      const dt = Math.min(100, now - lastTime);
      lastTime = now;
      const profile = GAZE_BY_STATE[stateRef.current];

      // Pointer tracking wins while hovered. Otherwise the state's own gaze
      // window applies — and in idle that window is exactly (0, 0).
      const pointer = gazeSource?.current ?? null;
      if (pointer !== null) {
        const mapped = pointerGaze(pointer);
        gazeXRef.current.t = mapped.x;
        gazeYRef.current.t = mapped.y;
        nextGazeRef.current = now + 1200;
      } else if (now > nextGazeRef.current) {
        gazeXRef.current.t = Math.sign(Math.random() - 0.5) * rand(profile.x);
        gazeYRef.current.t = Math.sign(Math.random() - 0.5) * rand(profile.y);
        nextGazeRef.current = now + rand(profile.hold);
      }

      const dtSeconds = dt / 1000;
      stepSpring(gazeXRef.current, GAZE_FREQ, GAZE_DAMP, dtSeconds);
      stepSpring(gazeYRef.current, GAZE_FREQ, GAZE_DAMP, dtSeconds);

      // Tricks: rare, and never while the pointer is driving the gaze (a spin
      // would fight the follow) or when the user has asked for less motion.
      const trick = trickRef.current;
      if (trick === null && pointer === null && now > nextTrickRef.current) {
        if (reducedMotionRef.current) {
          nextTrickRef.current = now + rand(TRICK_GAP_MS);
        } else {
          trickRef.current = {
            kind: Math.random() < 0.62 ? "spin" : "hop",
            start: now,
          };
          nextTrickRef.current = now + rand(TRICK_GAP_MS);
        }
      }
      if (trick !== null) {
        const elapsed = now - trick.start;
        const spin = trick.kind === "spin" ? spinPhase(elapsed) : null;
        const hop = hopOffset(trick.kind === "spin" ? elapsed - SPIN_MS : elapsed);
        trickOutRef.current = {
          spin: spin === null ? 0 : spin,
          hop: hop === null ? 0 : hop,
        };
        if (spin === null && hop === null) {
          trickRef.current = null;
          trickOutRef.current = { spin: 0, hop: 0 };
        }
      }

      // Blink spring; suppressed while the pointer drives the gaze so a blink
      // never interrupts the "looking at you" moment.
      const blink = blinkRef.current;
      if (pointer !== null) {
        blink.target = 0;
        blink.next = now + 800;
      } else if (blink.next === 0) {
        blink.next = now + rand(profile.blink);
      } else if (now > blink.next) {
        blink.target = blink.target === 0 ? 1 : 0;
        blink.next =
          blink.target === 1 ? now + 110 : now + rand(profile.blink);
      }
      blink.velocity += (blink.target - blink.value) * 180 * (dt / 1000);
      blink.velocity -= blink.velocity * 22 * (dt / 1000);
      blink.value += blink.velocity * (dt / 1000);
      blink.value = Math.max(-0.05, Math.min(1.08, blink.value));

      // State morph (pointwise eye-ring keyframe interpolation).
      if (morphRef.current !== null) {
        const progress = Math.min(1, (now - morphRef.current.start) / MORPH_MS);
        frameRef.current = interpolateStateFrame(
          morphRef.current.from,
          targetFrameRef.current,
          progress,
        );
        if (progress >= 1) {
          morphRef.current = null;
          frameRef.current = targetFrameRef.current;
        }
      } else {
        frameRef.current = targetFrameRef.current;
      }

      render(now);
    };

    const loop = (now: number): void => {
      try {
        step(now);
      } catch (error) {
        // One bad frame must not freeze the avatar forever: keep scheduling.
        // Report the first failure once — swallowing it silently is how a
        // broken ball ends up shipping as an invisible one.
        if (frameErrorRef.current === null) {
          frameErrorRef.current = error;
          console.error("[grok-ball] frame failed", error);
        }
      } finally {
        raf = requestAnimationFrame(loop);
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animate, mono, color, shape, gazeSource, definition, solid]);

  const rootClass =
    "grok-ball" +
    (mono ? " gb-mono" : "") +
    (variant ? ` gb-${variant}` : "") +
    (className ? ` ${className}` : "");

  const eyeStartX = (side: -1 | 1): number => 50 + (eyeOffsetX + side * eyeHalf) * BODY_R;
  const eyeStartY = 50 + eyeY * BODY_R;

  return (
    <svg
      className={rootClass}
      style={style}
      width={pixelSize}
      height={pixelSize}
      viewBox="0 0 100 100"
      aria-hidden="true"
      data-tone={mono ? "mono" : (toneKeyFor(color) ?? undefined)}
    >
      <g ref={stageRef}>
        <g ref={meshGroupRef} />
        {definition.stem === true && (
          <path
            className="gb-stem"
            d="M49 15 C48 8 51 4 57 3 L59 6 C54 7 52 11 52 15 Z"
            fill="#8b5e3c"
          />
        )}
        <g ref={leftEyeGroupRef} transform={`translate(${eyeStartX(-1)} ${eyeStartY})`}>
          <path
            ref={leftEyePathRef}
            className="gb-eye"
            d={eyePathFromFrame(GROK_BALL_STATE_FRAMES[state].left)}
            style={
              mono || state === "idle"
                ? undefined
                : { fill: GROK_BALL_STATE_FRAMES[state].left.color }
            }
          />
        </g>
        <g ref={rightEyeGroupRef} transform={`translate(${eyeStartX(1)} ${eyeStartY})`}>
          <path
            ref={rightEyePathRef}
            className="gb-eye"
            d={eyePathFromFrame(GROK_BALL_STATE_FRAMES[state].right)}
            style={
              mono || state === "idle"
                ? undefined
                : { fill: GROK_BALL_STATE_FRAMES[state].right.color }
            }
          />
        </g>
      </g>
      <circle
        ref={auraRef}
        cx="50"
        cy="50"
        r="56"
        fill="none"
        stroke="transparent"
        strokeWidth="3"
        opacity="0"
      />
    </svg>
  );
}
