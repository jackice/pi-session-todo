import {
  appendTask,
  completeTask,
  createInitialSnapshot,
  dropTask,
  removeTask,
  startTask,
  type MutationResult,
  type PhaseInput,
} from "./store.ts";
import type { TodoMode, TodoSnapshot, TodoStatus } from "./types.ts";
import { countTasks, allTasks } from "./types.ts";
import { TodoSession } from "./session.ts";

export interface SessionTodoInput {
  action: "init" | "start" | "done" | "drop" | "rm" | "append" | "view";
  mode?: TodoMode;
  phases?: readonly PhaseInput[];
  taskId?: string;
  phaseId?: string;
  content?: string;
  replace?: boolean;
  expectedRevision?: number;
}

export type ActionOutcome =
  | { ok: true; content: string; snapshot: TodoSnapshot }
  | { ok: false; error: string; snapshot: TodoSnapshot };

export function runSessionTodoAction(session: TodoSession, input: SessionTodoInput): ActionOutcome {
  if (input.action === "view") {
    return { ok: true, content: renderSnapshotText(session.snapshot), snapshot: session.snapshot };
  }

  if (input.expectedRevision !== undefined && input.expectedRevision !== session.snapshot.revision) {
    return {
      ok: false,
      error: `revision mismatch: expected ${input.expectedRevision}, actual ${session.snapshot.revision}`,
      snapshot: session.snapshot,
    };
  }

  if (input.action === "init") {
    const hasTasks = allTasks(session.snapshot).length > 0;
    if (hasTasks && input.replace !== true) {
      return {
        ok: false,
        error: "session todo already initialized; pass replace=true to overwrite",
        snapshot: session.snapshot,
      };
    }
    if (input.phases === undefined || input.phases.length === 0) {
      return { ok: false, error: "init requires phases", snapshot: session.snapshot };
    }
    let next: TodoSnapshot;
    try {
      next = createInitialSnapshot(input.phases, input.mode ?? session.snapshot.mode);
    } catch (error) {
      return { ok: false, error: messageOf(error), snapshot: session.snapshot };
    }
    const committed = session.commit(next);
    if (!committed.ok) return committed;
    return {
      ok: true,
      content: `initialized session todo (${countTasks(next).total} tasks)\n${renderSnapshotText(next)}`,
      snapshot: next,
    };
  }

  if (input.taskId === undefined && (input.action === "start" || input.action === "done" || input.action === "drop" || input.action === "rm")) {
    return { ok: false, error: `${input.action} requires taskId`, snapshot: session.snapshot };
  }

  const taskId = input.taskId ?? "";
  let operation: ((snapshot: TodoSnapshot) => MutationResult) | undefined;
  switch (input.action) {
    case "start":
      operation = (snapshot) => startTask(snapshot, taskId);
      break;
    case "done":
      operation = (snapshot) => completeTask(snapshot, taskId);
      break;
    case "drop":
      operation = (snapshot) => dropTask(snapshot, taskId);
      break;
    case "rm":
      operation = (snapshot) => removeTask(snapshot, taskId);
      break;
    case "append":
      if (input.content === undefined) {
        return { ok: false, error: "append requires content", snapshot: session.snapshot };
      }
      operation = (snapshot) => appendTask(snapshot, input.phaseId, input.content ?? "");
      break;
  }

  if (operation === undefined) {
    return { ok: false, error: `unsupported action: ${input.action}`, snapshot: session.snapshot };
  }

  const result = session.mutate(operation);
  if (!result.ok) return { ok: false, error: result.error, snapshot: result.snapshot };
  return {
    ok: true,
    content: `${result.summary ?? input.action}\n${renderSnapshotText(result.snapshot)}`,
    snapshot: result.snapshot,
  };
}

export function renderSnapshotText(snapshot: TodoSnapshot): string {
  const counts = countTasks(snapshot);
  if (snapshot.phases.length === 0) return "Session TODO is empty.";
  const lines: string[] = [];
  for (const phase of snapshot.phases) {
    const done = phase.tasks.filter((task) => task.status === "completed").length;
    lines.push(`${phase.name} (${done}/${phase.tasks.length}) [${phase.id}]`);
    for (const task of phase.tasks) {
      lines.push(`  ${icon(task.status)} ${task.id} ${task.content}`);
    }
  }
  lines.push(
    `total=${counts.total} pending=${counts.pending} in_progress=${counts.inProgress} completed=${counts.completed} abandoned=${counts.abandoned} revision=${snapshot.revision}`,
  );
  return lines.join("\n");
}

function icon(status: TodoStatus): string {
  switch (status) {
    case "pending":
      return "○";
    case "in_progress":
      return "▸";
    case "completed":
      return "✓";
    case "abandoned":
      return "✗";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
