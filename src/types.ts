export const SESSION_TODO_VERSION = 1 as const;
export const SESSION_TODO_ENTRY = "session-todo";

export type TodoMode = "serial" | "parallel";
export type TodoStatus = "pending" | "in_progress" | "completed" | "abandoned";

export interface TodoTask {
  id: string;
  content: string;
  status: TodoStatus;
  assignee?: string;
}

export interface TodoPhase {
  id: string;
  name: string;
  tasks: TodoTask[];
}

export interface TodoSnapshot {
  version: typeof SESSION_TODO_VERSION;
  revision: number;
  mode: TodoMode;
  phases: TodoPhase[];
}

export interface TodoCounts {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  abandoned: number;
}

export function emptySnapshot(mode: TodoMode = "serial"): TodoSnapshot {
  return { version: SESSION_TODO_VERSION, revision: 0, mode, phases: [] };
}

export function cloneSnapshot(snapshot: TodoSnapshot): TodoSnapshot {
  return {
    version: SESSION_TODO_VERSION,
    revision: snapshot.revision,
    mode: snapshot.mode,
    phases: snapshot.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      tasks: phase.tasks.map((task) => ({ ...task })),
    })),
  };
}

export function allTasks(snapshot: TodoSnapshot): TodoTask[] {
  return snapshot.phases.flatMap((phase) => phase.tasks);
}

export function countTasks(snapshot: TodoSnapshot): TodoCounts {
  const counts: TodoCounts = { total: 0, pending: 0, inProgress: 0, completed: 0, abandoned: 0 };
  for (const phase of snapshot.phases) {
    for (const task of phase.tasks) {
      counts.total++;
      if (task.status === "pending") counts.pending++;
      else if (task.status === "in_progress") counts.inProgress++;
      else if (task.status === "completed") counts.completed++;
      else counts.abandoned++;
    }
  }
  return counts;
}

export function isAllCompleted(snapshot: TodoSnapshot): boolean {
  const tasks = allTasks(snapshot);
  return tasks.length > 0 && tasks.every((task) => task.status === "completed");
}
