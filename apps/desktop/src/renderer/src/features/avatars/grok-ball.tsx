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
  shadePalette,
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
/** Resting glance: up and to the left (~45°), like a head watching a cursor there. */
const RESTING_GAZE = { x: -0.52, y: 0.5 };

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
  const x = 50 + p.x * (def.eyeSpacing / 0.68);
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
  const bodyGradientId = `${clipId}Body`;
  const rimGradientId = `${clipId}Rim`;
  const coreGradientId = `${clipId}Core`;
  const specGradientId = `${clipId}Spec`;
  const softBlurId = `${clipId}Soft`;
  const creaseBlurId = `${clipId}Crease`;
  const contactBlurId = `${clipId}Contact`;
  const definition = GROK_BALL_SHAPES[shape];
  const bodyPath = useMemo(
    () => contourPath(sampleContour(definition.points, 72)),
    [definition.points],
  );
  const palette = mono
    ? {
        hi: "var(--gb-mono-hi)",
        mid: "var(--gb-mono-mid)",
        shade: "var(--gb-mono-shade)",
      }
    : shadePalette(color);
  const creases = useMemo(() => {
    const count = definition.creases ?? 0;
    if (count === 0) {
      return [];
    }
    return Array.from({ length: count }, (_, index) => {
      const angle = (Math.PI * 2 * index) / count + Math.PI / count;
      return {
        x1: 50 + Math.cos(angle) * 9,
        y1: 50 + Math.sin(angle) * 9,
        x2: 50 + Math.cos(angle) * 54,
        y2: 50 + Math.sin(angle) * 54,
      };
    });
  }, [definition.creases]);

  const bodyGroupRef = useRef<SVGGElement | null>(null);
  const leftEyeGroupRef = useRef<SVGGElement | null>(null);
  const rightEyeGroupRef = useRef<SVGGElement | null>(null);
  const leftEyePathRef = useRef<SVGPathElement | null>(null);
  const rightEyePathRef = useRef<SVGPathElement | null>(null);
  const auraRef = useRef<SVGCircleElement | null>(null);

  const frameRef = useRef<StateFrame>(GROK_BALL_STATE_FRAMES[state]);
  const targetFrameRef = useRef<StateFrame>(GROK_BALL_STATE_FRAMES[state]);
  const morphRef = useRef<{ start: number; from: StateFrame } | null>(null);

  const gazeRef = useRef({ ...RESTING_GAZE });
  const gazeTargetRef = useRef({ ...RESTING_GAZE });
  const lastMouseMoveRef = useRef(0);
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
    const onMove = (event: MouseEvent): void => {
      const el = bodyGroupRef.current?.ownerSVGElement;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      gazeTargetRef.current = {
        x: Math.max(-1, Math.min(1, (event.clientX - cx) / (rect.width / 2))),
        y: Math.max(-1, Math.min(1, -(event.clientY - cy) / (rect.height / 2))),
      };
      lastMouseMoveRef.current = performance.now();
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [animate]);

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

      // Idle saccade when the cursor has been still for a while.
      if (now - lastMouseMoveRef.current > 2400 && now > nextSaccadeRef.current) {
        gazeTargetRef.current = {
          x: Math.max(-1, Math.min(1, RESTING_GAZE.x + (Math.random() - 0.5) * 0.4)),
          y: Math.max(-1, Math.min(1, RESTING_GAZE.y + (Math.random() - 0.5) * 0.4)),
        };
        nextSaccadeRef.current = now + 1800 + Math.random() * 3200;
      }

      // Blink spring.
      const blink = blinkRef.current;
      if (now > blink.next) {
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
        bodyGroup.setAttribute(
          "transform",
          `translate(50 50) scale(${bodyScale.toFixed(4)}) rotate(${(frame.bodyTilt * 180 / Math.PI).toFixed(3)}) translate(-50 -50)`,
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
        const x = 50 + leftProjection.x * xScale;
        const y = definition.eyeY + leftProjection.y * yScale;
        leftGroup.setAttribute(
          "transform",
          `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${eyeScale.toFixed(3)} ${(eyeScale * blinkScale).toFixed(3)})`,
        );
        leftGroup.setAttribute("opacity", leftProjection.visible ? "1" : "0");
      }
      const rightGroup = rightEyeGroupRef.current;
      if (rightGroup) {
        const x = 50 + rightProjection.x * xScale;
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
        <radialGradient id={bodyGradientId} cx="30%" cy="24%" r="82%" fx="26%" fy="20%">
          <stop offset="0%" style={{ stopColor: palette.hi }} />
          <stop offset="32%" style={{ stopColor: palette.mid }} />
          <stop offset="100%" style={{ stopColor: palette.shade }} />
        </radialGradient>
        <linearGradient id={rimGradientId} x1="14%" y1="4%" x2="86%" y2="96%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.7" />
          <stop offset="18%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.05" />
        </linearGradient>
        <radialGradient
          id={coreGradientId}
          gradientUnits="userSpaceOnUse"
          cx="68"
          cy="74"
          r="34"
        >
          <stop offset="0%" stopColor="#000000" stopOpacity="0.42" />
          <stop offset="55%" stopColor="#000000" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={specGradientId}
          gradientUnits="userSpaceOnUse"
          cx="36"
          cy="32"
          r="16"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={softBlurId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
        <filter id={creaseBlurId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
        <filter id={contactBlurId} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        <clipPath id={clipId}>
          <path d={bodyPath} />
        </clipPath>
      </defs>
      {/* Contact shadow: keeps the ball seated on its plaque instead of floating. */}
      <ellipse
        className="gb-contact"
        cx="50"
        cy="96"
        rx="27"
        ry="3.4"
        style={{ fill: "var(--gb-contact)" }}
        filter={`url(#${contactBlurId})`}
      />
      <g ref={bodyGroupRef}>
        {definition.stem && (
          <path
            className="gb-stem"
            d="M49 15 C48 8 51 4 57 3 L59 6 C54 7 52 11 52 15 Z"
            fill="#8b5e3c"
          />
        )}
        <path className="gb-body" d={bodyPath} fill={`url(#${bodyGradientId})`} />
        <g clipPath={`url(#${clipId})`}>
          {/* Core shadow on the lower-right, opposite the upper-left key light. */}
          <ellipse cx="68" cy="74" rx="32" ry="28" fill={`url(#${coreGradientId})`} />
          {creases.map((crease, index) => (
            <line
              key={index}
              x1={crease.x1}
              y1={crease.y1}
              x2={crease.x2}
              y2={crease.y2}
              style={{
                stroke: mono ? "var(--gb-crease)" : "rgba(0, 0, 0, 0.22)",
              }}
              strokeWidth="7"
              strokeLinecap="round"
              filter={`url(#${creaseBlurId})`}
            />
          ))}
          {/* Rim light hugging the lit edge. */}
          <path
            d={bodyPath}
            fill="none"
            stroke={`url(#${rimGradientId})`}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* Specular sheen on the upper-left shoulder. */}
          <ellipse
            cx="36"
            cy="32"
            rx="12"
            ry="8.5"
            fill={`url(#${specGradientId})`}
            transform="rotate(-34 36 32)"
            filter={`url(#${softBlurId})`}
          />
          <g ref={leftEyeGroupRef} transform={neutralEyeTransform(-1, definition)}>
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




