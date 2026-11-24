import { describe, expect, it } from "vitest";

import {
  appendTask,
  completeTask,
  createInitialSnapshot,
  dropTask,
  removeTask,
  startTask,
  TodoStoreError,
  type IdFactory,
} from "../src/store.ts";
import { allTasks, countTasks, type TodoSnapshot } from "../src/types.ts";

function ids(): IdFactory {
  let next = 0;
  return () => `id${++next}`;
}

function snapshot(): TodoSnapshot {
  return createInitialSnapshot(
    [
      { name: "Phase 1", tasks: [{ content: "a" }, { content: "b" }, { content: "c" }] },
      { name: "Phase 2", tasks: [{ content: "d" }] },
    ],
    "serial",
    ids(),
  );
}

describe("createInitialSnapshot", () => {
  it("creates stable ids, pending statuses and revision 1", () => {
    const state = snapshot();
    expect(state.revision).toBe(1);
    expect(state.mode).toBe("serial");
    expect(state.phases[0]?.id).toBe("p-id1");
    expect(state.phases[0]?.tasks.map((task) => task.id)).toEqual(["t-id2", "t-id3", "t-id4"]);
    expect(allTasks(state).every((task) => task.status === "pending")).toBe(true);
    expect(countTasks(state)).toEqual({ total: 4, pending: 4, inProgress: 0, completed: 0, abandoned: 0 });
  });

  it("rejects empty phases and oversized input", () => {
    expect(() => createInitialSnapshot([], "serial")).toThrow(TodoStoreError);
    expect(() => createInitialSnapshot([{ name: " " }], "serial")).toThrow(TodoStoreError);
    expect(() =>
      createInitialSnapshot([{ name: "P", tasks: Array.from({ length: 201 }, () => ({ content: "x" })) }], "serial"),
    ).toThrow(TodoStoreError);
    expect(() => createInitialSnapshot([{ name: "P", tasks: [{ content: "x".repeat(501) }] }], "serial")).toThrow(
      TodoStoreError,
    );
  });
});

describe("serial transitions", () => {
  it("allows one active task and promotes the next pending on completion", () => {
    const state = snapshot();
    const started = startTask(state, "t-id2");
    expect(started.changed).toBe(true);
    expect(started.snapshot.revision).toBe(2);
    expect(started.snapshot.phases[0]?.tasks[0]?.status).toBe("in_progress");
    expect(() => startTask(started.snapshot, "t-id3")).toThrow(TodoStoreError);

    const completed = completeTask(started.snapshot, "t-id2");
    expect(completed.snapshot.phases[0]?.tasks[0]?.status).toBe("completed");
    expect(completed.snapshot.phases[0]?.tasks[1]?.status).toBe("in_progress");

    const again = completeTask(completed.snapshot, "t-id2");
    expect(again.changed).toBe(false);
    expect(again.snapshot.revision).toBe(completed.snapshot.revision);
  });

  it("promotes pending after drop or remove of the active task", () => {
    const active = startTask(snapshot(), "t-id2").snapshot;
    const dropped = dropTask(active, "t-id2");
    expect(dropped.snapshot.phases[0]?.tasks[0]?.status).toBe("abandoned");
    expect(dropped.snapshot.phases[0]?.tasks[1]?.status).toBe("in_progress");

    const removed = removeTask(active, "t-id2");
    expect(removed.snapshot.phases[0]?.tasks.map((task) => task.id)).toEqual(["t-id3", "t-id4"]);
    expect(removed.snapshot.phases[0]?.tasks[0]?.status).toBe("in_progress");
  });

  it("rejects invalid status transitions without mutating the input", () => {
    const state = snapshot();
    const completed = completeTask(state, "t-id2").snapshot;
    const before = JSON.stringify(completed);
    expect(() => dropTask(completed, "t-id2")).toThrow(TodoStoreError);
    expect(() => startTask(completed, "t-id2")).toThrow(TodoStoreError);
    expect(JSON.stringify(completed)).toBe(before);
  });
});

describe("parallel mode", () => {
  it("allows multiple active tasks and no implicit promotion", () => {
    const state = createInitialSnapshot(
      [{ name: "P", tasks: [{ content: "a" }, { content: "b" }, { content: "c" }] }],
      "parallel",
      ids(),
    );
    const first = startTask(state, "t-id2").snapshot;
    const second = startTask(first, "t-id3").snapshot;
    expect(countTasks(second).inProgress).toBe(2);
    const done = completeTask(second, "t-id2").snapshot;
    expect(countTasks(done).inProgress).toBe(1);
    expect(done.phases[0]?.tasks[2]?.status).toBe("pending");
  });
});

describe("append", () => {
  it("appends to an explicit phase or the active phase", () => {
    const state = snapshot();
    const appended = appendTask(state, "p-id1", "new", ids());
    expect(appended.snapshot.phases[0]?.tasks.at(-1)?.content).toBe("new");
    expect(appended.snapshot.revision).toBe(2);

    const active = startTask(state, "t-id2").snapshot;
    const next = appendTask(active, undefined, "next", ids());
    expect(next.snapshot.phases[0]?.tasks.at(-1)?.content).toBe("next");
    expect(() => appendTask(state, "missing", "x")).toThrow(TodoStoreError);
    expect(() => appendTask(state, "p-id1", " ")).toThrow(TodoStoreError);
  });
});
