import type { Status, Task } from "./api";

export const COLUMNS: { status: Status; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "doing", label: "In progress" },
  { status: "done", label: "Done" },
];

export function groupByStatus(tasks: Task[]): Record<Status, Task[]> {
  const groups: Record<Status, Task[]> = { todo: [], doing: [], done: [] };
  for (const t of tasks) groups[t.status].push(t);
  for (const list of Object.values(groups)) list.sort((a, b) => a.position - b.position);
  return groups;
}

/**
 * Fractional index for dropping a card before `beforeId` (or at the end when
 * null). Only the moved card's position changes, so a reorder is one PATCH.
 */
export function positionForDrop(column: Task[], movingId: number, beforeId: number | null): number {
  const others = column.filter((t) => t.id !== movingId);
  if (others.length === 0) return 1;
  if (beforeId === null) return others[others.length - 1]!.position + 1;
  const idx = others.findIndex((t) => t.id === beforeId);
  if (idx <= 0) return others[0]!.position - 1;
  return (others[idx - 1]!.position + others[idx]!.position) / 2;
}

export function isOverdue(task: Task, today = new Date().toISOString().slice(0, 10)): boolean {
  return task.status !== "done" && task.dueDate !== null && task.dueDate < today;
}
