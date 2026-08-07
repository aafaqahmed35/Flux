import { closePostgresConnection } from '../src/database/postgres.js';
import { getAppliedMigrations, getMigrationStatus, runMigrations } from '../src/database/migrator.js';

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = args[0] ?? '--apply';

  try {
    if (command === '--status' || command === 'status') {
      const status = await getMigrationStatus();
      console.log('\n--- Migration Status ---');
      console.log(`Applied (${status.applied.length}):`);
      status.applied.forEach((m) => console.log(`  ✓ ${m.name} (applied at: ${m.appliedAt.toISOString()})`));
      console.log(`Pending (${status.pending.length}):`);
      status.pending.forEach((p) => console.log(`  ⏳ ${p}`));
      console.log('------------------------\n');
    } else if (command === '--history' || command === 'history') {
      const applied = await getAppliedMigrations();
      console.log('\n--- Migration History ---');
      applied.forEach((m) => console.log(`  ✓ ${m.name} | ${m.appliedAt.toISOString()}`));
      console.log('-------------------------\n');
    } else {
      console.log('Running pending migrations...');
      const applied = await runMigrations();
      if (applied.length > 0) {
        console.log(`Successfully applied ${applied.length} migration(s): ${applied.join(', ')}`);
      } else {
        console.log('Database is up to date.');
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Migration command failed: ${msg}`);
    process.exit(1);
  } finally {
    await closePostgresConnection();
  }
};

void main();
