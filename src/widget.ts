import { fromPiTheme, TodoView, type TodoViewModel } from "@jackice/pi-ui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

import type { TodoSession } from "./session.ts";
import type { TodoSnapshot } from "./types.ts";

export interface TodoWidgetOptions {
  expanded?: boolean;
  rows?: () => number;
}

export const TODO_WIDGET_KEY = "jackice:session-todo";

/** 按终端行数预算限制总高度：Panel 上下边框各占 1 行。 */
export function widgetHeightBudget(rows: number): { total: number; maxLines: number } {
  const total = Math.max(3, Math.min(8, Math.floor(rows) - 19));
  return { total, maxLines: Math.max(1, total - 2) };
}

export function toTodoViewModel(snapshot: TodoSnapshot): TodoViewModel {
  const current = snapshot.phases.flatMap((phase) => phase.tasks).find((task) => task.status === "in_progress");
  return {
    mode: snapshot.mode,
    phases: snapshot.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      tasks: phase.tasks.map((task) => ({
        id: task.id,
        content: task.content,
        status: task.status,
        ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
      })),
    })),
    ...(current === undefined ? {} : { currentTaskId: current.id }),
  };
}

export function createSessionTodoWidget(
  session: TodoSession,
  tui: TUI,
  theme: Theme,
  options: TodoWidgetOptions = {},
): Component & { dispose: () => void } {
  const rows = options.rows ?? (() => process.stdout.rows ?? 24);
  const uiTheme = fromPiTheme(theme);
  let view: TodoView | undefined;
  let lastRows = -1;

  const unsubscribe = session.subscribe(() => {
    view = undefined;
    tui.requestRender();
  });

  return {
    render(width: number) {
      const currentRows = rows();
      if (view === undefined || currentRows !== lastRows) {
        lastRows = currentRows;
        const budget = widgetHeightBudget(currentRows);
        view = new TodoView(uiTheme, {
          model: toTodoViewModel(session.snapshot),
          expanded: options.expanded === true,
          maxLines: budget.maxLines,
        });
      }
      return view.render(width);
    },
    invalidate() {
      view = undefined;
    },
    dispose() {
      unsubscribe();
    },
  };
}
