export type Status = "todo" | "doing" | "done";
export type Priority = "low" | "medium" | "high";

export interface Task {
  id: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  dueDate: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: number;
  email: string;
  name: string;
}

export interface Stats {
  total: number;
  byStatus: Record<Status, number>;
  overdue: number;
  completionRate: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "taskflow.token";

export const session = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string | null) => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable (private mode) — session lasts until reload */
    }
  },
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = session.get();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error ?? {};
    const detail = err.issues?.map((i: { message: string }) => i.message).join(", ");
    throw new ApiError(res.status, err.code ?? "unknown", detail || err.message || res.statusText);
  }
  return data as T;
}

export const api = {
  register: (email: string, name: string, password: string) =>
    call<{ token: string; user: User }>("POST", "/auth/register", { email, name, password }),
  login: (email: string, password: string) =>
    call<{ token: string; user: User }>("POST", "/auth/login", { email, password }),
  me: () => call<{ user: User }>("GET", "/auth/me"),
  listTasks: (q = "") => call<{ tasks: Task[] }>("GET", `/tasks${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  stats: () => call<Stats>("GET", "/tasks/stats"),
  createTask: (input: Partial<Task> & { title: string }) => call<{ task: Task }>("POST", "/tasks", input),
  updateTask: (id: number, patch: Partial<Task>) => call<{ task: Task }>("PATCH", `/tasks/${id}`, patch),
  deleteTask: (id: number) => call<void>("DELETE", `/tasks/${id}`),
};
