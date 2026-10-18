import { Router } from "express";
import type { SQLInputValue } from "node:sqlite";
import { z } from "zod";
import type { DB } from "../db.js";
import { HttpError } from "../errors.js";

export const STATUSES = ["todo", "doing", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;

const isoDate = z.iso.date();

const CreateTask = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(""),
  status: z.enum(STATUSES).default("todo"),
  priority: z.enum(PRIORITIES).default("medium"),
  dueDate: isoDate.nullable().default(null),
});

const UpdateTask = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000),
    status: z.enum(STATUSES),
    priority: z.enum(PRIORITIES),
    dueDate: isoDate.nullable(),
    // Fractional index: the client sends a value between the two neighbours
    // it was dropped between, so a reorder touches exactly one row.
    position: z.number().finite(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

const ListQuery = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  q: z.string().trim().max(100).optional(),
});

const Id = z.coerce.number().int().positive();

interface TaskRow {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

const toTask = (r: TaskRow) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  status: r.status,
  priority: r.priority,
  dueDate: r.due_date,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const COLUMNS: Record<string, string> = {
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  dueDate: "due_date",
  position: "position",
};

export function taskRoutes(db: DB) {
  const router = Router();

  const nextPosition = (userId: number, status: string) =>
    (
      db
        .prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE user_id = ? AND status = ?")
        .get(userId, status) as { p: number }
    ).p;

  const findOwned = (userId: number, id: number) => {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(id, userId) as
      | TaskRow
      | undefined;
    // 404 rather than 403: don't reveal that another user's task exists.
    if (!row) throw new HttpError(404, "not_found", "Task not found");
    return row;
  };

  router.get("/", (req, res) => {
    const { status, priority, q } = ListQuery.parse(req.query);
    const where = ["user_id = ?"];
    const params: SQLInputValue[] = [res.locals.userId];
    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    if (priority) {
      where.push("priority = ?");
      params.push(priority);
    }
    if (q) {
      where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like);
    }
    const rows = db
      .prepare(`SELECT * FROM tasks WHERE ${where.join(" AND ")} ORDER BY status, position`)
      .all(...params) as unknown as TaskRow[];
    res.json({ tasks: rows.map(toTask) });
  });

  router.get("/stats", (_req, res) => {
    const userId = res.locals.userId;
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of db
      .prepare("SELECT status, COUNT(*) AS n FROM tasks WHERE user_id = ? GROUP BY status")
      .all(userId) as { status: string; n: number }[]) {
      counts[r.status] = r.n;
    }
    const { overdue } = db
      .prepare(
        "SELECT COUNT(*) AS overdue FROM tasks WHERE user_id = ? AND status != 'done' AND due_date < date('now')",
      )
      .get(userId) as { overdue: number };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    res.json({
      total,
      byStatus: counts,
      overdue,
      completionRate: total ? Math.round((counts.done! / total) * 100) / 100 : 0,
    });
  });

  router.post("/", (req, res) => {
    const body = CreateTask.parse(req.body);
    const userId = res.locals.userId;
    const row = db
      .prepare(
        `INSERT INTO tasks (user_id, title, description, status, priority, due_date, position)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        userId,
        body.title,
        body.description,
        body.status,
        body.priority,
        body.dueDate,
        nextPosition(userId, body.status),
      ) as unknown as TaskRow;
    res.status(201).json({ task: toTask(row) });
  });

  router.patch("/:id", (req, res) => {
    const id = Id.parse(req.params.id);
    const userId = res.locals.userId;
    const existing = findOwned(userId, id);
    const patch: Record<string, unknown> = UpdateTask.parse(req.body);

    // Moving to another column without an explicit position appends to it.
    if (patch.status && patch.status !== existing.status && patch.position === undefined) {
      patch.position = nextPosition(userId, patch.status as string);
    }

    const keys = Object.keys(patch);
    const sets = keys.map((k) => `${COLUMNS[k]} = ?`);
    const row = db
      .prepare(
        `UPDATE tasks SET ${sets.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND user_id = ? RETURNING *`,
      )
      .get(...keys.map((k) => patch[k] as SQLInputValue), id, userId) as unknown as TaskRow;
    res.json({ task: toTask(row) });
  });

  router.delete("/:id", (req, res) => {
    const id = Id.parse(req.params.id);
    findOwned(res.locals.userId, id);
    db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(id, res.locals.userId);
    res.status(204).end();
  });

  return router;
}
