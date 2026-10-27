/**
 * The merged message catalogue (D22).
 *
 * Domain files below are generated from the sweep mapping; `d22.ts` carries the
 * copy D22 introduces by hand. Keys are a closed union so a `t("…")` typo fails
 * the typecheck instead of surfacing as a raw key in the UI.
 */
import type { Message } from "../types.js";
import { automationMessages } from "./automation.js";
import { avatarsMessages } from "./avatars.js";
import { botsMessages } from "./bots.js";
import { canvasMessages } from "./canvas.js";
import { chatMessages } from "./chat.js";
import { commonMessages } from "./common.js";
import { componentsMessages } from "./components.js";
import { connectorsMessages } from "./connectors.js";
import { mainMessages } from "./main.js";
import { memoryMessages } from "./memory.js";
import { permissionsMessages } from "./permissions.js";
import { questionsMessages } from "./questions.js";
import { reasonerMessages } from "./reasoner.js";
import { runsMessages } from "./runs.js";
import { searchMessages } from "./search.js";
import { servicesMessages } from "./services.js";
import { shellMessages } from "./shell.js";
import { skillsMessages } from "./skills.js";
import { tasksMessages } from "./tasks.js";
import { workflowMessages } from "./workflow.js";
import { d22Messages } from "./d22.js";

export const MESSAGES = {
  ...automationMessages,
  ...avatarsMessages,
  ...botsMessages,
  ...canvasMessages,
  ...chatMessages,
  ...commonMessages,
  ...componentsMessages,
  ...connectorsMessages,
  ...mainMessages,
  ...memoryMessages,
  ...permissionsMessages,
  ...questionsMessages,
  ...reasonerMessages,
  ...runsMessages,
  ...searchMessages,
  ...servicesMessages,
  ...shellMessages,
  ...skillsMessages,
  ...tasksMessages,
  ...workflowMessages,
  ...d22Messages,
} satisfies Record<string, Message>;

export type MessageKey = keyof typeof MESSAGES;

export const MESSAGE_KEYS = Object.keys(MESSAGES) as MessageKey[];
