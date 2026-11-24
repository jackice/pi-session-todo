import crypto from "node:crypto";

import {
  allTasks,
  cloneSnapshot,
  emptySnapshot,
  type TodoMode,
  type TodoPhase,
  type TodoSnapshot,
  type TodoStatus,
  type TodoTask,
} from "./types.ts";

export const MAX_PHASES = 50;
export const MAX_TASKS = 200;
export const MAX_CONTENT_LENGTH = 500;
export const MAX_PHASE_NAME_LENGTH = 200;
export const MAX_SNAPSHOT_BYTES = 64 * 1024;

export class TodoStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoStoreError";
  }
}

export interface PhaseInput {
  name: string;
  tasks?: readonly { content: string; status?: TodoStatus }[];
}

export interface MutationResult {
  snapshot: TodoSnapshot;
  changed: boolean;
  summary: string;
}

export type IdFactory = () => string;

export function defaultId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function nextId(prefix: string, createId: IdFactory): string {
  return `${prefix}-${createId()}`;
}

export function createInitialSnapshot(
  phases: readonly PhaseInput[],
  mode: TodoMode,
  createId: IdFactory = defaultId,
): TodoSnapshot {
  if (phases.length === 0) throw new TodoStoreError("init requires at least one phase");
  const snapshot = emptySnapshot(mode);
  snapshot.phases = phases.map((phase) => {
    const name = phase.name.trim();
    if (name.length === 0) throw new TodoStoreError("phase name cannot be empty");
    if (name.length > MAX_PHASE_NAME_LENGTH) throw new TodoStoreError("phase name is too long");
    const phaseId = nextId("p", createId);
    const tasks = (phase.tasks ?? []).map((task) => {
      const content = task.content.trim();
      if (content.length === 0) throw new TodoStoreError("task content cannot be empty");
      if (content.length > MAX_CONTENT_LENGTH) throw new TodoStoreError("task content is too long");
      return { id: nextId("t", createId), content, status: task.status ?? "pending" } satisfies TodoTask;
    });
    return { id: phaseId, name, tasks } satisfies TodoPhase;
  });
  snapshot.revision = 1;
  validateSnapshot(snapshot);
  return snapshot;
}

export function validateSnapshot(snapshot: TodoSnapshot): void {
  if (snapshot.phases.length > MAX_PHASES) throw new TodoStoreError(`too many phases (max ${MAX_PHASES})`);
  const tasks = allTasks(snapshot);
  if (tasks.length > MAX_TASKS) throw new TodoStoreError(`too many tasks (max ${MAX_TASKS})`);
  for (const task of tasks) {
    if (task.content.length > MAX_CONTENT_LENGTH) throw new TodoStoreError("task content is too long");
    if (task.content.trim().length === 0) throw new TodoStoreError("task content cannot be empty");
  }
  for (const phase of snapshot.phases) {
    if (phase.name.trim().length === 0) throw new TodoStoreError("phase name cannot be empty");
    if (phase.name.length > MAX_PHASE_NAME_LENGTH) throw new TodoStoreError("phase name is too long");
  }
  if (snapshot.mode === "serial" && tasks.filter((task) => task.status === "in_progress").length > 1) {
    throw new TodoStoreError("serial mode allows at most one in_progress task");
  }
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf-8") > MAX_SNAPSHOT_BYTES) {
    throw new TodoStoreError("todo snapshot is too large");
  }
}

interface TaskLocation {
  phase: TodoPhase;
  task: TodoTask;
  taskIndex: number;
}

function locate(snapshot: TodoSnapshot, taskId: string): TaskLocation {
  for (const phase of snapshot.phases) {
    const taskIndex = phase.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex >= 0) {
      const task = phase.tasks[taskIndex];
      if (task === undefined) break;
      return { phase, task, taskIndex };
    }
  }
  throw new TodoStoreError(`unknown task: ${taskId}`);
}

function hasInProgress(snapshot: TodoSnapshot): boolean {
  return allTasks(snapshot).some((task) => task.status === "in_progress");
}

/** 串行模式下自动把第一个 pending 提升为 in_progress。 */
function advanceSerial(snapshot: TodoSnapshot): boolean {
  if (snapshot.mode !== "serial" || hasInProgress(snapshot)) return false;
  for (const phase of snapshot.phases) {
    for (const task of phase.tasks) {
      if (task.status === "pending") {
        task.status = "in_progress";
        return true;
      }
    }
  }
  return false;
}

function finish(snapshot: TodoSnapshot, base: TodoSnapshot, changed: boolean, summary: string): MutationResult {
  if (!changed) return { snapshot: base, changed: false, summary };
  snapshot.revision = base.revision + 1;
  validateSnapshot(snapshot);
  return { snapshot, changed: true, summary };
}

export function startTask(snapshot: TodoSnapshot, taskId: string): MutationResult {
  const working = cloneSnapshot(snapshot);
  const { task } = locate(working, taskId);
  if (task.status === "in_progress") return { snapshot, changed: false, summary: `task ${taskId} already in progress` };
  if (task.status !== "pending") throw new TodoStoreError(`cannot start task in status ${task.status}`);
  if (working.mode === "serial" && hasInProgress(working)) {
    throw new TodoStoreError("serial mode allows only one in_progress task");
  }
  task.status = "in_progress";
  return finish(working, snapshot, true, `started ${taskId}`);
}

export function completeTask(snapshot: TodoSnapshot, taskId: string): MutationResult {
  const working = cloneSnapshot(snapshot);
  const { task } = locate(working, taskId);
  if (task.status === "completed") return { snapshot, changed: false, summary: `task ${taskId} already completed` };
  if (task.status === "abandoned") throw new TodoStoreError("cannot complete an abandoned task");
  task.status = "completed";
  advanceSerial(working);
  return finish(working, snapshot, true, `completed ${taskId}`);
}

export function dropTask(snapshot: TodoSnapshot, taskId: string): MutationResult {
  const working = cloneSnapshot(snapshot);
  const { task } = locate(working, taskId);
  if (task.status === "abandoned") return { snapshot, changed: false, summary: `task ${taskId} already abandoned` };
  if (task.status === "completed") throw new TodoStoreError("cannot abandon a completed task");
  task.status = "abandoned";
  advanceSerial(working);
  return finish(working, snapshot, true, `abandoned ${taskId}`);
}

export function removeTask(snapshot: TodoSnapshot, taskId: string): MutationResult {
  const working = cloneSnapshot(snapshot);
  const { phase, taskIndex } = locate(working, taskId);
  phase.tasks.splice(taskIndex, 1);
  advanceSerial(working);
  return finish(working, snapshot, true, `removed ${taskId}`);
}

export function appendTask(
  snapshot: TodoSnapshot,
  phaseId: string | undefined,
  content: string,
  createId: IdFactory = defaultId,
): MutationResult {
  const text = content.trim();
  if (text.length === 0) throw new TodoStoreError("task content cannot be empty");
  if (text.length > MAX_CONTENT_LENGTH) throw new TodoStoreError("task content is too long");

  const working = cloneSnapshot(snapshot);
  const phase = resolvePhase(working, phaseId);
  const task: TodoTask = { id: nextId("t", createId), content: text, status: "pending" };
  phase.tasks.push(task);
  return finish(working, snapshot, true, `appended ${task.id}`);
}

function resolvePhase(snapshot: TodoSnapshot, phaseId: string | undefined): TodoPhase {
  if (phaseId !== undefined) {
    const phase = snapshot.phases.find((candidate) => candidate.id === phaseId);
    if (phase === undefined) throw new TodoStoreError(`unknown phase: ${phaseId}`);
    return phase;
  }
  const activePhase = snapshot.phases.find((phase) => phase.tasks.some((task) => task.status === "in_progress"));
  if (activePhase !== undefined) return activePhase;
  const last = snapshot.phases.at(-1);
  if (last === undefined) throw new TodoStoreError("init the todo list before appending tasks");
  return last;
}
