import postgres from "postgres";

export function createPostgresDemoSeedDatabase(databaseUrl) {
  const sql = postgres(databaseUrl, { max: 2 });

  return {
    async inspectTarget() {
      const targets = await sql`
        select database_name as "databaseName", fingerprint::text, profile
        from platform_data_environment
        where singleton = true
      `;
      const target = targets[0];
      if (!target) throw new Error("Database target fingerprint is not registered");
      return target;
    },

    async withNamespaceLock(namespace, operation) {
      const connection = await sql.reserve();
      try {
        const locks = await connection`
          select pg_try_advisory_lock(hashtextextended(${namespace}, 0)) as acquired
        `;
        if (!locks[0]?.acquired) {
          throw new Error(`demo:seed is already running for namespace ${namespace}`);
        }
        return await operation();
      } finally {
        await connection`
          select pg_advisory_unlock(hashtextextended(${namespace}, 0))
        `;
        connection.release();
      }
    },

    async writeManifestReceipt(report) {
      await sql.begin(async (transaction) => {
        await transaction`
          insert into platform_seed_manifest_receipts
            (namespace, manifest_version, target_fingerprint, report, applied_at)
          select ${report.namespace}, ${report.manifestVersion}, fingerprint,
            ${transaction.json(report)}, now()
          from platform_data_environment
          where singleton = true
          on conflict (namespace) do update set
            manifest_version = excluded.manifest_version,
            target_fingerprint = excluded.target_fingerprint,
            report = excluded.report,
            applied_at = excluded.applied_at
        `;
      });
    },

    async close() {
      await sql.end({ timeout: 1 });
    },
  };
}
