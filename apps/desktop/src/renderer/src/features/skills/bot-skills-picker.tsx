/**
 * Bot skills picker (D17): a checkbox group rendered inside the bot edit form
 * via the `skillsSlot` slot, so the form keeps ownership of its own fields and
 * validation.
 */
import type { JSX } from "react";
import type { SkillDefinition } from "./skills.js";

export function BotSkillsPicker(props: {
  skills: readonly SkillDefinition[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}): JSX.Element {
  const toggle = (id: string): void => {
    props.onChange(
      props.selected.includes(id)
        ? props.selected.filter((entry) => entry !== id)
        : [...props.selected, id],
    );
  };

  return (
    <div className="form-field skills-bind">
      <span>技能（按勾选顺序拼进消息上下文）</span>
      {props.skills.length === 0 ? (
        <p className="form-hint">还没有技能。先到设置 → 技能 里新建一个。</p>
      ) : (
        <div className="skills-bind-list" role="group" aria-label="为该 bot 启用技能">
          {props.skills.map((skill) => (
            <label key={skill.id} className="skills-bind-item">
              <input
                type="checkbox"
                checked={props.selected.includes(skill.id)}
                onChange={() => toggle(skill.id)}
              />
              <span>{skill.name}</span>
              <em className="skills-version">v{skill.version}</em>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
