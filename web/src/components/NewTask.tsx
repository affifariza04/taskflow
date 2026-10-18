import { type FormEvent, useState } from "react";
import type { Priority } from "../api";

export interface NewTaskInput {
  title: string;
  priority: Priority;
  dueDate: string | null;
}

export function NewTask({ onCreate }: { onCreate: (input: NewTaskInput) => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const title = String(f.get("title")).trim();
    if (!title) return;
    setBusy(true);
    try {
      await onCreate({
        title,
        priority: f.get("priority") as Priority,
        dueDate: String(f.get("dueDate")) || null,
      });
      form.reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="new-task" onSubmit={submit}>
      <input name="title" placeholder="Add a task…" aria-label="Task title" maxLength={200} required />
      <select name="priority" defaultValue="medium" aria-label="Priority">
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
      <input name="dueDate" type="date" aria-label="Due date" />
      <button className="primary" disabled={busy}>
        Add
      </button>
    </form>
  );
}
