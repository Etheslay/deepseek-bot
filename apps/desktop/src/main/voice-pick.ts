/** User-picked local whisper paths. The renderer cannot supply the path. */
import { dialog, type BrowserWindow } from "electron";
import { tr } from "./i18n.js";
import type { VoicePickKind, VoicePickResult } from "../shared/voice-pick.js";

export async function pickVoiceFile(parent: BrowserWindow, kind: VoicePickKind): Promise<VoicePickResult> {
  const allFiles = { name: tr("main.allFilesFilter"), extensions: ["*"] };
  const picked = await dialog.showOpenDialog(parent, {
    title: kind === "bin" ? tr("main.pickWhisperBin") : tr("main.pickWhisperModel"),
    properties: ["openFile"],
    filters:
      kind === "bin"
        ? [{ name: tr("main.executablesFilter"), extensions: ["exe"] }, allFiles]
        : [{ name: tr("main.modelFilesFilter"), extensions: ["bin"] }, allFiles],
  });
  if (picked.canceled || picked.filePaths.length !== 1) return { ok: false, code: "cancelled" };
  return { ok: true, path: picked.filePaths[0]! };
}
