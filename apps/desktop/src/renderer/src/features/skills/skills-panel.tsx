/**
 * Skills panel (D17): list, create, edit, delete, and import/export of the
 * skill library. Mounted in the settings dialog; the parent owns the library
 * state (durable in the Host since D17') so the bot form's picker stays in
 * sync. The `storage` prop is only for the bot-template half of the shared
 * import/export file.
 */
import { useRef, useState, type JSX } from "react";
import {
  deleteSkill,
  saveSkill,
  type SkillDefinition,
  type SkillLibrary,
} from "./skills.js";
import { exportLibrary, importLibrary } from "./library-io.js";
import { t } from "../../i18n.js";

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
    const result = saveSkill(props.library, {
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
          ? t("skills.duplicateName")
          : result.reason === "limit"
            ? t("skills.limitReached")
            : result.reason === "missing"
              ? t("skills.skillMissing")
              : t("skills.nameInstructionsRequired"),
      );
      return;
    }
    props.onChange(result.library);
    toast(
      editor.id ? t("skills.skillUpdated", [result.skill.name, result.skill.version]) : t("skills.skillCreated", [result.skill.name]),
    );
    setEditor(null);
    setError(null);
  };

  const remove = (skill: SkillDefinition): void => {
    props.onChange(deleteSkill(props.library, skill.id));
    toast(t("skills.skillDeleted", [skill.name]));
  };

  const download = (): void => {
    const text = exportLibrary(props.library, props.storage);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `deepseek-bot-library-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(t("skills.libraryExported"));
  };

  const readFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = importLibrary(
        props.library,
        props.storage,
        String(reader.result ?? ""),
      );
      if (!result.ok) {
        toast(t("skills.importFailed", [result.reason]));
        return;
      }
      props.onChange(result.library);
      const { addedSkills, skippedSkills, addedTemplates, skippedTemplates } =
        result.summary;
      toast(
        t("skills.importDone", [addedSkills, skippedSkills, addedTemplates, skippedTemplates]),
      );
    };
    reader.readAsText(file);
  };

  return (
    <div className="skills-panel">
      <div className="skills-toolbar">
        <button type="button" className="ghost-btn" onClick={startCreate}>
          {t("skills.newSkill")}
        </button>
        <button type="button" className="ghost-btn" onClick={download}>
          {t("skills.export")}
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => fileInput.current?.click()}
        >
          {t("skills.import")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label={t("skills.chooseLibraryFile")}
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) readFile(file);
          }}
        />
      </div>

      {props.library.skills.length === 0 ? (
        <p className="form-hint">{t("skills.emptyState")}</p>
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
                  {t("skills.edit")}
                </button>
                <button type="button" className="ghost-btn" onClick={() => remove(skill)}>
                  {t("shell.delete")}
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
            placeholder={t("skills.skillName")}
            aria-label={t("skills.skillName")}
            onChange={(event) =>
              setEditor((prev) => (prev ? { ...prev, name: event.target.value } : prev))
            }
          />
          <input
            value={editor.description}
            maxLength={2000}
            placeholder={t("skills.shortDescriptionPlaceholder")}
            aria-label={t("skills.skillDescription")}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
          />
          <textarea
            value={editor.instructions}
            rows={5}
            placeholder={t("skills.instructionsPlaceholder")}
            aria-label={t("skills.skillInstructions")}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, instructions: event.target.value } : prev,
              )
            }
          />
          <input
            value={editor.capabilities}
            maxLength={200}
            placeholder={t("skills.declaredCapabilitiesPlaceholder")}
            aria-label={t("skills.declaredCapabilities")}
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
              {t("shell.cancel")}
            </button>
            <button type="button" className="primary-btn" onClick={commit}>
              {t("shell.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
