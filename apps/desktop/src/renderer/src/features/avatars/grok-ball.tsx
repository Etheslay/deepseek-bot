/**
 * Grok Ball avatar — solid-geometry renderer (D29 follow-up).
 *
 * The body is a real 3D mesh (sphere / tetrahedron / octahedron / extruded
 * prism built from the 2D contour; see grok-ball-3d.ts). Gaze drives yaw and
 * pitch: turning the head changes the silhouette and which facets catch the
 * fixed upper-left key light, so the avatar reads as a solid, not a disc.
 * Eyes ride the front of the model and blink on a spring.
 */
import { useEffect, useMemo, useRef, type CSSProperties, type JSX, type RefObject } from "react";
import {
  GROK_BALL_SHAPES,
  GROK_BALL_SIZES,
  GROK_BALL_STATE_FRAMES,
  contourPath,
  interpolateStateFrame,
  isStaticVariant,
  type GrokBallShapeId,
  type GrokBallState,
  type GrokBallVariant,
  type StateFrame,
} from "./grok-ball-model.js";
import { buildMesh, projectMesh, projectPoint, type Vec3 } from "./grok-ball-3d.js";

export type { GrokBallVariant };
export { GROK_BALL_SIZES };

const MORPH_MS = 260;
const BREATH_PERIOD_MS = 3600;
const BREATH_AMPLITUDE = 0.014;
const BLINK_MIN_MS = 2000;
const BLINK_MAX_MS = 6000;
const GAZE_TIME_CONSTANT_MS = 105;
/**
 * Time constant while the pointer drives the gaze: the target updates the
 * instant the mouse moves, but the eyes glide over ~1 s (3 tau) so the turn
 * reads as a natural look instead of a jump.
 */
const POINTER_TRACKING_MS = 320;
/** Body radius in viewBox units and the gaze→rotation amplitudes (radians). */
const BODY_R = 34;
const YAW_GAIN = 0.62;
const PITCH_GAIN = 0.34;
/** Resting eye height multiplier (taller eyes read better at small sizes). */
const EYE_OPEN_STRETCH = 1.16;
/** Idle glance targets: up-left, hard left, hard right, straight ahead. */
const GLANCES = [
  { x: -0.75, y: 0.55 },
  { x: -0.95, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: -0.1, y: 0.08 },
] as const;

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

/** hex → HSL so each facet can be re-lighted without a color library. */
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) {
    return null;
  }
  const n = Number.parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

function faceFill(base: Hsl | null, mono: boolean, shade: number): string {
  if (mono || base === null) {
    // Mono balls shade with a black/white overlay instead of HSL math.
    return "var(--avatar-mono-bg)";
  }
  const l = Math.max(8, Math.min(94, base.l * (0.55 + 0.75 * shade)));
  return `hsl(${base.h.toFixed(1)} ${base.s.toFixed(1)}% ${l.toFixed(1)}%)`;
}

function monoOverlay(shade: number): { color: string; opacity: number } {
  if (shade < 0.72) {
    return { color: "#000000", opacity: Math.min(0.6, (0.72 - shade) * 1.15) };
  }
  return { color: "#ffffff", opacity: Math.min(0.5, (shade - 0.72) * 1.4) };
}

/** z of the model surface at an eye anchor, per solid family. */
function eyeSurfaceZ(shape: GrokBallShapeId, x: number, y: number): number {
  switch (shape) {
    case "circle":
    case "blob":
    case "egg":
      return Math.sqrt(Math.max(0.2, 1 - x * x - y * y));
    case "star4":
      return Math.max(0.25, 1 - Math.abs(x) - Math.abs(y));
    case "triangle":
      return 0.5;
    default:
      return 0.23;
  }
}

function meshMarkup(
  shape: GrokBallShapeId,
  yaw: number,
  pitch: number,
  scale: number,
  base: Hsl | null,
  mono: boolean,
): string {
  const faces = projectMesh(buildMesh(shape), { yaw, pitch, scale });
  const parts: string[] = [];
  for (const face of faces) {
    const fill = faceFill(base, mono, face.shade);
    parts.push(`<path d="${face.d}" fill="${fill}" stroke="${fill}" stroke-width="0.5"/>`);
    if (mono || base === null) {
      const overlay = monoOverlay(face.shade);
      if (overlay.opacity > 0.02) {
        parts.push(
          `<path d="${face.d}" fill="${overlay.color}" opacity="${overlay.opacity.toFixed(3)}"/>`,
        );
      }
    }
  }
  return parts.join("");
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
  const baseHsl = useMemo(() => (mono ? null : hexToHsl(color)), [color, mono]);

  const meshGroupRef = useRef<SVGGElement | null>(null);
  const leftEyeGroupRef = useRef<SVGGElement | null>(null);
  const rightEyeGroupRef = useRef<SVGGElement | null>(null);
  const leftEyePathRef = useRef<SVGPathElement | null>(null);
  const rightEyePathRef = useRef<SVGPathElement | null>(null);
  const auraRef = useRef<SVGCircleElement | null>(null);

  const frameRef = useRef<StateFrame>(GROK_BALL_STATE_FRAMES[state]);
  const targetFrameRef = useRef<StateFrame>(GROK_BALL_STATE_FRAMES[state]);
  const morphRef = useRef<{ start: number; from: StateFrame } | null>(null);

  const gazeRef = useRef<{ x: number; y: number }>({ x: -0.2, y: 0.2 });
  const gazeTargetRef = useRef<{ x: number; y: number }>({ x: -0.2, y: 0.2 });
  const nextSaccadeRef = useRef(0);
  const blinkRef = useRef({ value: 0, velocity: 0, target: 0, next: 0 });
  const burstRef = useRef<{ start: number } | null>(null);
  const stateRef = useRef<GrokBallState>(state);

  const eyeY = (definition.eyeY - 50) / BODY_R;
  const eyeX = Math.min(0.42, (definition.eyeSpacing ?? 22) / 2 / BODY_R);

  const render = (now: number): void => {
    const yaw = gazeRef.current.x * YAW_GAIN;
    const pitch = gazeRef.current.y * PITCH_GAIN;
    const breath = 1 + Math.sin((now / BREATH_PERIOD_MS) * Math.PI * 2) * BREATH_AMPLITUDE;
    const scale = BODY_R * breath;

    const group = meshGroupRef.current;
    if (group !== null) {
      group.innerHTML = meshMarkup(shape, yaw, pitch, scale, baseHsl, mono);
    }

    const frame = frameRef.current;
    const blink = blinkRef.current;
    const blinkScale =
      (1 - Math.max(0, Math.min(1, blink.value)) * 0.86) * EYE_OPEN_STRETCH;
    const eyeScale = definition.eyeScale ?? 1;
    const eyes: ReadonlyArray<
      readonly [-1 | 1, RefObject<SVGGElement | null>, RefObject<SVGPathElement | null>, StateFrame["left"]]
    > = [
      [-1, leftEyeGroupRef, leftEyePathRef, frame.left],
      [1, rightEyeGroupRef, rightEyePathRef, frame.right],
    ];
    for (const [side, groupRef, pathRef, frameEye] of eyes) {
      const anchor: Vec3 = [side * eyeX, eyeY, eyeSurfaceZ(shape, eyeX, eyeY)];
      const p = projectPoint(anchor, { yaw, pitch, scale });
      const node = groupRef.current;
      if (node !== null) {
        node.setAttribute(
          "transform",
          `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) scale(${(eyeScale * p.s).toFixed(3)} ${(eyeScale * blinkScale * p.s).toFixed(3)})`,
        );
        node.setAttribute("opacity", p.z > -0.55 ? "1" : "0");
      }
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

  // Static (inline) avatars: one fixed three-quarter pose, no animation loop.
  useEffect(() => {
    if (animate) {
      return;
    }
    frameRef.current = GROK_BALL_STATE_FRAMES[state];
    targetFrameRef.current = GROK_BALL_STATE_FRAMES[state];
    gazeRef.current = { x: 0.2, y: -0.08 };
    blinkRef.current.value = 0;
    render(performance.now());
  }, [animate, state, shape, mono, baseHsl, definition]);

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

    const step = (now: number): void => {
      const dt = Math.min(100, now - lastTime);
      lastTime = now;

      // Pointer tracking wins while hovered; otherwise glance around. The
      // target snaps the moment the mouse moves (no input lag) but the mesh
      // glides toward it with a ~1 s time constant.
      const pointer = gazeSource?.current ?? null;
      if (pointer !== null) {
        gazeTargetRef.current = {
          x: Math.max(-0.9, Math.min(0.9, pointer.x)) * 0.95,
          y: -Math.max(-0.72, Math.min(0.72, pointer.y)) * 0.9,
        };
        nextSaccadeRef.current = now + 1200;
      } else if (now > nextSaccadeRef.current) {
        const glance = GLANCES[Math.floor(Math.random() * GLANCES.length)]!;
        gazeTargetRef.current = {
          x: glance.x + (Math.random() - 0.5) * 0.12,
          y: glance.y + (Math.random() - 0.5) * 0.12,
        };
        nextSaccadeRef.current = now + 1800 + Math.random() * 2600;
      }

      const smoothing =
        1 - Math.exp(-dt / (pointer !== null ? POINTER_TRACKING_MS : GAZE_TIME_CONSTANT_MS));
      gazeRef.current.x += (gazeTargetRef.current.x - gazeRef.current.x) * smoothing;
      gazeRef.current.y += (gazeTargetRef.current.y - gazeRef.current.y) * smoothing;

      // Blink spring; suppressed while the pointer drives the gaze so a
      // blink never interrupts the "looking at you" moment.
      const blink = blinkRef.current;
      if (pointer !== null) {
        blink.target = 0;
        blink.next = now + 800;
      } else if (blink.next === 0) {
        blink.next = now + 1500 + Math.random() * 3500;
      } else if (now > blink.next) {
        blink.target = blink.target === 0 ? 1 : 0;
        blink.next =
          blink.target === 1
            ? now + 110
            : now + BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
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
      } catch {
        // One bad frame must not freeze the avatar forever: keep scheduling.
      } finally {
        raf = requestAnimationFrame(loop);
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animate, mono, shape, baseHsl, gazeSource, definition]);

  const rootClass =
    "grok-ball" +
    (mono ? " gb-mono" : "") +
    (variant ? ` gb-${variant}` : "") +
    (className ? ` ${className}` : "");

  return (
    <svg
      className={rootClass}
      style={style}
      width={pixelSize}
      height={pixelSize}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <ellipse
        className="gb-contact"
        cx="50"
        cy="88"
        rx="22"
        ry="3.6"
        fill="#000000"
        opacity="0.18"
      />
      <g ref={meshGroupRef} />
      {definition.stem === true && (
        <path
          className="gb-stem"
          d="M49 15 C48 8 51 4 57 3 L59 6 C54 7 52 11 52 15 Z"
          fill="#8b5e3c"
        />
      )}
      <g ref={leftEyeGroupRef} transform={`translate(${50 - eyeX * BODY_R} ${50 + eyeY * BODY_R})`}>
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
      <g ref={rightEyeGroupRef} transform={`translate(${50 + eyeX * BODY_R} ${50 + eyeY * BODY_R})`}>
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
