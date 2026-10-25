/**
 * Grok Ball avatar.
 *
 * A reusable, animated geometric avatar: the body breathes, the eyes follow
 * the cursor with damping, blinks on a spring, and expressions morph between
 * agent states instead of hard-cutting. In the `inline` variant (in-message
 * avatars and picker thumbnails) it renders as a static identity glyph so the
 * ball never "floats" as a live element inside the chat stream; the animated
 * form is reserved for fixed identity slots (sidebar plaque, message header,
 * create/edit preview).
 */
import { useEffect, useId, useMemo, useRef, type CSSProperties, type JSX } from "react";
import {
  GROK_BALL_SHAPES,
  GROK_BALL_SIZES,
  GROK_BALL_STATE_FRAMES,
  contourPath,
  interpolateStateFrame,
  isStaticVariant,
  projectEye,
  sampleContour,
  type GrokBallShapeId,
  type GrokBallState,
  type GrokBallVariant,
  type ShapeDefinition,
  type StateFrame,
} from "./grok-ball-model.js";

export type { GrokBallVariant };
export { GROK_BALL_SIZES };

const MORPH_MS = 260;
const BREATH_PERIOD_MS = 3600;
const BREATH_AMPLITUDE = 0.014;
const BLINK_MIN_MS = 2000;
const BLINK_MAX_MS = 6000;
const GAZE_TIME_CONSTANT_MS = 105;
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
  className?: string | undefined;
  style?: CSSProperties | undefined;
};

function isMono(color: string): boolean {
  return color === "mono";
}

function eyePathFromFrame(frame: StateFrame["left"]): string {
  return contourPath(frame.points);
}

/** Neutral (centered, open) transform for one eye, used for static renders. */
function neutralEyeTransform(side: -1 | 1, def: ShapeDefinition): string {
  const p = projectEye({ x: 0, y: 0 }, side);
  const x = 50 + (def.eyeX ?? 0) + p.x * (def.eyeSpacing / 0.68);
  const y = def.eyeY + p.y * (def.eyeSpacing * 0.72);
  const s = def.eyeScale ?? 1;
  return `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${s} ${s})`;
}

export function GrokBall({
  size,
  variant = "preview",
  shape = "blob",
  color = "mono",
  state = "idle",
  motion,
  className,
  style,
}: GrokBallProps): JSX.Element {
  const pixelSize = size ?? GROK_BALL_SIZES[variant];
  const animate = motion ?? !isStaticVariant(variant);
  const mono = isMono(color);

  const clipId = `gbClip${useId().replace(/[:]/g, "")}`;
  const definition = GROK_BALL_SHAPES[shape];
  const bodyPath = useMemo(
    () => contourPath(sampleContour(definition.points, 72)),
    [definition.points],
  );
  const bodyGroupRef = useRef<SVGGElement | null>(null);
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

  // Static (inline) avatars: place eyes once per state, no animation loop.
  useEffect(() => {
    if (animate) {
      return;
    }
    const frame = GROK_BALL_STATE_FRAMES[state];
    frameRef.current = frame;
    targetFrameRef.current = frame;
    if (bodyGroupRef.current) {
      bodyGroupRef.current.removeAttribute("transform");
    }
    leftEyeGroupRef.current?.setAttribute(
      "transform",
      neutralEyeTransform(-1, definition),
    );
    rightEyeGroupRef.current?.setAttribute(
      "transform",
      neutralEyeTransform(1, definition),
    );
    leftEyeGroupRef.current?.setAttribute("opacity", "1");
    rightEyeGroupRef.current?.setAttribute("opacity", "1");
    leftEyePathRef.current?.setAttribute("d", eyePathFromFrame(frame.left));
    rightEyePathRef.current?.setAttribute("d", eyePathFromFrame(frame.right));
    auraRef.current?.setAttribute("opacity", "0");
  }, [animate, state, definition]);

  useEffect(() => {
    if (!animate) {
      return;
    }
    if (stateRef.current === state) {
      return;
    }
    const from = frameRef.current;
    const to = GROK_BALL_STATE_FRAMES[state];
    morphRef.current = { start: performance.now(), from };
    targetFrameRef.current = to;
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

    const loop = (now: number): void => {
      const dt = Math.min(100, now - lastTime);
      lastTime = now;

      // Gaze damping with a ~105 ms time constant.
      const smoothing = 1 - Math.exp(-dt / GAZE_TIME_CONSTANT_MS);
      gazeRef.current.x += (gazeTargetRef.current.x - gazeRef.current.x) * smoothing;
      gazeRef.current.y += (gazeTargetRef.current.y - gazeRef.current.y) * smoothing;

      // Autonomous glances: no cursor tracking, just look around now and then.
      if (now > nextSaccadeRef.current) {
        const glance = GLANCES[Math.floor(Math.random() * GLANCES.length)]!;
        gazeTargetRef.current = {
          x: glance.x + (Math.random() - 0.5) * 0.12,
          y: glance.y + (Math.random() - 0.5) * 0.12,
        };
        nextSaccadeRef.current = now + 1800 + Math.random() * 2600;
      }

      // Blink spring.
      const blink = blinkRef.current;
      if (blink.next === 0) {
        // First frame: schedule the first blink instead of closing immediately.
        blink.next = now + 1500 + Math.random() * 3500;
      } else if (now > blink.next) {
        blink.target = blink.target === 0 ? 1 : 0;
        blink.next =
          blink.target === 1
            ? now + 110
            : now + BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
      }
      const stiffness = 180;
      const damping = 22;
      blink.velocity += (blink.target - blink.value) * stiffness * (dt / 1000);
      blink.velocity -= blink.velocity * damping * (dt / 1000);
      blink.value += blink.velocity * (dt / 1000);
      blink.value = Math.max(-0.05, Math.min(1.08, blink.value));

      // State morph (pointwise eye-ring keyframe interpolation).
      if (morphRef.current) {
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
      const frame = frameRef.current;

      // Body breathing and state transform.
      const breath = 1 + Math.sin((now / BREATH_PERIOD_MS) * Math.PI * 2) * BREATH_AMPLITUDE;
      const bodyScale = breath * frame.bodyScale;
      const bodyGroup = bodyGroupRef.current;
      if (bodyGroup) {
        // Slight head turn: rotate and foreshorten the body with the glance.
        const turn = gazeRef.current.x;
        const squash = 1 - Math.abs(turn) * 0.09;
        bodyGroup.setAttribute(
          "transform",
          `translate(${(50 + turn * 2.4).toFixed(2)} 50) scale(${(bodyScale * squash).toFixed(4)} ${(bodyScale * (1 + Math.abs(turn) * 0.03)).toFixed(4)}) rotate(${((frame.bodyTilt * 180) / Math.PI + turn * 9).toFixed(3)}) translate(-50 -50)`,
        );
      }

      // Eyes: projected onto the body surface, hidden on the back hemisphere.
      const eyeScale = definition.eyeScale ?? 1;
      const xScale = definition.eyeSpacing / 0.68;
      const yScale = definition.eyeSpacing * 0.72;
      const blinkScale = 1 - Math.max(0, Math.min(1, blink.value)) * 0.86;

      const leftProjection = projectEye(gazeRef.current, -1);
      const rightProjection = projectEye(gazeRef.current, 1);
      const leftGroup = leftEyeGroupRef.current;
      if (leftGroup) {
        const x = 50 + (definition.eyeX ?? 0) + leftProjection.x * xScale;
        const y = definition.eyeY + leftProjection.y * yScale;
        leftGroup.setAttribute(
          "transform",
          `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${eyeScale.toFixed(3)} ${(eyeScale * blinkScale).toFixed(3)})`,
        );
        leftGroup.setAttribute("opacity", leftProjection.visible ? "1" : "0");
      }
      const rightGroup = rightEyeGroupRef.current;
      if (rightGroup) {
        const x = 50 + (definition.eyeX ?? 0) + rightProjection.x * xScale;
        const y = definition.eyeY + rightProjection.y * yScale;
        rightGroup.setAttribute(
          "transform",
          `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${eyeScale.toFixed(3)} ${(eyeScale * blinkScale).toFixed(3)})`,
        );
        rightGroup.setAttribute("opacity", rightProjection.visible ? "1" : "0");
      }

      const leftPath = leftEyePathRef.current;
      if (leftPath) {
        leftPath.setAttribute("d", eyePathFromFrame(frame.left));
        if (!mono) {
          if (stateRef.current === "idle") {
            leftPath.style.removeProperty("fill");
          } else {
            leftPath.style.fill = frame.left.color;
          }
        }
      }
      const rightPath = rightEyePathRef.current;
      if (rightPath) {
        rightPath.setAttribute("d", eyePathFromFrame(frame.right));
        if (!mono) {
          if (stateRef.current === "idle") {
            rightPath.style.removeProperty("fill");
          } else {
            rightPath.style.fill = frame.right.color;
          }
        }
      }

      // Aura / thinking orbit / done burst (accent colors are theme-independent).
      const aura = auraRef.current;
      if (aura) {
        if (stateRef.current === "thinking") {
          const dashOffset = (now / 1400) % 1;
          aura.setAttribute("stroke", frame.aura ?? "#60a5fa");
          aura.setAttribute("stroke-dasharray", "5 7");
          aura.setAttribute("stroke-dashoffset", String(dashOffset * 12));
          aura.setAttribute("opacity", "0.65");
          aura.setAttribute("r", "56");
        } else if (stateRef.current === "done" && burstRef.current) {
          const progress = Math.min(1, (now - burstRef.current.start) / 650);
          const radius = 48 + progress * 16;
          const opacity = (1 - progress) * 0.8;
          aura.setAttribute("stroke", frame.aura ?? "#22c55e");
          aura.setAttribute("stroke-dasharray", "none");
          aura.setAttribute("stroke-dashoffset", "0");
          aura.setAttribute("opacity", opacity.toFixed(3));
          aura.setAttribute("r", radius.toFixed(2));
        } else {
          aura.setAttribute("opacity", "0");
        }
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animate, mono, definition.eyeScale, definition.eyeSpacing, definition.eyeY]);

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
      <defs>
        <clipPath id={clipId}>
          <path d={bodyPath} />
        </clipPath>
      </defs>
      <g ref={bodyGroupRef}>
        {definition.stem && (
          <path
            className="gb-stem"
            d="M49 15 C48 8 51 4 57 3 L59 6 C54 7 52 11 52 15 Z"
            fill="#8b5e3c"
          />
        )}
        <path
          className="gb-body"
          d={bodyPath}
          fill={mono ? "var(--avatar-mono-bg)" : color}
        />
        <g clipPath={`url(#${clipId})`}>          <g ref={leftEyeGroupRef} transform={neutralEyeTransform(-1, definition)}>
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
          <g ref={rightEyeGroupRef} transform={neutralEyeTransform(1, definition)}>
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
      </g>
    </svg>
  );
}










