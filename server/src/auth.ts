import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { RequestHandler } from "express";
import { jwtVerify, SignJWT } from "jose";
import { HttpError } from "./errors.js";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LEN = 64;

/** Format: scrypt$<salt hex>$<hash hex>. The prefix leaves room to migrate algorithms. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(secret: string, private readonly ttl = "7d") {
    if (secret.length < 32) throw new Error("JWT secret must be at least 32 characters");
    this.key = new TextEncoder().encode(secret);
  }

  sign(userId: number): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(String(userId))
      .setIssuedAt()
      .setExpirationTime(this.ttl)
      .sign(this.key);
  }

  async verify(token: string): Promise<number> {
    const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
    const id = Number(payload.sub);
    if (!Number.isInteger(id)) throw new Error("bad subject");
    return id;
  }
}

/** Puts the authenticated user's id on `res.locals.userId`. */
export function requireAuth(tokens: TokenService): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new HttpError(401, "unauthorized", "Missing bearer token");
    try {
      res.locals.userId = await tokens.verify(token);
    } catch {
      throw new HttpError(401, "unauthorized", "Invalid or expired token");
    }
    next();
  };
}

/**
 * Fixed-window limiter, in memory. Enough to blunt password guessing on a
 * single instance; use Redis or the reverse proxy when running several.
 */
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      throw new HttpError(429, "rate_limited", "Too many attempts, try again later");
    }
    next();
  };
}
