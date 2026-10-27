/** Grok Ball avatar picker: shapes, colors and theme-aware mono bot. */
import type { JSX } from "react";
import type { Avatar } from "./avatar-meta.js";
import {
  GROK_BALL_COLORS,
  GROK_BALL_SHAPE_IDS,
  toneKeyFor,
} from "./grok-ball-model.js";
import { Avatar as AvatarView } from "./avatar.js";
import { t } from "../../i18n.js";

export function AvatarPicker(props: {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
  /** Theme drives which extreme swatch exists and the eye color. */
  theme?: "light" | "dark";
}): JSX.Element {
  const shape = props.value.kind === "grok" ? props.value.shape : "circle";
  const color = props.value.kind === "grok" ? props.value.color : "#3b93f0";

  const pickGrok = (nextShape: typeof shape, nextColor: string): void => {
    props.onChange({ kind: "grok", shape: nextShape, color: nextColor });
  };

  return (
    <div className="avatar-picker">
      <div className="shape-grid" role="radiogroup" aria-label={t("avatars.shape")}>
        {GROK_BALL_SHAPE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={props.value.kind === "grok" && shape === id}
            className={
              "shape-btn" +
              (props.value.kind === "grok" && shape === id ? " selected" : "")
            }
            onClick={() => pickGrok(id, color)}
          >
            <AvatarView avatar={{ kind: "grok", shape: id, color }} variant="inline" size={34} />
          </button>
        ))}
      </div>
      <div className="color-grid" role="radiogroup" aria-label={t("avatars.color")}>
        <button
          type="button"
          role="radio"
          aria-checked={props.value.kind === "mono"}
          className={
            "color-btn mono-color" + (props.value.kind === "mono" ? " selected" : "")
          }
          style={{ background: "var(--avatar-mono-bg)" }}
          aria-label={props.theme === "light" ? t("avatars.blackMono") : t("avatars.whiteMono")}
          title={props.theme === "light" ? t("avatars.blackMono") : t("avatars.whiteMono")}
          onClick={() => props.onChange({ kind: "mono" })}
        />
        {GROK_BALL_COLORS.map((c) => {
          const tone = toneKeyFor(c);
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={props.value.kind === "grok" && color === c}
              className={
                "color-btn" +
                (props.value.kind === "grok" && color === c ? " selected" : "")
              }
              // A palette colour resolves through the theme-aware tone
              // variable; anything else (a retired hex) paints itself.
              data-tone={tone ?? undefined}
              style={tone === null ? { background: c } : undefined}
              onClick={() => pickGrok(shape, c)}
              aria-label={t("avatars.colorValue", [c])}
            />
          );
        })}
      </div>
    </div>
  );
}


