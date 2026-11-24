import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";

import sessionTodoExtension from "../index.ts";
import {
  sessionTodoParams,
  type SessionTodoDetails,
  type SessionTodoParams,
} from "../src/tool.ts";
import { TODO_WIDGET_KEY } from "../src/widget.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void> | void;

interface MockBranchEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

interface MockPi {
  handlers: Map<string, Handler[]>;
  tools: ToolDefinition<typeof sessionTodoParams, SessionTodoDetails>[];
  commands: Map<string, CommandHandler>;
  flags: Map<string, string | boolean | undefined>;
  branch: MockBranchEntry[];
  appended: MockBranchEntry[];
  ctx: ExtensionContext;
  ui: { setWidget: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> };
}

function createMockPi(branch: MockBranchEntry[] = []): MockPi {
  const handlers = new Map<string, Handler[]>();
  const tools: ToolDefinition<typeof sessionTodoParams, SessionTodoDetails>[] = [];
  const commands = new Map<string, CommandHandler>();
  const flags = new Map<string, string | boolean | undefined>();
  const appended: MockBranchEntry[] = [];
  const ui = { setWidget: vi.fn(), notify: vi.fn() };
  const ctx = {
    mode: "tui",
    hasUI: true,
    sessionManager: { getBranch: () => branch },
    ui,
  } as unknown as ExtensionContext;

  const pi = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(tool: ToolDefinition<typeof sessionTodoParams, SessionTodoDetails>) {
      tools.push(tool);
    },
    registerCommand(name: string, options: { handler: CommandHandler }) {
      commands.set(name, options.handler);
    },
    registerFlag(name: string) {
      flags.set(name, undefined);
      return undefined;
    },
    getFlag(name: string) {
      return flags.get(name);
    },
    appendEntry(customType: string, data?: unknown) {
      const entry = { type: "custom", customType, data };
      appended.push(entry);
      branch.push(entry);
    },
  };

  sessionTodoExtension(pi as unknown as ExtensionAPI);
  return { handlers, tools, commands, flags, branch, appended, ctx, ui };
}

async function fire(mock: MockPi, event: string, payload: unknown = {}): Promise<void> {
  for (const handler of mock.handlers.get(event) ?? []) await handler(payload, mock.ctx);
}

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function tool(mock: MockPi) {
  const definition = mock.tools[0];
  if (definition === undefined) throw new Error("tool not registered");
  return definition;
}

async function execute(mock: MockPi, params: SessionTodoParams) {
  return tool(mock).execute("call", params, undefined, undefined, mock.ctx as unknown as ExtensionToolContext);
}

function renderWidget(mock: MockPi, width = 80): string {
  const factory = mock.ui.setWidget.mock.calls.at(-1)?.[1];
  if (typeof factory !== "function") throw new Error("widget not mounted");
  const widget = factory({ requestRender: vi.fn() } as unknown as TUI, theme);
  return widget.render(width).join("\n");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("session-todo extension", () => {
  it("mounts the HUD above the editor and registers the tool/command", async () => {
    const mock = createMockPi();
    await fire(mock, "session_start", { reason: "startup" });
    expect(mock.ui.setWidget).toHaveBeenCalledWith(TODO_WIDGET_KEY, expect.any(Function), {
      placement: "aboveEditor",
    });
    expect(mock.tools.map((entry) => entry.name)).toContain("session_todo");
    expect(mock.commands.has("session-todo")).toBe(true);
  });

  it("persists init/start/done and renders the HUD", async () => {
    const mock = createMockPi();
    await fire(mock, "session_start", { reason: "startup" });
    const initialized = await execute(mock, {
      action: "init",
      phases: [{ name: "Phase", tasks: [{ content: "a" }, { content: "b" }] }],
    });
    expect(initialized.isError).toBeUndefined();
    expect(mock.appended).toHaveLength(1);
    expect(renderWidget(mock)).toContain("Phase");

    const snapshot = initialized.details?.snapshot;
    const first = snapshot?.phases[0]?.tasks[0];
    const second = snapshot?.phases[0]?.tasks[1];
    if (first === undefined || second === undefined) throw new Error("fixture");

    const started = await execute(mock, { action: "start", taskId: first.id });
    expect(started.isError).toBeUndefined();
    const done = await execute(mock, { action: "done", taskId: first.id });
    expect(done.isError).toBeUndefined();
    expect(done.details?.snapshot.phases[0]?.tasks[1]?.status).toBe("in_progress");

    const view = await execute(mock, { action: "view" });
    const text = view.content[0];
    if (text?.type !== "text") throw new Error("missing text result");
    expect(text.text).toContain("Phase");
  });

  it("returns tool errors without persisting for invalid operations", async () => {
    const mock = createMockPi();
    await fire(mock, "session_start", { reason: "startup" });
    const result = await execute(mock, { action: "start" });
    expect(result.isError).toBe(true);
    expect(mock.appended).toHaveLength(0);
  });

  it("rehydrates on session_tree", async () => {
    const mock = createMockPi();
    await fire(mock, "session_start", { reason: "startup" });
    await execute(mock, { action: "init", phases: [{ name: "First", tasks: [{ content: "a" }] }] });
    await fire(mock, "session_tree", {});
    expect(renderWidget(mock)).toContain("First");
    expect(mock.ui.setWidget.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("hides the HUD after all tasks complete", async () => {
    vi.useFakeTimers();
    const mock = createMockPi();
    mock.flags.set("session-todo-hide-ms", "1000");
    await fire(mock, "session_start", { reason: "startup" });
    const initialized = await execute(mock, {
      action: "init",
      phases: [{ name: "Phase", tasks: [{ content: "only" }] }],
    });
    const task = initialized.details?.snapshot.phases[0]?.tasks[0];
    if (task === undefined) throw new Error("fixture");
    await execute(mock, { action: "start", taskId: task.id });
    await execute(mock, { action: "done", taskId: task.id });
    vi.advanceTimersByTime(1000);
    expect(mock.ui.setWidget).toHaveBeenLastCalledWith(TODO_WIDGET_KEY, undefined);
  });

  it("supports show/hide/expand/collapse/status commands", async () => {
    const mock = createMockPi();
    await fire(mock, "session_start", { reason: "startup" });
    const command = mock.commands.get("session-todo");
    if (command === undefined) throw new Error("command missing");
    await command("hide", mock.ctx);
    expect(mock.ui.setWidget).toHaveBeenLastCalledWith(TODO_WIDGET_KEY, undefined);
    await command("show", mock.ctx);
    expect(mock.ui.setWidget).toHaveBeenLastCalledWith(
      TODO_WIDGET_KEY,
      expect.any(Function),
      { placement: "aboveEditor" },
    );
    await command("expand", mock.ctx);
    expect(mock.ui.setWidget).toHaveBeenLastCalledWith(
      TODO_WIDGET_KEY,
      expect.any(Function),
      { placement: "aboveEditor" },
    );
    await command("status", mock.ctx);
    expect(mock.ui.notify).toHaveBeenCalled();
  });

  it("refuses writes when the latest snapshot is corrupt", async () => {
    const mock = createMockPi([{ type: "custom", customType: "session-todo", data: { version: 99 } }]);
    await fire(mock, "session_start", { reason: "startup" });
    const result = await execute(mock, {
      action: "init",
      phases: [{ name: "Phase", tasks: [{ content: "a" }] }],
    });
    expect(result.isError).toBe(true);
    expect(mock.appended).toHaveLength(0);
    const text = result.content[0];
    if (text?.type !== "text") throw new Error("missing text result");
    expect(text.text).toContain("read-only");
  });
});
