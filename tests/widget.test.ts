import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { runSessionTodoAction } from "../src/actions.ts";
import type { SessionEntryLike } from "../src/persistence.ts";
import { TodoSession, type TodoSessionHost } from "../src/session.ts";
import { createSessionTodoWidget, toTodoViewModel, widgetHeightBudget } from "../src/widget.ts";

function makeSession(): TodoSession {
  const stored: SessionEntryLike[] = [];
  const host: TodoSessionHost = {
    entries: () => stored,
    appendEntry(customType, data) {
      stored.push({ type: "custom", customType, data });
    },
  };
  const session = new TodoSession(host);
  runSessionTodoAction(session, {
    action: "init",
    phases: [{ name: "Phase", tasks: [{ content: "a" }, { content: "b" }, { content: "c" }] }],
  });
  return session;
}

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

describe("widgetHeightBudget", () => {
  it("caps total lines by terminal height", () => {
    expect(widgetHeightBudget(12)).toEqual({ total: 3, maxLines: 1 });
    expect(widgetHeightBudget(24)).toEqual({ total: 5, maxLines: 3 });
    expect(widgetHeightBudget(32)).toEqual({ total: 8, maxLines: 6 });
    expect(widgetHeightBudget(80)).toEqual({ total: 8, maxLines: 6 });
  });
});

describe("toTodoViewModel", () => {
  it("marks the first in-progress task as current", () => {
    const session = makeSession();
    const task = session.snapshot.phases[0]?.tasks[0];
    if (task === undefined) throw new Error("fixture");
    runSessionTodoAction(session, { action: "start", taskId: task.id });
    const model = toTodoViewModel(session.snapshot);
    expect(model.currentTaskId).toBe(task.id);
    expect(model.phases[0]?.tasks[0]?.status).toBe("in_progress");
  });
});

describe("createSessionTodoWidget", () => {
  it("renders within the height budget", () => {
    const session = makeSession();
    const tui = { requestRender: vi.fn() } as unknown as TUI;
    const widget = createSessionTodoWidget(session, tui, theme, { rows: () => 24 });
    const lines = widget.render(60);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines.join("\n")).toContain("Session TODO");
    widget.dispose();
  });

  it("rebuilds and requests render on store changes", () => {
    const session = makeSession();
    const tui = { requestRender: vi.fn() } as unknown as TUI;
    const widget = createSessionTodoWidget(session, tui, theme, { rows: () => 32 });
    expect(widget.render(60).join("\n")).toContain("Phase");
    const task = session.snapshot.phases[0]?.tasks[0];
    if (task === undefined) throw new Error("fixture");
    runSessionTodoAction(session, { action: "start", taskId: task.id });
    expect(tui.requestRender).toHaveBeenCalled();
    expect(widget.render(60).join("\n")).toContain("▸");
    widget.dispose();
  });

  it("stops listening after dispose", () => {
    const session = makeSession();
    const tui = { requestRender: vi.fn() } as unknown as TUI;
    const widget = createSessionTodoWidget(session, tui, theme, { rows: () => 24 });
    widget.dispose();
    const task = session.snapshot.phases[0]?.tasks[0];
    if (task === undefined) throw new Error("fixture");
    runSessionTodoAction(session, { action: "start", taskId: task.id });
    expect(tui.requestRender).not.toHaveBeenCalled();
  });
});
