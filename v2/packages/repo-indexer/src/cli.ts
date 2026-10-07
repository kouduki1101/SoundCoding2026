import { readFileSync } from 'node:fs';
import { indexSnapshot } from './indexer';
const input = JSON.parse(readFileSync(0, 'utf8')) as { snapshot_id: string; sources: Record<string, string> };
process.stdout.write(JSON.stringify(indexSnapshot(input)));
