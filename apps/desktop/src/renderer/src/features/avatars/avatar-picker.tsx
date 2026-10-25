/**
 * Avatar picker (D05 UI, user override): three styles — Minimal / Animal /
 * Emoji. Minimal keeps the original geometric blob shapes + palette; Animal
 * uses the OpenMoji faces; Emoji uses native emoji. UI-only, no persistence.
 */
import { useRef, useState, type JSX, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Avatar, PresetId } from "./avatar-meta.js";
import { EMOJI_AVATARS, PRESET_AVATARS } from "./avatar-meta.js";
import { MINIMAL_COLORS, MINIMAL_SHAPES } from "./avatar-minimal.js";
import { Avatar as AvatarView } from "./avatar.js";

type Tab = "minimal" | "animal" | "emoji";

export function AvatarPicker(props: {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>("minimal");
  const [shape, setShape] = useState(
    props.value.kind === "minimal" ? props.value.shape : 0,
  );
  const [color, setColor] = useState(
    props.value.kind === "minimal" ? props.value.color : MINIMAL_COLORS[2]!,
  );
  const dragRef = useRef({ down: false, startX: 0, left: 0, moved: false });

  const onCarouselPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    const el = event.currentTarget;
    dragRef.current = {
      down: true,
      startX: event.clientX,
      left: el.scrollLeft,
      moved: false,
    };
    el.setPointerCapture(event.pointerId);
  };

  const onCarouselPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current.down) {
      return;
    }
    const el = event.currentTarget;
    const dx = event.clientX - dragRef.current.startX;
    if (Math.abs(dx) > 4) {
      dragRef.current.moved = true;
    }
    el.scrollLeft = dragRef.current.left - dx;
  };

  const onCarouselPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current.down = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onCarouselClickCapture = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (dragRef.current.moved) {
      event.preventDefault();
      event.stopPropagation();
      dragRef.current.moved = false;
    }
  };

  const pickMinimal = (nextShape: number, nextColor: string): void => {
    setShape(nextShape);
    setColor(nextColor);
    props.onChange({ kind: "minimal", shape: nextShape, color: nextColor });
  };

  const pickPreset = (preset: PresetId): void => {
    props.onChange({ kind: "preset", preset });
  };

  const pickEmoji = (emoji: string): void => {
    props.onChange({ kind: "emoji", emoji });
  };

  return (
    <div className="avatar-picker">
      <div className="avatar-tabs" role="tablist" aria-label="头像风格">
        {(
          [
            ["minimal", "Minimal"],
            ["animal", "Animal"],
            ["emoji", "Emoji"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={"avatar-tab" + (tab === id ? " selected" : "")}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "minimal" && (
        <div className="minimal-panel">
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
      )}

      {tab === "animal" && (
        <div
          className="avatar-carousel animal-carousel"
          role="listbox"
          aria-label="动物头像"
          onPointerDown={onCarouselPointerDown}
          onPointerMove={onCarouselPointerMove}
          onPointerUp={onCarouselPointerUp}
          onPointerCancel={onCarouselPointerUp}
          onClickCapture={onCarouselClickCapture}
        >
          {PRESET_AVATARS.map((p) =>
            p.id === "monkey" ? (
              <button
                key="deepseek-dolphin"
                type="button"
                role="option"
                aria-selected={props.value.kind === "logo"}
                className={"avatar-cell" + (props.value.kind === "logo" ? " selected" : "")}
                onClick={() => props.onChange({ kind: "logo", logo: "deepseek-dolphin" })}
              >
                <AvatarView avatar={{ kind: "logo", logo: "deepseek-dolphin" }} size={54} />
                <span>DeepSeek</span>
              </button>
            ) : (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={props.value.kind === "preset" && props.value.preset === p.id}
                className={
                  "avatar-cell" +
                  (props.value.kind === "preset" && props.value.preset === p.id ? " selected" : "")
                }
                onClick={() => pickPreset(p.id)}
              >
                <AvatarView avatar={{ kind: "preset", preset: p.id }} size={54} />
                <span>{p.name}</span>
              </button>
            ),
          )}
        </div>
      )}

      {tab === "emoji" && (
        <div
          className="avatar-carousel emoji-carousel"
          role="listbox"
          aria-label="Emoji 头像"
          onPointerDown={onCarouselPointerDown}
          onPointerMove={onCarouselPointerMove}
          onPointerUp={onCarouselPointerUp}
          onPointerCancel={onCarouselPointerUp}
          onClickCapture={onCarouselClickCapture}
        >
          {EMOJI_AVATARS.map((e) => (
            <button
              key={e.emoji}
              type="button"
              role="option"
              title={e.name}
              aria-selected={props.value.kind === "emoji" && props.value.emoji === e.emoji}
              className={
                "emoji-cell" +
                (props.value.kind === "emoji" && props.value.emoji === e.emoji ? " selected" : "")
              }
              onClick={() => pickEmoji(e.emoji)}
            >
              {e.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
