import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import type { SessionEntryLike } from "./src/persistence.ts";
import { TodoSession } from "./src/session.ts";
import { countTasks, isAllCompleted, type TodoMode } from "./src/types.ts";
import { createSessionTodoTool } from "./src/tool.ts";
import { createSessionTodoWidget, TODO_WIDGET_KEY } from "./src/widget.ts";

const DEFAULT_HIDE_MS = 60_000;

export default function sessionTodoExtension(pi: ExtensionAPI): void {
  let session: TodoSession | undefined;
  let currentCtx: ExtensionContext | undefined;
  let widgetVisible = true;
  let widgetExpanded = false;
  let hideTimer: NodeJS.Timeout | undefined;

  const clearHideTimer = (): void => {
    if (hideTimer !== undefined) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  };

  const hideWidget = (): void => {
    clearHideTimer();
    widgetVisible = false;
    currentCtx?.ui.setWidget(TODO_WIDGET_KEY, undefined);
  };

  const mountWidget = (ctx: ExtensionContext): void => {
    if (!widgetVisible || session === undefined || ctx.mode !== "tui" || !ctx.hasUI) return;
    const target = session;
    ctx.ui.setWidget(
      TODO_WIDGET_KEY,
      (tui, theme) => createSessionTodoWidget(target, tui, theme, { expanded: widgetExpanded }),
      { placement: "aboveEditor" },
    );
  };

  const scheduleHide = (): void => {
    clearHideTimer();
    if (!widgetVisible || session === undefined || !isAllCompleted(session.snapshot)) return;
    const ms = hideAfterMs(pi);
    if (ms < 0) return;
    if (ms === 0) {
      hideWidget();
      return;
    }
    const revision = session.snapshot.revision;
    hideTimer = setTimeout(() => {
      hideTimer = undefined;
      if (session === undefined) return;
      if (session.snapshot.revision !== revision || !isAllCompleted(session.snapshot)) return;
      hideWidget();
    }, ms);
    hideTimer.unref?.();
  };

  const buildSession = (ctx: ExtensionContext): TodoSession => {
    const mode: TodoMode = session?.snapshot.mode ?? "serial";
    return new TodoSession(
      {
        appendEntry(customType, data) {
          pi.appendEntry(customType, data);
        },
        entries() {
          return ctx.sessionManager.getBranch().map(toEntryLike);
        },
      },
      mode,
    );
  };

  const onStateChange = (): void => {
    if (session === undefined) return;
    if (isAllCompleted(session.snapshot)) scheduleHide();
    else clearHideTimer();
  };

  pi.registerFlag("session-todo-hide-ms", {
    description: "Hide the session TODO HUD after all tasks complete (ms; -1 disables, 0 immediate)",
    type: "string",
  });

  pi.registerTool(createSessionTodoTool(() => session));

  pi.registerCommand("session-todo", {
    description: "Session TODO HUD: expand | collapse | show | hide | status",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      const command = args.trim().split(/\s+/, 1)[0] ?? "";
      if (command === "expand" || command === "collapse") {
        widgetExpanded = command === "expand";
        widgetVisible = true;
        mountWidget(ctx);
        return;
      }
      if (command === "show") {
        widgetVisible = true;
        mountWidget(ctx);
        scheduleHide();
        return;
      }
      if (command === "hide") {
        hideWidget();
        return;
      }
      if (command === "status") {
        if (session === undefined) {
          ctx.ui.notify("session todo is not ready", "warning");
          return;
        }
        const counts = countTasks(session.snapshot);
        const degraded = session.degraded ? ` read-only: ${session.reason ?? "corrupt snapshot"}` : "";
        ctx.ui.notify(
          `session todo revision=${session.snapshot.revision} total=${counts.total} done=${counts.completed}${degraded}`,
          session.degraded ? "warning" : "info",
        );
        return;
      }
      ctx.ui.notify("usage: /session-todo expand|collapse|show|hide|status", "warning");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
    clearHideTimer();
    session = buildSession(ctx);
    session.subscribe(onStateChange);
    widgetVisible = true;
    widgetExpanded = false;
    mountWidget(ctx);
    scheduleHide();
  });

  pi.on("session_tree", (_event, ctx) => {
    currentCtx = ctx;
    clearHideTimer();
    session?.reload();
    widgetExpanded = false;
    widgetVisible = true;
    mountWidget(ctx);
    scheduleHide();
  });

  pi.on("session_shutdown", () => {
    clearHideTimer();
    session = undefined;
    currentCtx = undefined;
  });
}

function toEntryLike(entry: SessionEntry): SessionEntryLike {
  if (entry.type === "custom") {
    return { type: entry.type, customType: entry.customType, data: entry.data };
  }
  return { type: entry.type };
}

function hideAfterMs(pi: ExtensionAPI): number {
  const raw = pi.getFlag("session-todo-hide-ms");
  const value = typeof raw === "string" ? raw : process.env.PI_SESSION_TODO_HIDE_MS;
  if (value === undefined || value === "") return DEFAULT_HIDE_MS;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_HIDE_MS;
}
