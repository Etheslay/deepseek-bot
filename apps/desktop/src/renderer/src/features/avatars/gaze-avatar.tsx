/**
 * Avatar wrapper that makes the eyes follow the pointer with no visible lag.
 *
 * The pointer position is written into a ref (no React state), so the avatar's
 * animation loop reads it on the very next frame: moving the mouse updates the
 * gaze within one frame instead of waiting for a re-render plus damping.
 *
 * The hover zone is the closest ancestor marked with `data-gaze-zone` (the
 * whole sidebar row, the identity block, the header chip); the gaze angle is
 * still computed from the avatar's own centre so the eyes point at the cursor.
 */
import { useEffect, useRef, type JSX } from "react";
import type { Avatar as AvatarSpec } from "./avatar-meta.js";
import { Avatar } from "./avatar.js";
import type { GrokBallVariant } from "./grok-ball.js";

export function GazeAvatar(props: {
  avatar: AvatarSpec;
  size?: number;
  variant?: GrokBallVariant;
  className?: string;
}): JSX.Element {
  const { avatar, size, variant, className } = props;
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const gaze = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) {
      return;
    }
    const zone = (wrap.closest("[data-gaze-zone]") as HTMLElement | null) ?? wrap;
    // Listen on the window and test containment instead of relying on
    // pointerenter/leave: enter/leave pairs fire unreliably for synthetic
    // moves, which used to reset the gaze to null right after it was set.
    const onMove = (event: PointerEvent): void => {
      const zoneRect = zone.getBoundingClientRect();
      const inside =
        event.clientX >= zoneRect.left &&
        event.clientX <= zoneRect.right &&
        event.clientY >= zoneRect.top &&
        event.clientY <= zoneRect.bottom;
      if (!inside) {
        gaze.current = null;
        return;
      }
      const rect = wrap.getBoundingClientRect();
      const halfW = rect.width / 2;
      const halfH = rect.height / 2;
      if (halfW <= 0 || halfH <= 0) {
        return;
      }
      // Normalize by the hover zone (the whole row / identity block), not the
      // sprite: a 36px avatar inside a 270px row would otherwise saturate the
      // gaze as soon as the cursor left the sprite.
      const spanX = Math.max(zoneRect.width / 2, halfW);
      const spanY = Math.max(zoneRect.height / 2, halfH);
      gaze.current = {
        x: Math.max(-1, Math.min(1, (event.clientX - (rect.left + halfW)) / spanX)),
        y: Math.max(-1, Math.min(1, (event.clientY - (rect.top + halfH)) / spanY)),
      };

    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <span ref={wrapRef} className={className === undefined ? "gaze-avatar" : `gaze-avatar ${className}`}>
      <Avatar
        avatar={avatar}
        {...(size !== undefined ? { size } : {})}
        {...(variant !== undefined ? { variant } : {})}
        gazeSource={gaze}
      />
    </span>
  );
}
