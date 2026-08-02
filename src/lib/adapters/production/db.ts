import { Pool } from "pg";

/**
 * Production Postgres pool (Supabase database URL, or any PostgreSQL 16
 * server for credential-free integration testing). Server-side only.
 */

let pool: Pool | null = null;

export function getPool(connectionString: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 5,
      // Supabase requires TLS in production; plain localhost test servers
      // don't offer it. sslmode in the URL wins when present.
      ssl: connectionString.includes("sslmode=")
        ? undefined
        : connectionString.includes("localhost") ||
            connectionString.includes("127.0.0.1")
          ? false
          : { rejectUnauthorized: true },
    });
  }
  return pool;
}

/** Test seam: close and clear the pool. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
