/**
 * D15 阶段二 write-layer capabilities (AGENT_PLATFORM §4 写（应用）切片,
 * FR-12 聊天驱动创建).
 *
 * `create_bot_draft` is deliberately side-effect-free: it validates the
 * draft against the contract schema and returns it for chat/editor preview
 * — 草案不落库, nothing persists it. The other three forward to contract
 * methods through the injected caller; the host method layer owns the
 * business rules (atomic batch, avatar pool assignment, ledger-backed
 * revoke), the gateway adds validation + audit only.
 *
 * Tool schemas are strict mirrors of the contract request schemas so model
 * typos are rejected here; dispatch re-validates against the authoritative
 * contract schema anyway (CONTRACTS §3).
 */
import { AvatarSchema, BotCreationDraftSchema } from "@deepseek-bot/contracts";
import { z } from "zod";
import type { ToolCapability } from "./types.js";
import type { ContractCaller } from "./read-tools.js";

type CapabilityShape = Pick<ToolCapability, "name" | "description" | "inputSchema">;

const createBotDraftShape: CapabilityShape = {
  name: "create_bot_draft",
  description:
    "Produce a bot creation draft for editor preview (NOT saved — the user " +
    "reviews and completes it in the editor). All fields optional.",
  inputSchema: BotCreationDraftSchema,
};

const createGroupShape: CapabilityShape = {
  name: "create_group",
  description: "Create a bot group (group.create contract method).",
  inputSchema: z.object({ name: z.string().min(1).max(200) }).strict(),
};

const createBotsBatchShape: CapabilityShape = {
  name: "create_bots_batch",
  description:
    "Create 1-20 bots in one group in a single reversible batch. Omitted " +
    "per-bot fields fall back to `defaults`; omitted avatars get distinct " +
    "shape×color assignments inside the group (explicit avatars win). " +
    "Pass newGroup to mint the group in the same operation, or groupId to " +
    "target an existing one — never both. Returns batchId for revoke_batch.",
  inputSchema: z
    .object({
      groupId: z.string().uuid().optional(),
      newGroup: z.object({ name: z.string().min(1).max(200) }).optional(),
      defaults: z
        .object({
          modelProfileId: z.string().uuid().optional(),
          workspaceId: z.string().uuid().optional(),
          toolPolicyId: z.string().uuid().optional(),
        })
        .optional(),
      bots: z
        .array(
          z.object({
            name: z.string().min(1).max(200),
            instructions: z.string().max(100_000),
            modelProfileId: z.string().uuid().optional(),
            workspaceId: z.string().uuid().optional(),
            toolPolicyId: z.string().uuid().optional(),
            // Reused verbatim from the contract: this list drifted from the
            // canonical pool once already, which is why it is not restated.
            avatar: AvatarSchema.optional(),
          }),
        )
        .min(1)
        .max(20),
      idempotencyKey: z.string().uuid().optional(),
    })
    .strict()
    .refine((request) => !(request.groupId !== undefined && request.newGroup !== undefined), {
      message: "groupId and newGroup are mutually exclusive",
    }),
};

const revokeBatchShape: CapabilityShape = {
  name: "revoke_batch",
  description:
    "Undo a whole creation batch (creation.revoke): archives every bot the " +
    "batch created and, when the batch minted the group, the group too.",
  inputSchema: z.object({ batchId: z.string().uuid() }).strict(),
};

/** Bind the four write-layer capabilities to a contract caller. */
export function bindWriteTools(caller: ContractCaller): ToolCapability[] {
  return [
    {
      ...createBotDraftShape,
      // No contract call: the draft is validated data and nothing else.
      handler: async (params) => ({ draft: params }),
    },
    {
      ...createGroupShape,
      handler: async (params) => caller("group.create", params),
    },
    {
      ...createBotsBatchShape,
      handler: async (params) => caller("bot.batchCreate", params),
    },
    {
      ...revokeBatchShape,
      handler: async (params) => caller("creation.revoke", params),
    },
  ];
}
