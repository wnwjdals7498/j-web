import { Pool } from "pg";
import type { PoolConfig } from "pg";
// pg removes a failed idle connection; the application can return 503 and reconnect.
export function createDatabasePool(
  config: PoolConfig,
  report: () => void = () => {
    process.stderr.write("Web database connection unavailable.\n");
  },
): Pool {
  const pool = new Pool(config);
  pool.on("error", report);
  return pool;
}
