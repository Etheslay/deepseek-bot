/**
 * Unified avatar renderer (brief §2.5): preset PNG / dolphin logo / emoji /
 * uploaded image. White-round presets and the logo render bare; emoji and
 * images use no chrome either. UI-only, never persisted.
 */
import { useEffect, useRef, useState, type JSX } from "react";
import type { Avatar } from "./avatar-meta.js";
import { MINIMAL_SHAPES } from "./avatar-minimal.js";
import { DOLPHIN_LOGO_URL, PRESET_URLS } from "./preset-urls.js";

function MinimalAvatar(props: {
  shapeIndex: number;
  color: string;
  size: number;
  mono?: boolean;
}): JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const shape = MINIMAL_SHAPES[props.shapeIndex] ?? MINIMAL_SHAPES[0]!;

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
    <span
      ref={ref}
      className={"avatar-minimal" + (props.mono ? " mono" : "")}
      style={{
        background: props.color,
        borderRadius: shape.radius,
        clipPath: shape.clipPath,
        width: props.size,
        height: props.size,
      }}
      aria-hidden="true"
    >
      <span className="eye left">
        <span className="pupil" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} />
      </span>
      <span className="eye right">
        <span className="pupil" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} />
      </span>
    </span>
  );
}

export function Avatar(props: { avatar: Avatar; size: number }): JSX.Element {
  const [broken, setBroken] = useState(false);
  const { avatar, size } = props;

  if (avatar.kind === "image" && broken) {
    return <Avatar avatar={{ kind: "preset", preset: "bear" }} size={size} />;
  }

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
    case "preset":
      return (
        <img
          className="avatar-img"
          src={PRESET_URLS[avatar.preset]}
          alt=""
          width={size}
          height={size}
          draggable={false}
        />
      );
    case "logo":
      return (
        <img
          className="avatar-img logo"
          src={DOLPHIN_LOGO_URL}
          alt="DeepSeek"
          width={size}
          height={size}
          draggable={false}
        />
      );
    case "emoji":
      return (
        <span className="avatar-emoji" style={{ fontSize: Math.round(size * 0.72) }} aria-hidden="true">
          {avatar.emoji}
        </span>
      );
    case "image":
      return (
        <img
          className="avatar-img"
          src={avatar.dataUrl}
          alt={avatar.alt ?? ""}
          width={size}
          height={size}
          draggable={false}
          onError={() => setBroken(true)}
        />
      );
  }
}
