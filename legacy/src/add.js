// Usage: node --env-file=.env src/add.js TS0000017278E TS0000017133E ...
// Reads and scores the named tenders and stores them, skipping the quick screen. Don't run while a dashboard fetch is in progress.
import { run } from './pipeline.js';

await run({ ids: process.argv.slice(2), log: console.log, stopped: () => false });
