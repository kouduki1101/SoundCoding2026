import { compareStructure } from './structure';
import { indexSnapshot } from './indexer';
import { compileStructure } from '../../groove-core/src/structure';
import { callRelationships } from './relationships';
let data = '';
for await (const chunk of process.stdin) data += chunk;
const input = JSON.parse(data);
if (input.operation === 'relationships') {
  console.log(JSON.stringify(callRelationships(input)));
} else if (!input.unit_a || !input.unit_b) {
  const index = indexSnapshot(input);
  console.log(
    JSON.stringify({
      snapshot_id: input.snapshot_id,
      units: index.units.filter((u) => u.primary_span.path.endsWith('.ts')),
      unsupported_languages: ['Python', 'TSX'],
    }),
  );
} else {
  const comparison = compareStructure(input, input.unit_a, input.unit_b);
  console.log(JSON.stringify({ comparison, playback: compileStructure(comparison, !!input.markers) }));
}
