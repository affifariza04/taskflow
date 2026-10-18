import { describe, expect, it } from "vitest";
import type { Task } from "../src/api";
import { groupByStatus, isOverdue, positionForDrop } from "../src/board";

const task = (id: number, position: number, extra: Partial<Task> = {}): Task => ({
  id,
  position,
  title: `t${id}`,
  description: "",
  status: "todo",
  priority: "medium",
  dueDate: null,
  createdAt: "",
  updatedAt: "",
  ...extra,
});

describe("positionForDrop", () => {
  const col = [task(1, 1), task(2, 2), task(3, 3)];

  it("places between neighbours", () => expect(positionForDrop(col, 3, 2)).toBe(1.5));
  it("places at the start", () => expect(positionForDrop(col, 3, 1)).toBe(0));
  it("appends at the end", () => expect(positionForDrop(col, 1, null)).toBe(4));
  it("handles an empty column", () => expect(positionForDrop([], 9, null)).toBe(1));
  it("ignores the moving card's own slot", () => expect(positionForDrop(col, 2, 3)).toBe(2));
});

describe("helpers", () => {
  it("groups and sorts by position", () => {
    const g = groupByStatus([task(1, 2), task(2, 1), task(3, 1, { status: "done" })]);
    expect(g.todo.map((t) => t.id)).toEqual([2, 1]);
    expect(g.done.map((t) => t.id)).toEqual([3]);
  });

  it("flags overdue only for unfinished tasks", () => {
    expect(isOverdue(task(1, 1, { dueDate: "2020-01-01" }), "2026-01-01")).toBe(true);
    expect(isOverdue(task(1, 1, { dueDate: "2020-01-01", status: "done" }), "2026-01-01")).toBe(false);
    expect(isOverdue(task(1, 1, { dueDate: "2030-01-01" }), "2026-01-01")).toBe(false);
  });
});
