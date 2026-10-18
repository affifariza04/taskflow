import { Router } from "express";
import { z } from "zod";
import { hashPassword, rateLimit, requireAuth, type TokenService, verifyPassword } from "../auth.js";
import type { DB } from "../db.js";
import { HttpError } from "../errors.js";

const Register = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});
const Login = z.object({ email: z.email(), password: z.string().min(1) });

interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
}

const publicUser = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.created_at });

export function authRoutes(db: DB, tokens: TokenService, limit = { windowMs: 15 * 60_000, max: 20 }) {
  const router = Router();
  const limiter = rateLimit(limit);

  router.post("/register", limiter, async (req, res) => {
    const body = Register.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    let row: UserRow;
    try {
      row = db
        .prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING *")
        .get(body.email, body.name, passwordHash) as unknown as UserRow;
    } catch (err) {
      if (String(err).includes("UNIQUE")) throw new HttpError(409, "email_taken", "Email is already registered");
      throw err;
    }
    res.status(201).json({ token: await tokens.sign(row.id), user: publicUser(row) });
  });

  router.post("/login", limiter, async (req, res) => {
    const body = Login.parse(req.body);
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(body.email) as UserRow | undefined;
    // Same message for unknown email and wrong password: no account enumeration.
    if (!row || !(await verifyPassword(body.password, row.password_hash))) {
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
    }
    res.json({ token: await tokens.sign(row.id), user: publicUser(row) });
  });

  router.get("/me", requireAuth(tokens), (_req, res) => {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(res.locals.userId) as UserRow | undefined;
    if (!row) throw new HttpError(401, "unauthorized", "User no longer exists");
    res.json({ user: publicUser(row) });
  });

  return router;
}
