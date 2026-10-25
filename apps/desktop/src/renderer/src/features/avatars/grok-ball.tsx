/**
 * Grok Ball avatar.
 *
 * A reusable, animated geometric avatar: the body breathes, the eyes follow
 * the cursor with damping, blinks on a spring, and expressions morph between
 * agent states instead of hard-cutting.
 */
import { useEffect, useId, useMemo, useRef, type CSSProperties, type JSX } from "react";
import {
  GROK_BALL_SHAPES,
  GROK_BALL_STATE_FRAMES,
  contourPath,
  interpolateStateFrame,
  projectEye,
  sampleContour,
  type GrokBallShapeId,
  type GrokBallState,
  type StateFrame,
} from "./grok-ball-model.js";

const MORPH_MS = 260;
const BREATH_PERIOD_MS = 3600;
const BREATH_AMPLITUDE = 0.014;
const BLINK_MIN_MS = 2000;
const BLINK_MAX_MS = 6000;
const GAZE_TIME_CONSTANT_MS = 105;

type GrokBallProps = {
  size?: number;
  shape?: GrokBallShapeId;
  /** Hex color, or `"mono"` for the theme-aware black/white ball. */
  color?: string;
  state?: GrokBallState;
  className?: string;
  style?: CSSProperties;
};

function isMono(color: string): boolean {
  return color === "mono";
}

function eyePathFromFrame(frame: StateFrame["left"]): string {
  return contourPath(frame.points);
}

export function GrokBall({
  size = 96,
  shape = "blob",
  color = "mono",
  state = "idle",
  className,
  style,
}: GrokBallProps): JSX.Element {
  const clipId = useId().replace(/[:]/g, "");
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

  const gazeRef = useRef({ x: 0, y: 0 });
  const gazeTargetRef = useRef({ x: 0, y: 0 });
  const lastMouseMoveRef = useRef(0);
  const nextSaccadeRef = useRef(0);
  const blinkRef = useRef({ value: 0, velocity: 0, target: 0, next: 0 });
  const burstRef = useRef<{ start: number } | null>(null);
  const stateRef = useRef<GrokBallState>(state);

  useEffect(() => {
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
  }, [state]);

  useEffect(() => {
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
        y: Math.max(-1, Math.min(1, (event.clientY - cy) / (rect.height / 2))),
      };
      lastMouseMoveRef.current = performance.now();
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
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
          x: (Math.random() - 0.5) * 1.1,
          y: (Math.random() - 0.5) * 0.8,
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

      // State morph.
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

      // Eyes.
      const eyeScale = definition.eyeScale ?? 1;
      const eyeSpacing = definition.eyeSpacing;
      const eyeY = definition.eyeY;
      const leftProjection = projectEye(gazeRef.current, -1);
      const rightProjection = projectEye(gazeRef.current, 1);
      const xScale = eyeSpacing / 0.68;
      const yScale = eyeSpacing * 0.72;

      const leftGroup = leftEyeGroupRef.current;
      if (leftGroup) {
        const x = 50 + leftProjection.x * xScale;
        const y = eyeY + leftProjection.y * yScale;
        const blinkScale = 1 - Math.max(0, Math.min(1, blink.value)) * 0.86;
        leftGroup.setAttribute(
          "transform",
          `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${eyeScale.toFixed(3)} ${(eyeScale * blinkScale).toFixed(3)})`,
        );
        leftGroup.setAttribute("opacity", leftProjection.visible ? "1" : "0");
      }
      const rightGroup = rightEyeGroupRef.current;
      if (rightGroup) {
        const x = 50 + rightProjection.x * xScale;
        const y = eyeY + rightProjection.y * yScale;
        const blinkScale = 1 - Math.max(0, Math.min(1, blink.value)) * 0.86;
        rightGroup.setAttribute(
          "transform",
          `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${eyeScale.toFixed(3)} ${(eyeScale * blinkScale).toFixed(3)})`,
        );
        rightGroup.setAttribute("opacity", rightProjection.visible ? "1" : "0");
      }

      const leftPath = leftEyePathRef.current;
      if (leftPath) {
        leftPath.setAttribute("d", eyePathFromFrame(frame.left));
        leftPath.setAttribute("fill", isMono(color) ? "var(--avatar-mono-eye)" : frame.left.color);
      }
      const rightPath = rightEyePathRef.current;
      if (rightPath) {
        rightPath.setAttribute("d", eyePathFromFrame(frame.right));
        rightPath.setAttribute("fill", isMono(color) ? "var(--avatar-mono-eye)" : frame.right.color);
      }

      // Aura / thinking orbit / done burst.
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
  }, [color, definition.eyeScale, definition.eyeSpacing, definition.eyeY]);

  const bodyFill = isMono(color) ? "var(--avatar-mono-bg)" : color;

  return (
    <svg
      className={"grok-ball" + (className ? ` ${className}` : "")}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <path d={bodyPath} />
        </clipPath>
      </defs>
      <g ref={bodyGroupRef}>
        <path d={bodyPath} fill={bodyFill} />
        <g clipPath={`url(#${clipId})`}>
          <g ref={leftEyeGroupRef}>
            <path ref={leftEyePathRef} d={eyePathFromFrame(GROK_BALL_STATE_FRAMES[state].left)} />
          </g>
          <g ref={rightEyeGroupRef}>
            <path ref={rightEyePathRef} d={eyePathFromFrame(GROK_BALL_STATE_FRAMES[state].right)} />
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
