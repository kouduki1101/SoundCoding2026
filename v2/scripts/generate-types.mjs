import { compileFromFile } from 'json-schema-to-typescript';
import { rename, writeFile } from 'node:fs/promises';
async function writeGenerated(path, content) {
  const temporary = `${path}.generated.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, path);
}
let result = '';
for (const name of [
  'CallRelationships',
  'SemanticMap',
  'ScoreBundle',
  'InvestigationResult',
  'ImprovementProposal',
  'StructureComparison',
  'StructurePlaybackPlan',
  'ComparisonInvestigationRequest',
  'ComparisonInvestigationResult',
  'ComparisonExport',
]) {
  const types = await compileFromFile(`contracts/${name}.schema.json`, {
    bannerComment: '',
    additionalProperties: false,
  });
  await writeGenerated(`packages/contracts/${name}.ts`, types);
  result += `export type { ${name} } from './${name}';\n`;
}
await writeGenerated('packages/contracts/index.ts', result);
