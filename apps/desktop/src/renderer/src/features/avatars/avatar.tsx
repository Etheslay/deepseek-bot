/** Avatar renderer: rounded Minimal shapes and the theme-aware mono bot. */
import { useEffect, useRef, useState, type JSX } from "react";
import type { Avatar } from "./avatar-meta.js";
import { MINIMAL_SHAPES } from "./avatar-minimal.js";

function MinimalAvatar(props: {
  shapeIndex: number;
  color: string;
  size: number;
  mono?: boolean;
}): JSX.Element {
  const ref = useRef<SVGSVGElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const shape = MINIMAL_SHAPES[props.shapeIndex] ?? MINIMAL_SHAPES[0]!;
  const eyeY = shape.eyeY ?? 46;

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const el = ref.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const max = Math.max(1.2, props.size * 0.07);
      const scale = Math.min(1, dist / 90);
      setOffset({
        x: (dx / dist) * max * scale,
        y: (dy / dist) * max * scale,
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [props.size]);

  return (
    <svg
      ref={ref}
      className="avatar-minimal-svg"
      width={props.size}
      height={props.size}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <path d={shape.path} fill={props.mono ? "var(--avatar-mono-bg)" : props.color} />
      {props.mono ? (
        <g transform={`translate(${offset.x} ${offset.y})`}>
          <circle cx="32" cy={eyeY} r="7" fill="var(--avatar-mono-eye)" />
          <circle cx="68" cy={eyeY} r="7" fill="var(--avatar-mono-eye)" />
        </g>
      ) : (
        <>
          <circle cx="32" cy={eyeY} r="8" fill="#ffffff" />
          <circle cx="68" cy={eyeY} r="8" fill="#ffffff" />
          <g transform={`translate(${offset.x} ${offset.y})`}>
            <circle cx="32" cy={eyeY} r="4" fill="#1b1b1f" />
            <circle cx="68" cy={eyeY} r="4" fill="#1b1b1f" />
          </g>
        </>
      )}
    </svg>
  );
}

export function Avatar(props: { avatar: Avatar; size: number }): JSX.Element {
  const { avatar, size } = props;

  switch (avatar.kind) {
    case "mono":
      return (
        <MinimalAvatar
          mono
          shapeIndex={0}
          color="var(--avatar-mono-bg)"
          size={size}
        />
      );
    case "minimal":
      return (
        <MinimalAvatar
          shapeIndex={avatar.shape}
          color={avatar.color}
          size={size}
        />
      );
  }
}
