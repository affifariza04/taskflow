import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { openDb } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3001);
const dbPath = process.env.DATABASE_PATH ?? path.resolve(here, "../data/taskflow.db");

let jwtSecret = process.env.JWT_SECRET ?? "";
if (!jwtSecret) {
  if (process.env.NODE_ENV === "production") {
    console.error("JWT_SECRET must be set in production");
    process.exit(1);
  }
  jwtSecret = "dev-only-secret-change-me-dev-only-secret";
  console.warn("JWT_SECRET not set; using an insecure development secret");
}

mkdirSync(path.dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const app = createApp({ db, jwtSecret, staticDir: path.resolve(here, "../../web/dist") });

const server = app.listen(port, () => console.log(`taskflow API listening on http://localhost:${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
