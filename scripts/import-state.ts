// Usage: node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/import-state.ts path/to/state.json
// Imports the old app's data/state.json into the database. Safe to run more than once.
import { readFileSync } from 'node:fs';
import { importState, type LegacyState } from '../src/lib/import-state';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: import-state.ts path/to/state.json');
    process.exit(1);
  }
  const state = JSON.parse(readFileSync(file, 'utf8')) as LegacyState;
  const r = await importState(state);
  console.log(`Imported ${r.matched} matched and ${r.skipped} screened-out tenders.`);
}

main();
