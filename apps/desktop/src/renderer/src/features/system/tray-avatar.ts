/**
 * Tray avatar rasterisation (D22).
 *
 * The Grok Ball in the UI is a live React SVG that paints with CSS variables;
 * the Windows tray needs a 32px PNG and cannot see those variables. This module
 * builds a standalone, fully inlined SVG from the same geometry model
 * (`grok-ball-model`) and rasterises it with a canvas, so the tray icon is the
 * bot's real avatar rather than a generic dot.
 *
 * The SVG builder is pure and unit-testable; only `rasterizeTrayIcon` needs a
 * DOM (canvas + Image), and the tray sync helper injects it so tests can stub.
 */
import {
  GROK_BALL_SHAPES,
  GROK_BALL_STATE_FRAMES,
  contourPath,
  projectEye,
  sampleContour,
  type GrokBallState,
} from "../avatars/grok-ball-model.js";
import type { Avatar } from "../avatars/avatar-meta.js";

export const TRAY_ICON_PIXELS = 32;

export type TrayIconColors = {
  /** Concrete color for the theme-aware "mono" avatar (CSS vars do not exist here). */
  mono: string;
  eye: string;
};

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function eyeTransform(side: -1 | 1, definition: { eyeX?: number; eyeY: number; eyeSpacing: number; eyeScale?: number }): string {
  const projected = projectEye({ x: 0, y: 0 }, side);
  const x = 50 + (definition.eyeX ?? 0) + projected.x * (definition.eyeSpacing / 0.68);
  const y = definition.eyeY + projected.y * (definition.eyeSpacing * 0.72);
  const scale = definition.eyeScale ?? 1;
  return `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale} ${scale})`;
}

/**
 * Static (idle) avatar as a self-contained SVG string. Shapes that fall back to
 * the `circle` silhouette keep the render deterministic for odd saved state.
 */
export function trayAvatarSvg(
  avatar: Avatar,
  colors: TrayIconColors,
  state: GrokBallState = "idle",
  pixels: number = TRAY_ICON_PIXELS,
): string {
  const isMono = avatar.kind === "mono";
  const shapeId = isMono ? "circle" : avatar.shape;
  const definition = GROK_BALL_SHAPES[shapeId] ?? GROK_BALL_SHAPES.circle;
  const bodyPath = contourPath(sampleContour(definition.points, 72));
  const frame = GROK_BALL_STATE_FRAMES[state] ?? GROK_BALL_STATE_FRAMES.idle;
  const fill = isMono ? colors.mono : escapeAttribute(avatar.color);
  const eyePath = contourPath(frame.left.points);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 100 100">`,
    `<path d="${bodyPath}" fill="${fill}"/>`,
    `<path d="${eyePath}" transform="${eyeTransform(-1, definition)}" fill="${colors.eye}"/>`,
    `<path d="${eyePath}" transform="${eyeTransform(1, definition)}" fill="${colors.eye}"/>`,
    "</svg>",
  ].join("");
}

/** How long an avatar is allowed to take before the tray falls back to no icon. */
export const TRAY_RASTER_TIMEOUT_MS = 1_500;

/** SVG → PNG data URL. Returns null when the browser cannot rasterise. */
export async function rasterizeTrayIcon(
  svg: string,
  timeoutMs: number = TRAY_RASTER_TIMEOUT_MS,
): Promise<string | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return null;
  }
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = new Image();
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
  });
  image.src = url;
  // An environment that never fires load or error (jsdom, a blocked SVG) must not
  // stall the tray: give up and keep the default icon.
  const ok = await Promise.race([
    loaded,
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (!ok) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = TRAY_ICON_PIXELS;
  canvas.height = TRAY_ICON_PIXELS;
  const context = canvas.getContext("2d");
  if (context === null) {
    return null;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.startsWith("data:image/png;base64,") ? dataUrl : null;
}
