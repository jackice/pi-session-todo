import { isRecord } from "./guards.ts";
import {
  SESSION_TODO_ENTRY,
  SESSION_TODO_VERSION,
  emptySnapshot,
  type TodoMode,
  type TodoPhase,
  type TodoSnapshot,
  type TodoStatus,
  type TodoTask,
} from "./types.ts";

export interface SessionEntryLike {
  type: string;
  customType?: string;
  data?: unknown;
}

export type SnapshotParseResult =
  | { ok: true; snapshot: TodoSnapshot }
  | { ok: false; reason: string };

export interface RehydrateResult {
  snapshot: TodoSnapshot;
  degraded: boolean;
  reason?: string;
}

function parseMode(value: unknown): TodoMode | undefined {
  return value === "serial" || value === "parallel" ? value : undefined;
}

function parseStatus(value: unknown): TodoStatus | undefined {
  return value === "pending" || value === "in_progress" || value === "completed" || value === "abandoned"
    ? value
    : undefined;
}

function parseTask(value: unknown): TodoTask | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || value.id.length === 0) return undefined;
  if (typeof value.content !== "string") return undefined;
  const status = parseStatus(value.status);
  if (status === undefined) return undefined;
  const task: TodoTask = { id: value.id, content: value.content, status };
  if (typeof value.assignee === "string") task.assignee = value.assignee;
  return task;
}

function parsePhase(value: unknown): TodoPhase | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || value.id.length === 0) return undefined;
  if (typeof value.name !== "string") return undefined;
  if (!Array.isArray(value.tasks)) return undefined;
  const tasks: TodoTask[] = [];
  for (const raw of value.tasks) {
    const task = parseTask(raw);
    if (task === undefined) return undefined;
    tasks.push(task);
  }
  return { id: value.id, name: value.name, tasks };
}

export function parseSnapshot(value: unknown): SnapshotParseResult {
  if (!isRecord(value)) return { ok: false, reason: "snapshot is not an object" };
  if (value.version !== SESSION_TODO_VERSION) return { ok: false, reason: `unsupported version: ${String(value.version)}` };
  if (typeof value.revision !== "number" || !Number.isFinite(value.revision) || value.revision < 0) {
    return { ok: false, reason: "invalid revision" };
  }
  const mode = parseMode(value.mode);
  if (mode === undefined) return { ok: false, reason: "invalid mode" };
  if (!Array.isArray(value.phases)) return { ok: false, reason: "phases is not an array" };

  const phases: TodoPhase[] = [];
  for (const raw of value.phases) {
    const phase = parsePhase(raw);
    if (phase === undefined) return { ok: false, reason: "invalid phase" };
    phases.push(phase);
  }

  const phaseIds = new Set<string>();
  const taskIds = new Set<string>();
  let inProgress = 0;
  for (const phase of phases) {
    if (phaseIds.has(phase.id)) return { ok: false, reason: `duplicate phase id: ${phase.id}` };
    phaseIds.add(phase.id);
    for (const task of phase.tasks) {
      if (taskIds.has(task.id)) return { ok: false, reason: `duplicate task id: ${task.id}` };
      taskIds.add(task.id);
      if (task.status === "in_progress") inProgress++;
    }
  }
  if (mode === "serial" && inProgress > 1) return { ok: false, reason: "serial snapshot has multiple in_progress tasks" };

  return {
    ok: true,
    snapshot: { version: SESSION_TODO_VERSION, revision: value.revision, mode, phases },
  };
}

/** 从当前 branch 反向查找最新合法 snapshot；最新损坏时降级为只读。 */
export function rehydrate(entries: readonly SessionEntryLike[], fallback: TodoMode = "serial"): RehydrateResult {
  const empty = emptySnapshot(fallback);
  let degraded = false;
  let reason: string | undefined;
  let sawEntry = false;

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry === undefined) continue;
    if (entry.type !== "custom" || entry.customType !== SESSION_TODO_ENTRY) continue;
    sawEntry = true;
    const parsed = parseSnapshot(entry.data);
    if (parsed.ok) {
      return degraded ? { snapshot: parsed.snapshot, degraded: true, ...(reason === undefined ? {} : { reason }) } : { snapshot: parsed.snapshot, degraded: false };
    }
    degraded = true;
    reason = parsed.reason;
  }

  if (sawEntry) {
    return { snapshot: empty, degraded: true, ...(reason === undefined ? {} : { reason }) };
  }
  return { snapshot: empty, degraded: false };
}
