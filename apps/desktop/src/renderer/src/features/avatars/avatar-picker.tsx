/**
 * Minimal avatar picker: rounded shapes, colors and theme-aware mono bot.
 * Controlled by the parent so create/edit always reflects the real avatar.
 */
import type { JSX } from "react";
import type { Avatar } from "./avatar-meta.js";
import { MINIMAL_COLORS, MINIMAL_SHAPES } from "./avatar-minimal.js";
import { Avatar as AvatarView } from "./avatar.js";

export function AvatarPicker(props: {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
}): JSX.Element {
  const shape = props.value.kind === "minimal" ? props.value.shape : 0;
  const color = props.value.kind === "minimal" ? props.value.color : "#3b82f6";

  const pickMinimal = (nextShape: number, nextColor: string): void => {
    props.onChange({ kind: "minimal", shape: nextShape, color: nextColor });
  };

  return (
    <div className="avatar-picker">
      <div className="shape-grid" role="radiogroup" aria-label="形状">
        {MINIMAL_SHAPES.map((_, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={props.value.kind === "minimal" && shape === i}
            className={
              "shape-btn" +
              (props.value.kind === "minimal" && shape === i ? " selected" : "")
            }
            onClick={() => pickMinimal(i, color)}
          >
            <AvatarView avatar={{ kind: "minimal", shape: i, color }} size={34} />
          </button>
        ))}
      </div>
      <div className="color-grid" role="radiogroup" aria-label="颜色">
        <button
          type="button"
          role="radio"
          aria-checked={props.value.kind === "mono"}
          title="黑白（跟随主题）"
          aria-label="黑白（跟随主题）"
          className={
            "color-btn mono-color" + (props.value.kind === "mono" ? " selected" : "")
          }
          onClick={() => props.onChange({ kind: "mono" })}
        >
          <AvatarView avatar={{ kind: "mono" }} size={24} />
        </button>
        {MINIMAL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={props.value.kind === "minimal" && color === c}
            className={
              "color-btn" +
              (props.value.kind === "minimal" && color === c ? " selected" : "")
            }
            style={{ background: c }}
            onClick={() => pickMinimal(shape, c)}
            aria-label={`颜色 ${c}`}
          />
        ))}
      </div>
    </div>
  );
}
