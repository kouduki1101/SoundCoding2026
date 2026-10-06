import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.mkdir(path.join(root,'dist'),{recursive:true});
for(const file of ['story.css','story-app.js','story-analyzer.js','score-generator.js','code-critique.js','story-fixtures.json','review-scenes.json','vendor','audio-assets']) await fs.cp(path.join(root,'src',file),path.join(root,'dist',file),{recursive:true});
await fs.copyFile(path.join(root,'src/story.html'),path.join(root,'dist/index.html'));
await fs.copyFile(path.join(root,'fixtures/verification.json'),path.join(root,'dist/verification.json'));
console.log('Built static SoundCoding story application.');
