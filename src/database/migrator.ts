import fs from 'node:fs';
import path from 'node:path';
import { pgPool } from './postgres.js';
import { appLogger, errorLogger } from '../logger/logger.js';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export interface MigrationRecord {
  name: string;
  appliedAt: Date;
}

export interface MigrationStatus {
  applied: MigrationRecord[];
  pending: string[];
}

export const ensureMigrationsTable = async (): Promise<void> => {
  const query = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pgPool.query(query);
};

export const getAppliedMigrations = async (): Promise<MigrationRecord[]> => {
  await ensureMigrationsTable();
  const result = await pgPool.query<{ name: string; applied_at: Date }>(
    'SELECT name, applied_at FROM schema_migrations ORDER BY applied_at ASC',
  );
  return result.rows.map((row) => ({
    name: row.name,
    appliedAt: row.applied_at,
  }));
};

export const getMigrationFiles = (): string[] => {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
};

export const getMigrationStatus = async (): Promise<MigrationStatus> => {
  const applied = await getAppliedMigrations();
  const appliedSet = new Set(applied.map((m) => m.name));
  const allFiles = getMigrationFiles();
  const pending = allFiles.filter((file) => !appliedSet.has(file));

  return { applied, pending };
};

export const runMigrations = async (): Promise<string[]> => {
  await ensureMigrationsTable();
  const { pending } = await getMigrationStatus();

  if (pending.length === 0) {
    appLogger.info('No pending database migrations to apply');
    return [];
  }

  const appliedNow: string[] = [];

  for (const filename of pending) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    const sql = fs.readFileSync(filePath, 'utf8');

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [filename]);
      await client.query('COMMIT');

      appLogger.info(`Successfully applied migration: ${filename}`);
      appliedNow.push(filename);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error(`Failed to apply migration ${filename}: ${msg}`, { filename, error: msg });
      throw new Error(`Migration failure in ${filename}: ${msg}`);
    } finally {
      client.release();
    }
  }

  return appliedNow;
};
