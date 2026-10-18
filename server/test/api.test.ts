import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword, verifyPassword } from "../src/auth.js";
import { openDb } from "../src/db.js";

const SECRET = "test-secret-test-secret-test-secret!!";
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp({ db: openDb(), jwtSecret: SECRET, authRateLimit: { windowMs: 60_000, max: 1000 } });
});

async function signUp(email = "ana@example.com") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, name: "Ana", password: "correct horse" });
  expect(res.status).toBe(201);
  return { token: res.body.token as string, auth: { Authorization: `Bearer ${res.body.token}` } };
}

describe("auth", () => {
  it("hashes passwords with a per-user salt", async () => {
    const a = await hashPassword("pw-123456");
    const b = await hashPassword("pw-123456");
    expect(a).not.toBe(b);
    expect(await verifyPassword("pw-123456", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
  });

  it("registers, logs in, and returns the current user", async () => {
    const { auth } = await signUp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "ANA@example.com", password: "correct horse" });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ email: "ana@example.com", name: "Ana" });
    expect(login.body.user).not.toHaveProperty("password_hash");

    const me = await request(app).get("/api/auth/me").set(auth);
    expect(me.body.user.email).toBe("ana@example.com");
  });

  it("rejects duplicate emails case-insensitively", async () => {
    await signUp("ana@example.com");
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "Ana@Example.com", name: "Ana 2", password: "another pw" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("email_taken");
  });

  it("gives the same error for unknown email and wrong password", async () => {
    await signUp();
    const wrongPw = await request(app).post("/api/auth/login").send({ email: "ana@example.com", password: "nope" });
    const noUser = await request(app).post("/api/auth/login").send({ email: "bob@example.com", password: "nope" });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body);
  });

  it("validates registration input", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "not-an-email", name: "", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.issues.map((i: { path: string }) => i.path).sort()).toEqual(["email", "name", "password"]);
  });

  it("requires a valid token for task routes", async () => {
    expect((await request(app).get("/api/tasks")).status).toBe(401);
    const bad = await request(app).get("/api/tasks").set({ Authorization: "Bearer abc.def.ghi" });
    expect(bad.status).toBe(401);
  });

  it("rate-limits auth endpoints", async () => {
    const limited = createApp({ db: openDb(), jwtSecret: SECRET, authRateLimit: { windowMs: 60_000, max: 3 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await request(limited).post("/api/auth/login").send({ email: "eve@example.com", password: "guess" })).status);
    }
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });
});

describe("tasks", () => {
  it("supports create, read, update, delete", async () => {
    const { auth } = await signUp();
    const created = await request(app)
      .post("/api/tasks")
      .set(auth)
      .send({ title: "  Write README  ", priority: "high", dueDate: "2030-01-31" });
    expect(created.status).toBe(201);
    expect(created.body.task).toMatchObject({
      title: "Write README",
      status: "todo",
      priority: "high",
      dueDate: "2030-01-31",
      position: 1,
    });
    const id = created.body.task.id;

    const updated = await request(app).patch(`/api/tasks/${id}`).set(auth).send({ status: "doing" });
    expect(updated.body.task.status).toBe("doing");

    const list = await request(app).get("/api/tasks").set(auth);
    expect(list.body.tasks).toHaveLength(1);

    expect((await request(app).delete(`/api/tasks/${id}`).set(auth)).status).toBe(204);
    expect((await request(app).get("/api/tasks").set(auth)).body.tasks).toHaveLength(0);
  });

  it("isolates tasks between users", async () => {
    const ana = await signUp("ana@example.com");
    const bob = await signUp("bob@example.com");
    const { body } = await request(app).post("/api/tasks").set(ana.auth).send({ title: "Ana's secret" });

    expect((await request(app).get("/api/tasks").set(bob.auth)).body.tasks).toEqual([]);
    expect((await request(app).patch(`/api/tasks/${body.task.id}`).set(bob.auth).send({ title: "pwned" })).status).toBe(404);
    expect((await request(app).delete(`/api/tasks/${body.task.id}`).set(bob.auth)).status).toBe(404);
  });

  it("appends to the end of a column and supports fractional reordering", async () => {
    const { auth } = await signUp();
    const ids: number[] = [];
    for (const title of ["a", "b", "c"]) {
      ids.push((await request(app).post("/api/tasks").set(auth).send({ title })).body.task.id);
    }
    // Drop "c" between "a" (1) and "b" (2).
    await request(app).patch(`/api/tasks/${ids[2]}`).set(auth).send({ position: 1.5 });
    const titles = (await request(app).get("/api/tasks?status=todo").set(auth)).body.tasks.map((t: { title: string }) => t.title);
    expect(titles).toEqual(["a", "c", "b"]);

    // Moving column without a position appends to the target column.
    await request(app).post("/api/tasks").set(auth).send({ title: "d", status: "done" });
    const moved = await request(app).patch(`/api/tasks/${ids[0]}`).set(auth).send({ status: "done" });
    expect(moved.body.task.position).toBe(2);
  });

  it("filters by status, priority and text, escaping LIKE wildcards", async () => {
    const { auth } = await signUp();
    await request(app).post("/api/tasks").set(auth).send({ title: "Fix login bug", priority: "high" });
    await request(app).post("/api/tasks").set(auth).send({ title: "Write docs", description: "100% coverage" });
    await request(app).post("/api/tasks").set(auth).send({ title: "Deploy", status: "done" });

    const q = (qs: string) => request(app).get(`/api/tasks?${qs}`).set(auth).then((r) => r.body.tasks.map((t: { title: string }) => t.title));
    expect(await q("q=login")).toEqual(["Fix login bug"]);
    expect(await q("priority=high")).toEqual(["Fix login bug"]);
    expect(await q("status=done")).toEqual(["Deploy"]);
    expect(await q("q=%25")).toEqual(["Write docs"]);
    expect((await request(app).get("/api/tasks?status=archived").set(auth)).status).toBe(400);
  });

  it("validates updates", async () => {
    const { auth } = await signUp();
    const { body } = await request(app).post("/api/tasks").set(auth).send({ title: "x" });
    const r = (payload: object) => request(app).patch(`/api/tasks/${body.task.id}`).set(auth).send(payload);
    expect((await r({})).status).toBe(400);
    expect((await r({ status: "blocked" })).status).toBe(400);
    expect((await r({ dueDate: "31/01/2030" })).status).toBe(400);
    expect((await request(app).patch("/api/tasks/abc").set(auth).send({ title: "y" })).status).toBe(400);
  });

  it("reports stats including overdue tasks", async () => {
    const { auth } = await signUp();
    await request(app).post("/api/tasks").set(auth).send({ title: "late", dueDate: "2001-01-01" });
    await request(app).post("/api/tasks").set(auth).send({ title: "late but done", dueDate: "2001-01-01", status: "done" });
    await request(app).post("/api/tasks").set(auth).send({ title: "doing", status: "doing" });
    await request(app).post("/api/tasks").set(auth).send({ title: "done", status: "done" });

    const { body } = await request(app).get("/api/tasks/stats").set(auth);
    expect(body).toEqual({ total: 4, byStatus: { todo: 1, doing: 1, done: 2 }, overdue: 1, completionRate: 0.5 });
  });
});

describe("api", () => {
  it("returns JSON errors for unknown routes and malformed JSON", async () => {
    expect((await request(app).get("/api/nope")).body.error.code).toBe("not_found");
    const res = await request(app).post("/api/auth/login").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });

  it("allows CORS only for configured origins", async () => {
    const cors = createApp({ db: openDb(), jwtSecret: SECRET, corsOrigins: ["http://localhost:5555"] });
    const ok = await request(cors).options("/api/tasks").set("Origin", "http://localhost:5555");
    expect(ok.status).toBe(204);
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5555");
    const evil = await request(cors).options("/api/tasks").set("Origin", "https://evil.example");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    const off = await request(app).get("/api/health").set("Origin", "http://localhost:5555");
    expect(off.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sets security headers", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
