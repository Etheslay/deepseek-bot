import { useState } from "react";

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
};

/**
 * 自绘下拉：原生 <select> 在 Windows 上无法去掉系统蓝色选中高亮，
 * 这里用按钮 + 弹层实现，选中/悬停均为暗灰。
 */
export function CustomSelect({ value, options, onChange, ariaLabel, disabled = false }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className="custom-select">
      <button
        type="button"
        className="custom-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? current.label : ""}
        <span className="select-arrow">▾</span>
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />
          <div className="custom-select-menu" role="listbox" aria-label={ariaLabel + "列表"}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
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
