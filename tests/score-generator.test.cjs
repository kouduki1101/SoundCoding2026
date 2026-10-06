'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Score = require('../src/score-generator.js');
const Analyzer = require('../src/story-analyzer.js');
const parser = require('../src/vendor/acorn.js');
const compiler = require('../src/vendor/score-compiler.js');
const analyze = files => { const m = Analyzer.analyze(files,{parser,compiler}); assert.deepEqual(m.errors,[]); return m; };
const api = 'export function standard(items){return items.reduce((sum,item)=>sum+item.price,0);}\nexport function premium(items){let sum=0;for(const item of items){sum+=item.price;}return sum;}';
function fixture(target='standard',body='') { return analyze({'api.js':api,'main.js':'import {standard,premium} from "./api.js";\nexport function checkout(items){\n'+body+'\nconst value='+target+'(items);\nreturn value;\n}'}); }
function audible(e,origin=0) { return {at:Math.round((e.at-origin)*1e6)/1e6,duration:e.duration,midi:e.midi,gain:e.gain,instrument:e.instrument,voiceToneRatio:e.voiceToneRatio,kind:e.kind,phase:e.phase}; }
function sectionAudio(s,id) { const section=s.sections.find(s=>s.id===id); return s.events.filter(e=>e.sectionId===id).map(e=>audible(e,section.at)); }
const relationAudio=(s,id)=>sectionAudio(s,'relation:'+id);

test('input order, comments and formatting do not retune functions or blocks',()=>{
  const a=fixture(), b=analyze({'main.js':'// comment\n'+a.files['main.js'].replaceAll(';',';\n\n'),'api.js':'/* unchanged */\n'+api}); b.functions.reverse(); b.connections.reverse();
  const sa=Score.buildScore(a), sb=Score.buildScore(b); assert.deepEqual(sa.events.map(e=>audible(e)),sb.events.map(e=>audible(e)));
  a.functions.forEach(fn=>{assert.deepEqual(sa.profiles[fn.id].notes,sb.profiles[fn.id].notes);assert.equal(sa.profiles[fn.id].instrument,sb.profiles[fn.id].instrument);});
  const reversed=structuredClone(a); reversed.functions.reverse(); reversed.connections.reverse(); assert.deepEqual(Score.buildScore(reversed),sa);
});
test('canonical AST ignores positions, comments, raw spelling and key order',()=>{
  const a=parser.parse('function a(){return 1;}',{ecmaVersion:'latest',locations:true}).body[0],b=structuredClone(a);b.start=1000;b.loc.start.line=200;b.comments=[{value:'comment'}];b.body.body[0].argument.raw='0x1';b.body.body[0].argument=Object.fromEntries(Object.entries(b.body.body[0].argument).reverse());assert.equal(Score.canonicalAST(a),Score.canonicalAST(b));
});
test('role inference cannot silently change a stable function instrument',()=>{
  const fn=fixture().functions[0], changed={...fn,role:'orchestrator'};assert.deepEqual(Score.profile(fn).notes,Score.profile(changed).notes);assert.equal(Score.profile(fn).instrument,Score.profile(changed).instrument);
});
test('performer tone follows the function through themes, blocks, quotation and response',()=>{
  const p=fixture(),s=Score.buildScore(p);
  for(const e of s.events){assert.equal(e.voiceToneRatio,s.profiles[e.part].voiceToneRatio);assert.ok([2,4,8,16].includes(e.voiceToneRatio));}
  const changed=structuredClone(p);changed.functions.forEach(f=>f.role='utility');changed.connections.forEach(c=>c.review=true);
  assert.deepEqual(s.events.map(e=>audible(e)),Score.buildScore(changed).events.map(e=>audible(e)));
});
test('delivery example retains exact quoted notes while two pluck performers differ in tone',()=>{
  const scene=JSON.parse(fs.readFileSync(require.resolve('../src/review-scenes.json'),'utf8')).scenes.find(s=>s.id==='delivery-route');
  const before=analyze(scene.before),after=analyze(scene.after),pair=Score.buildComparison(before,after),r=pair.before.relations[0];
  const caller=pair.before.profiles[r.source],callee=pair.before.profiles[r.target];
  assert.equal(caller.instrument,callee.instrument);assert.notEqual(caller.voiceToneRatio,callee.voiceToneRatio);
  const a=pair.before.events.filter(e=>e.connectionId===r.id&&e.phase==='caller'),b=pair.before.events.filter(e=>e.connectionId===r.id&&e.phase==='callee');
  assert.deepEqual(a.map(e=>e.midi),b.map(e=>e.midi));assert.deepEqual(a.map(e=>e.duration),b.map(e=>e.duration));
  assert.ok(a.every(e=>e.voiceToneRatio===caller.voiceToneRatio));assert.ok(b.every(e=>e.voiceToneRatio===callee.voiceToneRatio));
  for(const fn of before.functions){assert.equal(pair.before.profiles[fn.id].voiceToneRatio,pair.after.profiles[fn.id].voiceToneRatio);}
});
test('each relation quotes the actual callee theme in the two performers voices',()=>{
  const p=fixture(),score=Score.buildScore(p),c=p.connections[0],es=score.events.filter(e=>e.connectionId===c.id),theme=score.profiles[c.target];
  for(const phase of ['caller','callee','reception']) {const phrase=es.filter(e=>e.phase===phase);assert.deepEqual(phrase.map(e=>e.midi),theme.notes);assert.ok(phrase.every(e=>e.themeId===c.target));const performer=phase==='callee'?c.target:c.source;assert.ok(phrase.every(e=>e.part===performer&&e.instrument===score.profiles[performer].instrument));assert.deepEqual(phrase.map(e=>e.duration),theme.lengths.map(n=>Math.round(n*.6*1e6)/1e6));}
  assert.deepEqual([...new Set(es.map(e=>e.part))].sort(),[c.source,c.target].sort());assert.ok(es.every(e=>!/expectation|offer|open/.test(e.kind)));
});
test('unknown contracts and whole versus property use do not create warning pitches',()=>{
  function model(fixed){return analyze({'api.js':'export function reserve(){return {ok:false};}','main.js':'import {reserve} from "./api.js";export function checkout(){const r=reserve();if(!r'+(fixed?'.ok':'')+')return false;return true;}'});}
  const pair=Score.buildComparison(model(false),model(true)),c=pair.relationPairs.find(p=>p.beforeId&&p.afterId);assert.ok(c);assert.deepEqual(relationAudio(pair.before,c.beforeId),relationAudio(pair.after,c.afterId));assert.equal(pair.before.relations[0].status,'observed');assert.equal(pair.before.relations[0].correctness,'unknown');assert.ok(!Object.hasOwn(pair.before.relations[0],'interval'));assert.equal(pair.before.events.filter(e=>e.phase==='callee').length,4);
});
test('local relation sections are 9.6 seconds at fixed 100 BPM and ignore song compression',()=>{
  const p=fixture(),full=Score.buildScore(p,{durationSec:3}),local=Score.buildScore(p,{mode:'relation',connectionId:p.connections[0].id});assert.equal(full.bpm,100);assert.equal(local.sections.length,1);assert.equal(local.sections[0].duration,9.6);assert.equal(local.durationSec,9.95);assert.ok(full.durationSec>30);assert.deepEqual(relationAudio(full,p.connections[0].id),relationAudio(local,p.connections[0].id));
});
test('changed target edges pair through one unique callsite, retaining unrelated code sounds',()=>{
  const a=fixture('standard'),b=fixture('premium');a.connections[0].id='checkout->standard';b.connections[0].id='checkout->premium';
  const pair=Score.buildComparison(a,b),r=pair.relationPairs.find(p=>p.beforeId&&p.afterId);assert.deepEqual({beforeId:r.beforeId,afterId:r.afterId,reason:r.reason},{beforeId:'checkout->standard',afterId:'checkout->premium',reason:'unique-callsite'});
  const sa=pair.before.sections.find(s=>s.id==='relation:'+r.beforeId),sb=pair.after.sections.find(s=>s.id==='relation:'+r.afterId);assert.equal(sa.at,sb.at);assert.equal(sa.comparisonKey,sb.comparisonKey);assert.notDeepEqual(relationAudio(pair.before,r.beforeId),relationAudio(pair.after,r.afterId));
  for(const id of a.functions.filter(f=>f.name!=='checkout').map(f=>f.id))assert.deepEqual(sectionAudio(pair.before,'voice:'+id),sectionAudio(pair.after,'voice:'+id));assert.equal(pair.before.durationSec,pair.after.durationSec);
});
test('callee import alias changes preserve the resolved theme and unique relation pairing',()=>{
  const a=fixture(),b=analyze({'api.js':api,'main.js':'import {standard as calculate,premium} from "./api.js";export function checkout(items){const value=calculate(items);return value;}'}),pair=Score.buildComparison(a,b),r=pair.relationPairs.find(r=>r.beforeId&&r.afterId);assert.ok(r);assert.deepEqual(relationAudio(pair.before,r.beforeId),relationAudio(pair.after,r.afterId));
});
test('repeated ambiguous target changes do not fabricate callsite correspondence',()=>{
  function p(target){const m=analyze({'api.js':api,'main.js':'import {standard,premium} from "./api.js";export function checkout(items){'+target+'(items);'+target+'(items);return items;}'});m.connections.forEach((c,i)=>{c.id=target+':'+i;});return m;}
  const pair=Score.buildComparison(p('standard'),p('premium'));assert.equal(pair.relationPairs.length,4);assert.ok(pair.relationPairs.every(r=>!r.beforeId||!r.afterId));
});
test('local comparison can follow a changed edge ID without losing the after excerpt',()=>{
  const a=fixture('standard'),b=fixture('premium');a.connections[0].id='old-edge';b.connections[0].id='new-edge';const pair=Score.buildComparison(a,b,{mode:'relation',connectionId:'old-edge'});assert.equal(pair.before.sections.length,1);assert.equal(pair.after.sections.length,1);assert.equal(pair.before.sections[0].id,'relation:old-edge');assert.equal(pair.after.sections[0].id,'relation:new-edge');assert.equal(pair.before.durationSec,pair.after.durationSec);
});
test('statement-local blocks survive unrelated declaration insertion without retiming in comparison',()=>{
  const before=fixture(),after=fixture('standard','const unused=42;'),pair=Score.buildComparison(before,after);
  for(const fn of before.functions)for(const block of fn.blocks){const ea=pair.before.events.filter(e=>e.kind==='block'&&e.blockId===block.id),eb=pair.after.events.filter(e=>e.kind==='block'&&e.blockId===block.id);assert.equal(ea.length,4);assert.deepEqual(ea.map(e=>audible(e)),eb.map(e=>audible(e)));}
  const r=pair.relationPairs.find(r=>r.beforeId&&r.afterId);assert.deepEqual(relationAudio(pair.before,r.beforeId),relationAudio(pair.after,r.afterId));
});
test('editing a loop changes that block articulation without rewriting unchanged return',()=>{
  const a=analyze({'a.js':'export function total(items){let sum=0;items.reduce((s,x)=>s+x,0);return sum;}'}),b=analyze({'a.js':'export function total(items){let sum=0;for(const x of items){sum+=x;}return sum;}'}),pair=Score.buildComparison(a,b),id=a.functions[0].id;assert.deepEqual(pair.before.profiles[id].notes,pair.after.profiles[id].notes);
  a.functions[0].blocks.filter(b=>b.statementKind==='ReturnStatement'||b.statementKind==='VariableDeclaration').forEach(b=>assert.deepEqual(pair.before.events.filter(e=>e.blockId===b.id).map(e=>audible(e)),pair.after.events.filter(e=>e.blockId===b.id).map(e=>audible(e))));
  const flowing=pair.before.events.filter(e=>e.kind==='block'&&e.source.statementKind==='ExpressionStatement'),stepped=pair.after.events.filter(e=>e.kind==='block'&&e.source.statementKind==='ForOfStatement');assert.notDeepEqual(flowing.map(e=>e.duration),stepped.map(e=>e.duration));
});
test('unique identical declaration inherits identity after rename or move',()=>{
  const a=analyze({'old.js':'export function alpha(items){return items+1;}'}),b=analyze({'new.js':'export function beta(items){return items+1;}'}),pair=Score.buildComparison(a,b),f=pair.functionPairs[0];assert.equal(f.reason,'unique-identical-declaration');assert.deepEqual(pair.before.profiles[f.beforeId].notes,pair.after.profiles[f.afterId].notes);assert.equal(pair.before.profiles[f.beforeId].instrument,pair.after.profiles[f.afterId].instrument);assert.deepEqual(sectionAudio(pair.before,'voice:'+f.beforeId),sectionAudio(pair.after,'voice:'+f.afterId));
});
test('duplicated or changed bodies do not prove a rename',()=>{
  const a=analyze({'a.js':'export function alpha(){return 1;}export function twin(){return 1;}'}),b=analyze({'b.js':'export function beta(){return 1;}'}),c=analyze({'b.js':'export function beta(){return 2;}'});assert.ok(Score.buildComparison(a,b).functionPairs.every(f=>!f.beforeId||!f.afterId));assert.ok(Score.buildComparison(a,c).functionPairs.every(f=>!f.beforeId||!f.afterId));
});
test('block and phase sources identify real call, return and use ranges',()=>{
  const p=analyze({'api.js':'export function reserve(){\nreturn {ok:false};\n}','main.js':'import {reserve} from "./api.js";\nexport function checkout(){\nconst r=reserve();\nif(!r.ok)return false;\nreturn true;\n}'}),score=Score.buildScore(p),c=p.connections[0];
  for(const phase of ['caller','callee','reception']){const e=score.events.find(e=>e.phase===phase);assert.equal(e.source.kind,'connection');assert.equal(e.source.phase,phase);assert.equal(e.source.caller.functionId,c.source);assert.equal(e.source.callee.functionId,c.target);assert.equal(e.source.active.startLine,phase==='caller'?3:phase==='callee'?2:4);assert.equal(e.line,e.source.active.startLine);assert.ok(e.source.themeSource);}
  const block=score.events.find(e=>e.kind==='block'&&e.source.statementKind==='ReturnStatement');assert.equal(block.source.kind,'block');assert.ok(block.source.blockId);assert.equal(block.source.startLine,2);
});
test('unrelated function addition keeps local phrases and tempo stable',()=>{
  const a=fixture(),b=fixture(),helper=analyze({'aaa.js':'export function helper(value){return value*2;}'}).functions[0];b.functions.push(helper);const pair=Score.buildComparison(a,b);assert.equal(pair.before.bpm,pair.after.bpm);assert.equal(pair.before.durationSec,pair.after.durationSec);for(const fn of a.functions)assert.deepEqual(sectionAudio(pair.before,'voice:'+fn.id),sectionAudio(pair.after,'voice:'+fn.id));assert.equal(pair.before.sections.find(s=>s.slotKey===helper.id).absent,true);
});
test('multiple return candidates do not pretend the first branch executed',()=>{
  const p=analyze({'api.js':'export function reserve(flag){if(flag)return false;return true;}','main.js':'import {reserve} from "./api.js";export function checkout(flag){return reserve(flag);}'}),s=Score.buildScore(p),e=s.events.find(e=>e.phase==='callee');assert.equal(e.source.returns.length,2);assert.deepEqual(e.source.active,e.source.callee);
});
test('relation audition excludes unrelated parts; function audition keeps related sections',()=>{
  const p=fixture(),c=p.connections[0],score=Score.buildScore(p,{mode:'relation',connectionId:c.id});assert.deepEqual([...new Set(score.events.map(e=>e.part))].sort(),[c.source,c.target].sort());const block=Score.buildScore(p,{mode:'block',focusId:c.source});assert.ok(block.sections.some(s=>s.id==='voice:'+c.source));assert.ok(block.sections.some(s=>s.id==='relation:'+c.id));assert.ok(!block.sections.some(s=>s.id==='voice:'+c.target));
});
test('large functions become longer at the same tempo rather than hiding blocks',()=>{
  const a=analyze({'a.js':'export function a(){'+Array.from({length:18},(_,i)=>'const value'+i+'='+i+';').join('')+'return value0;}'}),score=Score.buildScore(a,{durationSec:10});assert.equal(score.bpm,100);assert.equal(score.sections[0].blocks.length,19);assert.equal(score.events.filter(e=>e.kind==='block').length,19*4);assert.ok(score.durationSec>20);
});
test('failure evidence and inferred contract severity never stop or retune ordinary listening',()=>{
  const a=fixture(),b=structuredClone(a);b.testEvidence={status:'failed',failedAt:1};b.connections.forEach(c=>{c.review=true;c.expected='boolean-success';c.provided='reservation-result';c.questionKind='whole-value-with-ok';});const sa=Score.buildScore(a),sb=Score.buildScore(b,{failureAt:1});assert.deepEqual(sa.events.map(e=>audible(e)),sb.events.map(e=>audible(e)));assert.ok(sb.events.some(e=>e.at>1));assert.ok(!Object.hasOwn(sb,'failureAt'));
});
test('finite events have unique IDs, bounded register and headroom-friendly gains',()=>{
  const s=Score.buildScore(fixture());assert.equal(new Set(s.events.map(e=>e.id)).size,s.events.length);for(const e of s.events){assert.ok(Number.isFinite(e.at)&&e.at>=0);assert.ok(e.duration>0&&e.at+e.duration<=s.durationSec);assert.ok(e.gain>0&&e.gain<=.5);assert.ok(e.midi>=60&&e.midi<=81);assert.ok([0,2,4,7,9].includes(e.midi%12));}
});
test('external targets are reported without invented voices or compatibility judgment',()=>{
  const p=fixture();p.connections.push({id:'external',source:p.functions[0].id,target:'external:unknown'});const s=Score.buildScore(p);assert.deepEqual(s.omittedConnections,[{id:'external',source:p.functions[0].id,target:'external:unknown',reason:'endpoint-outside-scope'}]);assert.ok(!s.events.some(e=>e.connectionId==='external'));
});
test('generation does not mutate input and malformed identities fail explicitly',()=>{
  const p=fixture(),copy=JSON.stringify(p);Score.buildScore(p);Score.buildComparison(p,p);assert.equal(JSON.stringify(p),copy);assert.throws(()=>Score.buildScore({functions:[{}]}),/Function id is required/);p.functions.push(p.functions[0]);assert.throws(()=>Score.buildScore(p),/Duplicate function id/);
});
test('the same API exports in a browser without dependencies',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../src/score-generator.js'),'utf8'),context);assert.equal(context.StoryScore.version,Score.version);assert.equal(context.StoryScore.buildScore(fixture()).events.length,Score.buildScore(fixture()).events.length);
});
