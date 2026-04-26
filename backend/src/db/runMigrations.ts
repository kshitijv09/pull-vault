import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getClient } from "./index";

async function runMigrations(): Promise<void> {
  const client = await getClient();
  const migrationsDirPath = path.join(__dirname, "migrations");

  try {
    const migrationFiles = (await readdir(migrationsDirPath))
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort();

    await client.query("BEGIN");

    for (const migrationFile of migrationFiles) {
      const migrationPath = path.join(migrationsDirPath, migrationFile);
      const sql = await readFile(migrationPath, "utf8");
      await client.query(sql);
      console.log(`Applied migration: ${migrationFile}`);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

runMigrations()
  .then(() => {
    console.log("Database migrations completed successfully.");
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("Database migration failed.", error);
    process.exit(1);
  });
