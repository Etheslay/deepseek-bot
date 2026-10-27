import { useState } from "react";
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
 * 自绘下拉：原生 <select> 在 Windows 上无法去掉系统蓝色选中高亮，
 * 这里用按钮 + 弹层实现，选中/悬停均为暗灰。
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
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className={className === undefined ? "custom-select" : `custom-select ${className}`}>
      <button
        type="button"
        className="custom-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        data-value={value}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? current.label : ""}
        <span className="select-arrow">▾</span>
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />
          <div className="custom-select-menu" role="listbox" aria-label={t("components.listLabel", [ariaLabel])}>
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
                  setOpen(false);
                }}
              >
                {o.label}
                {o.value === value && <span className="menu-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
