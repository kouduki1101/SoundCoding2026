import { readFileSync } from 'node:fs';
import { compileGroove } from './compiler';
const input = JSON.parse(readFileSync(0, 'utf8'));
try {
  process.stdout.write(JSON.stringify(await compileGroove(input.map, input.kit_hash)));
} catch (error) {
  process.stderr.write(String(error));
  process.exit(1);
}
