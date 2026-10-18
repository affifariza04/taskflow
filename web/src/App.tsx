import { useCallback, useEffect, useState } from "react";
import { api, ApiError, session, type Stats, type Status, type Task, type User } from "./api";
import { groupByStatus, positionForDrop } from "./board";
import { AuthForm } from "./components/AuthForm";
import { Board, NEXT } from "./components/Board";
import { NewTask, type NewTaskInput } from "./components/NewTask";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(Boolean(session.get()));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const logout = useCallback(() => {
    session.set(null);
    setUser(null);
    setTasks([]);
  }, []);

  const handle = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return logout();
      setError(err instanceof Error ? err.message : "Something went wrong");
    },
    [logout],
  );

  const refresh = useCallback(async () => {
    try {
      const [{ tasks }, stats] = await Promise.all([api.listTasks(query), api.stats()]);
      setTasks(tasks);
      setStats(stats);
    } catch (err) {
      handle(err);
    }
  }, [query, handle]);

  // Restore the session on first load.
  useEffect(() => {
    if (!session.get()) return;
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(logout)
      .finally(() => setChecking(false));
  }, [logout]);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(refresh, 200); // debounce search typing
    return () => clearTimeout(t);
  }, [user, refresh]);

  async function create(input: NewTaskInput) {
    try {
      await api.createTask(input);
      await refresh();
    } catch (err) {
      handle(err);
    }
  }

  /** Optimistic update: move locally first, roll back if the server rejects it. */
  async function move(id: number, status: Status, beforeId: number | null) {
    const previous = tasks;
    const position = positionForDrop(groupByStatus(tasks)[status], id, beforeId);
    setTasks(tasks.map((t) => (t.id === id ? { ...t, status, position } : t)));
    try {
      await api.updateTask(id, { status, position });
      await refresh();
    } catch (err) {
      setTasks(previous);
      handle(err);
    }
  }

  async function remove(id: number) {
    const previous = tasks;
    setTasks(tasks.filter((t) => t.id !== id));
    try {
      await api.deleteTask(id);
      await refresh();
    } catch (err) {
      setTasks(previous);
      handle(err);
    }
  }

  if (checking) return <main className="auth muted">Loading…</main>;
  if (!user) {
    return (
      <AuthForm
        onAuthed={(token, u) => {
          session.set(token);
          setUser(u);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>taskflow</h1>
        <input
          className="search"
          type="search"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tasks"
        />
        <span className="muted">{user.name}</span>
        <button className="ghost" onClick={logout}>
          Sign out
        </button>
      </header>

      {stats && (
        <section className="stats" aria-label="Summary">
          <div>
            <strong>{stats.total}</strong> tasks
          </div>
          <div>
            <strong>{Math.round(stats.completionRate * 100)}%</strong> done
          </div>
          <div className={stats.overdue ? "overdue" : ""}>
            <strong>{stats.overdue}</strong> overdue
          </div>
          <div className="progress" aria-hidden>
            <span style={{ width: `${stats.completionRate * 100}%` }} />
          </div>
        </section>
      )}

      {error && (
        <p className="error banner" role="alert" onClick={() => setError("")}>
          {error} <small>(click to dismiss)</small>
        </p>
      )}

      <NewTask onCreate={create} />
      <Board
        tasks={tasks}
        onMove={move}
        onDelete={remove}
        onAdvance={(t) => NEXT[t.status] && move(t.id, NEXT[t.status]!, null)}
      />
    </div>
  );
}
