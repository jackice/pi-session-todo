import { Type, type Static } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { runSessionTodoAction } from "./actions.ts";
import type { TodoSession } from "./session.ts";
import type { TodoSnapshot } from "./types.ts";

const actionSchema = Type.Union([
  Type.Literal("init"),
  Type.Literal("start"),
  Type.Literal("done"),
  Type.Literal("drop"),
  Type.Literal("rm"),
  Type.Literal("append"),
  Type.Literal("view"),
]);

const statusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
  Type.Literal("abandoned"),
]);

const phaseSchema = Type.Object({
  name: Type.String({ description: "Phase name" }),
  tasks: Type.Optional(
    Type.Array(
      Type.Object({
        content: Type.String({ description: "Task text" }),
        status: Type.Optional(statusSchema),
      }),
    ),
  ),
});

export const sessionTodoParams = Type.Object({
  action: actionSchema,
  mode: Type.Optional(Type.Union([Type.Literal("serial"), Type.Literal("parallel")])),
  phases: Type.Optional(Type.Array(phaseSchema)),
  taskId: Type.Optional(Type.String({ description: "Stable task id returned by init/view" })),
  phaseId: Type.Optional(Type.String({ description: "Target phase id for append" })),
  content: Type.Optional(Type.String({ description: "Task text for append" })),
  replace: Type.Optional(Type.Boolean({ description: "Overwrite an existing todo snapshot on init" })),
  expectedRevision: Type.Optional(Type.Number({ description: "Compare-and-set revision guard" })),
});

export type SessionTodoParams = Static<typeof sessionTodoParams>;

export interface SessionTodoDetails {
  version: 1;
  snapshot: TodoSnapshot;
}

export function createSessionTodoTool(
  getSession: () => TodoSession | undefined,
): ToolDefinition<typeof sessionTodoParams, SessionTodoDetails> {
  return {
    name: "session_todo",
    label: "Session TODO",
    description:
      "Manage the current session's TODO progress. Operations: init, start, done, drop, rm, append, view. " +
      "Task ids are stable; use view to read them. Serial mode keeps one in_progress task and promotes the next pending after done/drop/rm. " +
      "Parallel mode requires explicit start. done only means the task is explicitly finished, not that a reviewer approved it.",
    promptSnippet: "Track multi-step session progress with a persistent TODO HUD",
    promptGuidelines: [
      "Use session_todo for multi-step work that benefits from visible progress; skip it for simple one-shot tasks.",
      "Call session_todo with view before mutating if you do not already have current task ids.",
      "Use done only for explicit completion; do not mark tasks done on behalf of a reviewer.",
    ],
    parameters: sessionTodoParams,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (process.env.PI_SUBAGENT_CHILD === "1" && params.action !== "view") {
        return {
          content: [
            {
              type: "text",
              text: "session_todo is read-only in subagents; report progress to the parent session instead",
            },
          ],
          isError: true,
          details: { version: 1, snapshot: { version: 1, revision: 0, mode: "serial", phases: [] } },
        };
      }
      const session = getSession();
      if (session === undefined) {
        return {
          content: [{ type: "text", text: "session_todo is not ready for this session" }],
          isError: true,
          details: { version: 1, snapshot: { version: 1, revision: 0, mode: "serial", phases: [] } },
        };
      }
      const outcome = runSessionTodoAction(session, params);
      if (!outcome.ok) {
        return {
          content: [{ type: "text", text: `session_todo error: ${outcome.error}` }],
          isError: true,
          details: { version: 1, snapshot: outcome.snapshot },
        };
      }
      return {
        content: [{ type: "text", text: outcome.content }],
        details: { version: 1, snapshot: outcome.snapshot },
      };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", "session_todo ") + theme.fg("accent", args.action), 0, 0);
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "updating session todo..."), 0, 0);
      const first = result.content[0];
      const text = first?.type === "text" ? first.text.split("\n")[0] ?? "" : "";
      return new Text(theme.fg(result.isError === true ? "error" : "success", text), 0, 0);
    },
  };
}
