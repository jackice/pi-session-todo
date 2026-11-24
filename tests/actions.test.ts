import { describe, expect, it } from "vitest";

import { runSessionTodoAction } from "../src/actions.ts";
import type { SessionEntryLike } from "../src/persistence.ts";
import { TodoSession, type TodoSessionHost } from "../src/session.ts";
import { SESSION_TODO_ENTRY } from "../src/types.ts";

function createHost(): TodoSessionHost & { entries: () => readonly SessionEntryLike[]; stored: SessionEntryLike[] } {
  const stored: SessionEntryLike[] = [];
  return {
    stored,
    entries: () => stored,
    appendEntry(customType, data) {
      stored.push({ type: "custom", customType, data });
    },
  };
}

function init(session: TodoSession) {
  return runSessionTodoAction(session, {
    action: "init",
    phases: [
      { name: "Phase 1", tasks: [{ content: "a" }, { content: "b" }] },
      { name: "Phase 2", tasks: [{ content: "c" }] },
    ],
  });
}

describe("runSessionTodoAction", () => {
  it("initializes, persists and returns stable ids", () => {
    const host = createHost();
    const session = new TodoSession(host);
    const result = init(session);
    expect(result.ok).toBe(true);
    expect(session.snapshot.revision).toBe(1);
    expect(host.stored).toHaveLength(1);
    expect(host.stored[0]?.customType).toBe(SESSION_TODO_ENTRY);

    const phase = session.snapshot.phases[0];
    const task = phase?.tasks[0];
    expect(phase?.id).toMatch(/^p-/);
    expect(task?.id).toMatch(/^t-/);
  });

  it("requires replace for a second init", () => {
    const host = createHost();
    const session = new TodoSession(host);
    expect(init(session).ok).toBe(true);
    const second = init(session);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("already initialized");
    expect(host.stored).toHaveLength(1);

    const replaced = runSessionTodoAction(session, {
      action: "init",
      replace: true,
      phases: [{ name: "New", tasks: [{ content: "x" }] }],
    });
    expect(replaced.ok).toBe(true);
    expect(host.stored).toHaveLength(2);
  });

  it("starts, completes and auto-promotes in serial mode", () => {
    const host = createHost();
    const session = new TodoSession(host);
    init(session);
    const first = session.snapshot.phases[0]?.tasks[0];
    const second = session.snapshot.phases[0]?.tasks[1];
    if (first === undefined || second === undefined) throw new Error("fixture");

    expect(runSessionTodoAction(session, { action: "start", taskId: first.id }).ok).toBe(true);
    expect(session.snapshot.phases[0]?.tasks[0]?.status).toBe("in_progress");
    expect(runSessionTodoAction(session, { action: "start", taskId: second.id }).ok).toBe(false);

    expect(runSessionTodoAction(session, { action: "done", taskId: first.id }).ok).toBe(true);
    expect(session.snapshot.phases[0]?.tasks[0]?.status).toBe("completed");
    expect(session.snapshot.phases[0]?.tasks[1]?.status).toBe("in_progress");
  });

  it("does not persist no-op done", () => {
    const host = createHost();
    const session = new TodoSession(host);
    init(session);
    const task = session.snapshot.phases[0]?.tasks[0];
    if (task === undefined) throw new Error("fixture");
    runSessionTodoAction(session, { action: "done", taskId: task.id });
    const count = host.stored.length;
    const revision = session.snapshot.revision;
    const again = runSessionTodoAction(session, { action: "done", taskId: task.id });
    expect(again.ok).toBe(true);
    expect(host.stored).toHaveLength(count);
    expect(session.snapshot.revision).toBe(revision);
  });

  it("supports view and append without mutating on view", () => {
    const host = createHost();
    const session = new TodoSession(host);
    init(session);
    const count = host.stored.length;
    const view = runSessionTodoAction(session, { action: "view" });
    expect(view.ok).toBe(true);
    if (view.ok) expect(view.content).toContain("Phase 1");
    expect(host.stored).toHaveLength(count);

    const phase = session.snapshot.phases[0];
    if (phase === undefined) throw new Error("fixture");
    const appended = runSessionTodoAction(session, { action: "append", phaseId: phase.id, content: "new" });
    expect(appended.ok).toBe(true);
    expect(session.snapshot.phases[0]?.tasks.at(-1)?.content).toBe("new");
  });

  it("rejects revision mismatches and invalid operations", () => {
    const host = createHost();
    const session = new TodoSession(host);
    init(session);
    const task = session.snapshot.phases[0]?.tasks[0];
    if (task === undefined) throw new Error("fixture");
    const mismatch = runSessionTodoAction(session, { action: "start", taskId: task.id, expectedRevision: 99 });
    expect(mismatch.ok).toBe(false);
    expect(runSessionTodoAction(session, { action: "start" }).ok).toBe(false);
    expect(runSessionTodoAction(session, { action: "append", content: "x" }).ok).toBe(true);
  });

  it("keeps state when persistence fails", () => {
    const host = createHost();
    const session = new TodoSession(host);
    init(session);
    const revision = session.snapshot.revision;
    host.appendEntry = () => {
      throw new Error("EACCES");
    };
    const task = session.snapshot.phases[0]?.tasks[0];
    if (task === undefined) throw new Error("fixture");
    const result = runSessionTodoAction(session, { action: "start", taskId: task.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("EACCES");
    expect(session.snapshot.revision).toBe(revision);
    expect(session.snapshot.phases[0]?.tasks[0]?.status).toBe("pending");
  });

  it("is read-only when the latest snapshot is corrupt", () => {
    const host = createHost();
    host.stored.push({ type: "custom", customType: SESSION_TODO_ENTRY, data: { version: 99 } });
    const session = new TodoSession(host);
    expect(session.degraded).toBe(true);
    const view = runSessionTodoAction(session, { action: "view" });
    expect(view.ok).toBe(true);
    const initResult = init(session);
    expect(initResult.ok).toBe(false);
    if (!initResult.ok) expect(initResult.error).toContain("read-only");
  });
});
