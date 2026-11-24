import { describe, expect, it } from "vitest";

import { parseSnapshot, rehydrate, type SessionEntryLike } from "../src/persistence.ts";
import { createInitialSnapshot, startTask } from "../src/store.ts";
import { SESSION_TODO_ENTRY, emptySnapshot, type TodoSnapshot } from "../src/types.ts";

function makeSnapshot(): TodoSnapshot {
  let next = 0;
  return createInitialSnapshot([{ name: "P", tasks: [{ content: "a" }, { content: "b" }] }], "serial", () => `id${++next}`);
}

function entry(data: unknown, customType = SESSION_TODO_ENTRY): SessionEntryLike {
  return { type: "custom", customType, data };
}

describe("parseSnapshot", () => {
  it("round-trips a valid snapshot", () => {
    const snapshot = makeSnapshot();
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.snapshot).toEqual(snapshot);
  });

  it("rejects unknown versions and malformed shapes", () => {
    expect(parseSnapshot({ ...makeSnapshot(), version: 2 }).ok).toBe(false);
    expect(parseSnapshot(null).ok).toBe(false);
    expect(parseSnapshot({ version: 1, revision: 1, mode: "serial", phases: [{ id: "p", name: "P", tasks: [{}] }] }).ok).toBe(
      false,
    );
    const duplicate: TodoSnapshot = makeSnapshot();
    duplicate.phases[0]?.tasks.push({ id: "t-id2", content: "dup", status: "pending" });
    expect(parseSnapshot(duplicate).ok).toBe(false);
  });

  it("rejects multiple in_progress tasks in serial snapshot", () => {
    const snapshot = makeSnapshot();
    snapshot.phases[0]!.tasks[0]!.status = "in_progress";
    snapshot.phases[0]!.tasks[1]!.status = "in_progress";
    expect(parseSnapshot(snapshot).ok).toBe(false);
  });
});

describe("rehydrate", () => {
  it("returns the latest valid snapshot", () => {
    const first = makeSnapshot();
    const second = startTask(first, "t-id2").snapshot;
    const result = rehydrate([entry(first), entry(second)]);
    expect(result.degraded).toBe(false);
    expect(result.snapshot).toEqual(second);
  });

  it("skips unrelated entries and falls back to empty when none exist", () => {
    const result = rehydrate([entry({ anything: true }, "other"), { type: "message" }]);
    expect(result.snapshot).toEqual(emptySnapshot("serial"));
    expect(result.degraded).toBe(false);
  });

  it("uses the last readable snapshot and marks degraded when the newest is corrupt", () => {
    const valid = makeSnapshot();
    const result = rehydrate([entry(valid), entry({ version: 99 })]);
    expect(result.snapshot).toEqual(valid);
    expect(result.degraded).toBe(true);
    expect(result.reason).toContain("version");
  });

  it("marks degraded when no snapshot is readable", () => {
    const result = rehydrate([entry({ broken: true })]);
    expect(result.snapshot).toEqual(emptySnapshot("serial"));
    expect(result.degraded).toBe(true);
  });
});
