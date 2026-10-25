/**
 * Minimal avatar picker: theme-aware solid bot + geometric shapes/colors.
 * Animal and Emoji tabs were removed deliberately.
 */
import { useState, type JSX } from "react";
import type { Avatar } from "./avatar-meta.js";
import { MINIMAL_COLORS, MINIMAL_SHAPES } from "./avatar-minimal.js";
import { Avatar as AvatarView } from "./avatar.js";

export function AvatarPicker(props: {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
}): JSX.Element {
  const [shape, setShape] = useState(
    props.value.kind === "minimal" ? props.value.shape : 0,
  );
  const [color, setColor] = useState(
    props.value.kind === "minimal" ? props.value.color : MINIMAL_COLORS[2]!,
  );

  const pickMinimal = (nextShape: number, nextColor: string): void => {
    setShape(nextShape);
    setColor(nextColor);
    props.onChange({ kind: "minimal", shape: nextShape, color: nextColor });
  };

  return (
    <div className="avatar-picker">
      <button
        type="button"
        className={"mono-pick" + (props.value.kind === "mono" ? " selected" : "")}
        aria-pressed={props.value.kind === "mono"}
        onClick={() => props.onChange({ kind: "mono" })}
      >
        <AvatarView avatar={{ kind: "mono" }} size={30} />
        <span>纯色 Bot</span>
      </button>
      <div className="shape-grid" role="radiogroup" aria-label="形状">
        {MINIMAL_SHAPES.map((_, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={shape === i}
            className={shape === i ? "shape-btn selected" : "shape-btn"}
            onClick={() => pickMinimal(i, color)}
          >
            <AvatarView avatar={{ kind: "minimal", shape: i, color }} size={42} />
          </button>
        ))}
      </div>
      <div className="color-grid" role="radiogroup" aria-label="颜色">
        {MINIMAL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            className={color === c ? "color-btn selected" : "color-btn"}
            style={{ background: c }}
            onClick={() => pickMinimal(shape, c)}
            aria-label={`颜色 ${c}`}
          />
        ))}
      </div>
    </div>
  );
}
