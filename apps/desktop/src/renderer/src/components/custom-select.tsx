import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n.js";

export type CustomSelectOption = {
  value: string | number;
  label: string;
};

type CustomSelectProps = {
  value: string | number;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  /**
   * Lets a surrounding layout give the control a class of its own, the way the
   * native select used to take one. Without it a form cannot size or align the
   * control without reaching into its internals.
   */
  className?: string;
};

/**
 * Fixed viewport coordinates for the portaled menu. All four inset sides are
 * always set ("auto" for the inactive sides) so the inline styles fully
 * override the legacy absolute-positioning rules in styles.css.
 */
export type MenuPlacement = {
  top: number | "auto";
  bottom: number | "auto";
  left: number | "auto";
  right: number | "auto";
  minWidth: number;
  maxWidth: number;
};

type TriggerBox = {
  left: number;
  right: number;
  bottom: number;
  width: number;
};

/**
 * Place the portaled menu against the trigger. Settings rows pin to the
 * trigger's right edge so the open list shares the closed control's edge
 * (the same edge as the accent chips). Elsewhere, a trigger in the right
 * half of the viewport does the same; one in the left half grows rightward.
 */
export function placeCustomSelectMenu(
  rect: TriggerBox,
  viewportWidth: number,
  pinToRightEdge: boolean,
): MenuPlacement {
  const anchorRight = pinToRightEdge || rect.left + rect.width / 2 > viewportWidth / 2;
  return {
    top: rect.bottom + 4,
    bottom: "auto",
    left: anchorRight ? "auto" : rect.left,
    right: anchorRight ? viewportWidth - rect.right : "auto",
    minWidth: rect.width,
    maxWidth: anchorRight ? rect.right - 8 : viewportWidth - rect.left - 8,
  };
}

/**
 * 自绘下拉：原生 select 在 Windows 上无法去掉系统蓝色选中高亮，
 * 这里用按钮 + 弹层实现。选中/悬停颜色只来自 styles.css 里的
 * dropdown-option-selection（暗灰菜单和灰洗选中/悬停，不用白底行，也不用强调蓝）。
 *
 * 弹层经 portal 渲染到 body：设置弹窗等内容区自带滚动容器，内联 absolute
 * 菜单在底部行会被裁掉（语言三档只剩一档可选）。改为固定定位按触发钮实时
 * 计算，视口下缘放不下时向上翻。设置行的菜单与触发钮右缘对齐，
 * 其余右半屏的触发钮同样向左展开。
 */
export function CustomSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = (): void => {
    setOpen(false);
    setPlacement(null);
  };

  const toggle = (): void => {
    if (open) {
      close();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    const pinToRightEdge = triggerRef.current?.closest(".settings-row") != null;
    setPlacement(placeCustomSelectMenu(rect, window.innerWidth, pinToRightEdge));
    setOpen(true);
  };

  // The menu mounts at `top: rect.bottom`; once its real height is known,
  // flip it above the trigger when it would run past the viewport bottom.
  useLayoutEffect(() => {
    if (!open || placement === null || placement.bottom !== "auto") {
      return;
    }
    const menu = menuRef.current;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (menu === null || rect === undefined || placement.top === "auto") {
      return;
    }
    const overflowPx = placement.top + menu.offsetHeight - (window.innerHeight - 8);
    if (overflowPx > 0 && rect.top > menu.offsetHeight + 12) {
      setPlacement({
        ...placement,
        top: "auto",
        bottom: window.innerHeight - rect.top + 4,
      });
    }
  });

  // Overlay blocks pointer scrolling behind the menu, so a window resize is
  // the only way placement can go stale — close instead of drifting.
  useEffect(() => {
    if (!open) {
      return;
    }
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className={className === undefined ? "custom-select" : `custom-select ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        data-value={value}
        onClick={toggle}
      >
        {current ? current.label : ""}
        <span className="select-arrow">▾</span>
      </button>
      {open &&
        placement !== null &&
        createPortal(
          <>
            <div className="menu-overlay" style={{ zIndex: 140 }} onClick={close} />
            <div
              ref={menuRef}
              className="custom-select-menu"
              role="listbox"
              aria-label={t("components.listLabel", [ariaLabel])}
              style={{
                position: "fixed",
                // Above .modal-backdrop (100); below the 260 full-screen layer.
                zIndex: 150,
                top: placement.top,
                bottom: placement.bottom,
                left: placement.left,
                right: placement.right,
                minWidth: placement.minWidth,
                maxWidth: placement.maxWidth,
              }}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  data-value={o.value}
                  className={"custom-select-item" + (o.value === value ? " current" : "")}
                  onClick={() => {
                    onChange(String(o.value));
                    close();
                  }}
                >
                  {o.label}
                  {o.value === value && <span className="menu-check">✓</span>}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
