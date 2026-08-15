import postgres from "postgres";
import { describe, expect, it } from "vitest";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";

describe("PostgreSQL integration baseline", () => {
  it("executes a query against the configured real database", async () => {
    const sql = postgres(databaseUrl, { max: 1 });

    try {
      const [result] = await sql<[{ name: string; value: number }]>`
        select current_database() as name, 1::int as value
      `;

      expect(result).toEqual({ name: "sevo", value: 1 });
    } finally {
      await sql.end();
    }
  });
});
