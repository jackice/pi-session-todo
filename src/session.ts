import { rehydrate, type SessionEntryLike } from "./persistence.ts";
import { emptySnapshot, SESSION_TODO_ENTRY, type TodoMode, type TodoSnapshot } from "./types.ts";
import type { MutationResult } from "./store.ts";

export interface TodoSessionHost {
  appendEntry(customType: string, data?: unknown): void;
  entries(): readonly SessionEntryLike[];
}

export type CommitResult =
  | { ok: true; snapshot: TodoSnapshot }
  | { ok: false; error: string; snapshot: TodoSnapshot };

export class TodoSession {
  private readonly host: TodoSessionHost;
  private state: TodoSnapshot;
  private isDegraded = false;
  private degradedReason: string | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(host: TodoSessionHost, mode: TodoMode = "serial") {
    this.host = host;
    this.state = emptySnapshot(mode);
    this.reload(mode);
  }

  get snapshot(): TodoSnapshot {
    return this.state;
  }

  get degraded(): boolean {
    return this.isDegraded;
  }

  get reason(): string | undefined {
    return this.degradedReason;
  }

  reload(mode: TodoMode = this.state.mode): void {
    const result = rehydrate(this.host.entries(), mode);
    this.state = result.snapshot;
    this.isDegraded = result.degraded;
    this.degradedReason = result.reason;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 先落盘再发布；失败时保留原状态。 */
  commit(next: TodoSnapshot): CommitResult {
    if (this.isDegraded) {
      return {
        ok: false,
        error: `session todo is read-only: latest snapshot is corrupt (${this.degradedReason ?? "unknown"})`,
        snapshot: this.state,
      };
    }
    try {
      this.host.appendEntry(SESSION_TODO_ENTRY, next);
    } catch (error) {
      return {
        ok: false,
        error: `failed to persist session todo: ${error instanceof Error ? error.message : String(error)}`,
        snapshot: this.state,
      };
    }
    this.state = next;
    this.notify();
    return { ok: true, snapshot: next };
  }

  mutate(operation: (snapshot: TodoSnapshot) => MutationResult): CommitResult & { summary?: string } {
    if (this.isDegraded) {
      return {
        ok: false,
        error: `session todo is read-only: latest snapshot is corrupt (${this.degradedReason ?? "unknown"})`,
        snapshot: this.state,
      };
    }
    let result: MutationResult;
    try {
      result = operation(this.state);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        snapshot: this.state,
      };
    }
    if (!result.changed) return { ok: true, snapshot: this.state, summary: result.summary };
    const committed = this.commit(result.snapshot);
    return committed.ok ? { ...committed, summary: result.summary } : committed;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
