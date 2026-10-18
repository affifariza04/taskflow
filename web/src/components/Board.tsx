import { type DragEvent, useState } from "react";
import type { Status, Task } from "../api";
import { COLUMNS, groupByStatus, isOverdue } from "../board";

interface Props {
  tasks: Task[];
  onMove: (id: number, status: Status, beforeId: number | null) => void;
  onDelete: (id: number) => void;
  onAdvance: (task: Task) => void;
}

const NEXT: Record<Status, Status | null> = { todo: "doing", doing: "done", done: null };

export function Board({ tasks, onMove, onDelete, onAdvance }: Props) {
  const columns = groupByStatus(tasks);
  const [dragOver, setDragOver] = useState<Status | null>(null);

  const drop = (status: Status, beforeId: number | null) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (id && id !== beforeId) onMove(id, status, beforeId);
  };

  return (
    <div className="board">
      {COLUMNS.map(({ status, label }) => (
        <section
          key={status}
          className={`column ${dragOver === status ? "drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(status);
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={drop(status, null)}
          aria-label={label}
        >
          <header>
            <h2>{label}</h2>
            <span className="count">{columns[status].length}</span>
          </header>
          {columns[status].length === 0 && <p className="empty">Drop tasks here</p>}
          {columns[status].map((task) => (
            <article
              key={task.id}
              className={`task priority-${task.priority}`}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", String(task.id))}
              onDrop={drop(status, task.id)}
            >
              <p className="title">{task.title}</p>
              <div className="meta">
                <span className={`badge ${task.priority}`}>{task.priority}</span>
                {task.dueDate && (
                  <span className={isOverdue(task) ? "due overdue" : "due"}>
                    {isOverdue(task) ? "Overdue · " : "Due "}
                    {task.dueDate}
                  </span>
                )}
              </div>
              <div className="actions">
                {NEXT[status] && (
                  <button className="ghost" onClick={() => onAdvance(task)} aria-label={`Move ${task.title} forward`}>
                    →
                  </button>
                )}
                <button className="ghost danger" onClick={() => onDelete(task.id)} aria-label={`Delete ${task.title}`}>
                  ✕
                </button>
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

export { NEXT };
