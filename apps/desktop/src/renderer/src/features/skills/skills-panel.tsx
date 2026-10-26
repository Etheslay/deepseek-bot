/**
 * Skills panel (D17): list, create, edit, delete, and import/export of the
 * skill library. Mounted in the settings dialog; the parent owns the library
 * state so the bot form's picker stays in sync.
 */
import { useRef, useState, type JSX } from "react";
import {
  deleteSkill,
  saveSkill,
  type SkillDefinition,
  type SkillLibrary,
} from "./skills.js";
import { exportLibrary, importLibrary } from "./library-io.js";

type EditorState = {
  id: string | null;
  name: string;
  description: string;
  instructions: string;
  capabilities: string;
};

const EMPTY_EDITOR: EditorState = {
  id: null,
  name: "",
  description: "",
  instructions: "",
  capabilities: "",
};

export function SkillsPanel(props: {
  storage: Storage;
  library: SkillLibrary;
  onChange: (library: SkillLibrary) => void;
  onToast?: (message: string) => void;
}): JSX.Element {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const toast = (message: string): void => props.onToast?.(message);

  const startCreate = (): void => {
    setEditor({ ...EMPTY_EDITOR });
    setError(null);
  };

  const startEdit = (skill: SkillDefinition): void => {
    setEditor({
      id: skill.id,
      name: skill.name,
      description: skill.description ?? "",
      instructions: skill.instructions,
      capabilities: skill.capabilities.join(", "),
    });
    setError(null);
  };

  const commit = (): void => {
    if (!editor) return;
    const result = saveSkill(props.storage, props.library, {
      ...(editor.id ? { id: editor.id } : {}),
      name: editor.name,
      description: editor.description,
      instructions: editor.instructions,
      capabilities: editor.capabilities
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    });
    if (!result.ok) {
      setError(
        result.reason === "duplicate"
          ? "同名技能已存在"
          : result.reason === "limit"
            ? "技能数量已达上限"
            : result.reason === "missing"
              ? "这个技能已经不存在了"
              : "名称和指令不能为空",
      );
      return;
    }
    props.onChange(result.library);
    toast(
      editor.id ? `已更新「${result.skill.name}」到 v${result.skill.version}` : `已新建「${result.skill.name}」`,
    );
    setEditor(null);
    setError(null);
  };

  const remove = (skill: SkillDefinition): void => {
    props.onChange(deleteSkill(props.storage, props.library, skill.id));
    toast(`已删除「${skill.name}」`);
  };

  const download = (): void => {
    const text = exportLibrary(props.storage);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `deepseek-bot-library-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast("已导出技能与模板");
  };

  const readFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = importLibrary(
        props.storage,
        props.library,
        String(reader.result ?? ""),
      );
      if (!result.ok) {
        toast(`导入失败：${result.reason}`);
        return;
      }
      props.onChange(result.library);
      const { addedSkills, skippedSkills, addedTemplates, skippedTemplates } =
        result.summary;
      toast(
        `导入完成：技能 +${addedSkills}（跳过 ${skippedSkills}），模板 +${addedTemplates}（跳过 ${skippedTemplates}）`,
      );
    };
    reader.readAsText(file);
  };

  return (
    <div className="skills-panel">
      <div className="skills-toolbar">
        <button type="button" className="ghost-btn" onClick={startCreate}>
          新建技能
        </button>
        <button type="button" className="ghost-btn" onClick={download}>
          导出
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => fileInput.current?.click()}
        >
          导入
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="选择要导入的库文件"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) readFile(file);
          }}
        />
      </div>

      {props.library.skills.length === 0 ? (
        <p className="form-hint">还没有技能。技能会按 bot 勾选的顺序拼进消息上下文。</p>
      ) : (
        <ul className="skills-list" role="list">
          {props.library.skills.map((skill) => (
            <li key={skill.id} className="skills-row">
              <div className="skills-row-main">
                <span className="skills-name">{skill.name}</span>
                <em className="skills-version">v{skill.version}</em>
                {skill.capabilities.length > 0 && (
                  <span className="skills-caps">{skill.capabilities.join(" · ")}</span>
                )}
                {skill.description && (
                  <span className="skills-desc">{skill.description}</span>
                )}
              </div>
              <div className="skills-row-actions">
                <button type="button" className="ghost-btn" onClick={() => startEdit(skill)}>
                  编辑
                </button>
                <button type="button" className="ghost-btn" onClick={() => remove(skill)}>
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editor && (
        <div className="skills-editor">
          <input
            className="form-name"
            value={editor.name}
            maxLength={200}
            placeholder="技能名称"
            aria-label="技能名称"
            onChange={(event) =>
              setEditor((prev) => (prev ? { ...prev, name: event.target.value } : prev))
            }
          />
          <input
            value={editor.description}
            maxLength={2000}
            placeholder="一句话说明（可选）"
            aria-label="技能说明"
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
          />
          <textarea
            value={editor.instructions}
            rows={5}
            placeholder="技能指令：这段文字会作为参考上下文拼给模型"
            aria-label="技能指令"
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, instructions: event.target.value } : prev,
              )
            }
          />
          <input
            value={editor.capabilities}
            maxLength={200}
            placeholder="声明能力（逗号分隔，仅声明不强制）"
            aria-label="声明能力"
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, capabilities: event.target.value } : prev,
              )
            }
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="skills-editor-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                setEditor(null);
                setError(null);
              }}
            >
              取消
            </button>
            <button type="button" className="primary-btn" onClick={commit}>
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
