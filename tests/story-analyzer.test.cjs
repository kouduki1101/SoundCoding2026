const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const analyzer = require('../src/story-analyzer.js');
const parser = require('../src/vendor/acorn.js');
const compiler = require('../src/vendor/score-compiler.js');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/story-fixtures.json'), 'utf8'));
const analyze = files => analyzer.analyze(files, { parser, compiler });
const api = 'export function objectResult(){ return {ok:false}; }\nexport function booleanResult(){ return false; }';

test('portable executable fixture sources match the browser bundle exactly', () => {
  const verification = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/verification.json'), 'utf8'));
  for (const stage of ['base', 'draft', 'aligned']) {
    for (const [file, source] of Object.entries(fixtures.stages[stage].files)) {
      assert.equal(fs.readFileSync(path.join(__dirname, '../fixtures', stage, file), 'utf8'), source, `${stage}/${file}`);
    }
    assert.equal(verification.stages[stage].sourceSha256, fixtures.stages[stage].sourceSha256);
  }
});

function withCaller(source, body) {
  return {
    'api.js': source,
    'main.js': 'import {reserve} from "./api.js";\nexport function checkout(){\n' + body + '\n}'
  };
}
function trackedAnalysis(files) {
  let parses = 0;
  const countingParser = { parse(...args) { parses++; return parser.parse(...args); } };
  const result = analyzer.analyze(files, { parser: countingParser, compiler });
  return { result, parses };
}

for (const stage of ['base', 'draft', 'aligned']) {
  test(`fixture ${stage}: preserve IDs, default quote edge, and contract observation`, () => {
    const { result, parses } = trackedAnalysis(fixtures.stages[stage].files);
    assert.equal(parses, 3, 'accepted files are parsed once, by the compiler');
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.functions.map(fn => fn.id).sort(), [
      'fn:src/checkout.js#checkout',
      'fn:src/inventory.js#createInventory',
      'fn:src/inventory.js#reserve',
      'fn:src/pricing.js#quote'
    ]);
    const reserve = result.connections.find(edge => edge.calleeName === 'reserve');
    const quote = result.connections.find(edge => edge.calleeName === 'quote');
    assert.equal(reserve.id, 'call:fn:src/checkout.js#checkout:VariableDeclaration:0:0');
    assert.equal(reserve.review, false, 'syntax observations do not establish a broken contract');
    assert.equal(reserve.expected, 'unknown');
    assert.equal(reserve.correctness, 'unknown');
    assert.equal(reserve.usageKind, stage === 'aligned' ? 'property-truthiness' : 'truthiness');
    assert.equal(reserve.questionKind === 'whole-value-with-ok', stage === 'draft');
    assert.equal(reserve.projected, stage === 'aligned');
    assert.equal(reserve.binding, 'reservation');
    assert.equal(quote.id, 'default:fn:src/checkout.js#checkout:fn:src/pricing.js#quote');
    assert.equal(quote.resolution, 'default-argument');
    assert.equal(quote.review, false);
  });
}

test('same-line calls do not attach the boolean guard to an unused object return', () => {
  const result = analyze({
    'api.js': api,
    'main.js': 'import {objectResult,booleanResult} from "./api.js";\nexport function checkout(){\n const unused=objectResult(), result=booleanResult();\n if(!result) return false;\n return true;\n}'
  });
  const object = result.connections.find(edge => edge.calleeName === 'objectResult');
  const boolean = result.connections.find(edge => edge.calleeName === 'booleanResult');
  assert.equal(object.binding, 'unused');
  assert.equal(object.review, false);
  assert.equal(object.expected, 'unknown');
  assert.equal(boolean.binding, 'result');
  assert.equal(boolean.expected, 'unknown');
  assert.equal(boolean.usageKind, 'truthiness');
});

test('same-line calls still observe the correct object guard', () => {
  const result = analyze({
    'api.js': api,
    'main.js': 'import {objectResult,booleanResult} from "./api.js";\nexport function checkout(){\n const result=objectResult(), unused=booleanResult();\n if(!result) return false;\n return true;\n}'
  });
  assert.equal(result.connections.find(edge => edge.calleeName === 'objectResult').usageKind, 'truthiness');
  assert.equal(result.connections.find(edge => edge.calleeName === 'objectResult').review, false);
  assert.equal(result.connections.find(edge => edge.calleeName === 'booleanResult').binding, 'unused');
});

test('nested calls are associated by exact call ordinal, not their common line', () => {
  const result = analyze({
    'api.js': api,
    'main.js': 'import {objectResult,booleanResult} from "./api.js";\nexport function checkout(){\n const result=objectResult(booleanResult());\n if(!result) return false;\n return true;\n}'
  });
  assert.equal(result.connections.find(edge => edge.calleeName === 'objectResult').usageKind, 'truthiness');
  assert.equal(result.connections.find(edge => edge.calleeName === 'booleanResult').binding, null);
});

test('a constructor before a call retains its compiler ordinal', () => {
  const result = analyze({
    'api.js': api,
    'main.js': 'import {objectResult} from "./api.js";\nexport function checkout(){\n const map=new Map(), result=objectResult();\n if(!result) return false;\n return true;\n}'
  });
  assert.equal(result.connections.find(edge => edge.calleeName === 'objectResult').binding, 'result');
  assert.equal(result.connections.find(edge => edge.calleeName === 'objectResult').usageKind, 'truthiness');
});

test('two arrow functions on the same line retain separate source bodies and return contracts', () => {
  const result = analyze({
    'api.js': 'export const first=()=>{ return {ok:false}; }, second=()=>{ return false; };'
  });
  const first = result.functions.find(fn => fn.name === 'first');
  const second = result.functions.find(fn => fn.name === 'second');
  assert.equal(first.code, '()=>{ return {ok:false}; }');
  assert.equal(second.code, '()=>{ return false; }');
  assert.equal(first.returns.type, 'reservation-result');
  assert.equal(second.returns.type, 'boolean-success');
});

for (const declaration of [
  'export async function reserve(){ return {ok:false}; }',
  'export function* reserve(){ return {ok:false}; }',
  'export async function* reserve(){ return {ok:false}; }'
]) {
  test(`${declaration}: wrapper return is not guaranteed to be a reservation record`, () => {
    const result = analyze(withCaller(declaration, ' const result=reserve();\n if(!result.ok) return false;\n return true;'));
    assert.equal(result.functions.find(fn => fn.name === 'reserve').returns.type, 'unknown');
    assert.equal(result.connections[0].projected, false);
    assert.equal(result.connections[0].provided, 'unknown');
  });
}

for (const expression of [
  '{ok:false, ok:"later"}',
  '{ok:false, ...other}',
  '{ok:false, [key]:"later"}',
  '{ok:false, get ok(){return "later";}}'
]) {
  test(`later property overrides are not boolean guarantees: ${expression}`, () => {
    const result = analyze(withCaller(`export function reserve(){ return ${expression}; }`, ' const result=reserve();\n if(!result.ok) return false;\n return true;'));
    const provided = result.functions.find(fn => fn.name === 'reserve').returns;
    assert.equal(provided.type, 'record', 'the object shape is known but the ok boolean is not');
    assert.equal(result.connections[0].projected, false);
  });
}

test('an explicit final boolean ok after a spread still establishes the property', () => {
  const result = analyze(withCaller('export function reserve(){ return {...other, ok:false}; }', ' const result=reserve();\n if(!result.ok) return false;\n return true;'));
  assert.equal(result.connections[0].projected, true);
});

test('too many files are rejected without parsing any of them', () => {
  const files = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`f${index}.js`, 'export function f(){return true;}']));
  const { result, parses } = trackedAnalysis(files);
  assert.equal(parses, 0);
  assert.equal(result.errors.some(error => error.kind === 'limit'), true);
  assert.deepEqual(result.functions, []);
  assert.deepEqual(result.connections, []);
});

test('an oversized file is not re-parsed after compiler rejection', () => {
  const { result, parses } = trackedAnalysis({ 'large.js': '// ' + 'x'.repeat(150001) });
  assert.equal(parses, 0);
  assert.equal(result.errors.some(error => error.kind === 'limit'), true);
});

test('the total character budget prevents parsing all files', () => {
  const files = Object.fromEntries([1, 2, 3].map(index => [`f${index}.js`, '// ' + 'x'.repeat(110000)]));
  const { result, parses } = trackedAnalysis(files);
  assert.equal(parses, 0);
  assert.equal(result.errors.some(error => error.kind === 'limit'), true);
});

test('a rejected AST depth is not walked or parsed a second time', () => {
  const code = 'export function f(){' + 'if(true){'.repeat(200) + 'return true;' + '}'.repeat(200) + '}';
  const { result, parses } = trackedAnalysis({ 'deep.js': code });
  assert.equal(parses, 1);
  assert.equal(result.errors.some(error => error.kind === 'limit'), true);
  assert.deepEqual(result.functions, []);
});

test('a file-specific syntax error retains the accepted file without extra parsing', () => {
  const { result, parses } = trackedAnalysis({ 'bad.js': 'export function', 'good.js': 'export function good(){return true;}' });
  assert.equal(parses, 2);
  assert.deepEqual(result.functions.map(fn => fn.name), ['good']);
  assert.equal(result.errors[0].kind, 'syntax');
});

test('invalid input returns diagnostics without attempting Object.keys or parsing', () => {
  const { result, parses } = trackedAnalysis(null);
  assert.equal(parses, 0);
  assert.deepEqual(result.functions, []);
  assert.equal(result.errors[0].kind, 'input');
});

test('an object existence check is an observation, not an inferred boolean contract or anomaly', () => {
  const files = withCaller('export function reserve(){ return {ticket:42}; }', ' const cached=reserve();\n if(!cached) return null;\n return cached;');
  const connection = analyze(files).connections[0];
  assert.equal(connection.expected, 'unknown');
  assert.equal(connection.usageKind, 'truthiness');
  assert.deepEqual(connection.providedShape, {kind:'object',booleanProperties:[]});
  assert.equal(connection.review, false);
  assert.equal(connection.questionKind, 'handoff');
  assert.equal(connection.correctness, 'unknown');
  assert.match(connection.observation, /値全体.*真偽判定/);
});

test('nullable records retain unknown shape rather than fabricating a record guarantee', () => {
  const result = analyze(withCaller('export function reserve(flag){ if(flag) return null; return {ok:true}; }', ' const result=reserve();\n if(!result) return null;\n return result;'));
  assert.equal(result.connections[0].providedShape.kind, 'unknown');
  assert.equal(result.connections[0].usageKind, 'truthiness');
  assert.equal(result.connections[0].review, false);
});

test('property use and opposite guard directions do not establish correctness', () => {
  for (const condition of ['result.ok','!result.ok']) {
    const result = analyze(withCaller('export function reserve(){ return {ok:false}; }', ` const result=reserve();\n if(${condition}) return true;\n return false;`));
    const connection = result.connections[0];
    assert.equal(connection.usageKind, 'property-truthiness');
    assert.equal(connection.projected, true, 'this flag only observes the projection');
    assert.equal(connection.usageNegated, condition.startsWith('!'));
    assert.equal(connection.expected, 'unknown');
    assert.equal(connection.correctness, 'unknown');
    assert.equal(connection.review, false);
  }
});

for (const [name,body,reason] of [
  ['reassignment',' let result=reserve(); result=false; if(!result) return false;','binding-or-property-reassigned'],
  ['destructuring assignment',' let result=reserve(); ({value:result}=other); if(!result) return false;','binding-or-property-reassigned'],
  ['update',' let result=reserve(); result++; if(!result) return false;','binding-or-property-reassigned'],
  ['property mutation',' const result=reserve(); result.ok=true; if(!result.ok) return false;','binding-or-property-reassigned'],
  ['nested shadow',' const result=reserve(); if(other){const result=false; if(!result) return false;}','binding-shadowed'],
  ['catch shadow',' const result=reserve(); try{task();}catch(result){if(!result) return false;}','binding-shadowed'],
  ['out of scope local',' if(other){const result=reserve();} if(!result) return false;','no-direct-local-binding'],
  ['alias',' const result=reserve(); const alias=result; if(!alias.ok) return false;','no-supported-if-use'],
  ['equality guard',' const result=reserve(); if(result.ok === true) return true;','no-supported-if-use']
]) {
  test(`usage remains unknown for ${name}`, () => {
    const result = analyze(withCaller('export function reserve(){ return {ok:false}; }', body + '\n return true;'));
    const connection = result.connections[0];
    assert.equal(connection.usageKind, 'unknown');
    assert.equal(connection.usageReason, reason);
    assert.equal(connection.useSource, null);
    assert.equal(connection.expected, 'unknown');
    assert.equal(connection.review, false);
  });
}

test('several distinct uses remain visible without selecting an invented single contract', () => {
  const result = analyze(withCaller('export function reserve(){ return {ok:false}; }', ' const result=reserve();\n if(!result) return null;\n if(result.ok) return true;\n return false;'));
  const connection = result.connections[0];
  assert.equal(connection.usageKind, 'unknown');
  assert.equal(connection.usageReason, 'multiple-distinct-if-uses');
  assert.equal(connection.uses.length, 2);
  assert.equal(connection.useSources.length, 2);
  assert.equal(connection.expected, 'unknown');
});

test('exact call, use and all return ranges refer to their own source on the same line', () => {
  const files = withCaller('export function reserve(flag){ if(flag) return {ok:true}; return {ok:false}; }', ' const result=reserve(true); if(!result.ok) return false; return true;');
  const result = analyze(files), connection = result.connections[0];
  const excerpt = at => files[at.file].slice(at.start,at.end);
  assert.equal(excerpt(connection.callSource), 'reserve(true)');
  assert.equal(excerpt(connection.useSource), '!result.ok');
  assert.deepEqual(connection.returnSources.map(excerpt), ['return {ok:true};','return {ok:false};']);
  assert.equal(connection.callSource.startLine, connection.useSource.startLine);
  assert.notEqual(connection.callSource.startColumn, connection.useSource.startColumn);
  assert.equal(connection.callAst.start, connection.callSource.start);
  assert.equal(result.functions.find(fn => fn.name === 'checkout').blocks.some(block => block.id === connection.sourceBlockId), true);
});

test('concise arrow returns have exact expression evidence and no fabricated return statement', () => {
  const result = analyze(withCaller('export const reserve=()=>({ok:false});', ' const result=reserve(); if(!result.ok) return false; return true;'));
  const connection = result.connections[0];
  assert.deepEqual(connection.providedShape, {kind:'object',booleanProperties:['ok']});
  const at = connection.returnSources[0];
  assert.equal(result.files[at.file].slice(at.start,at.end), '{ok:false}');
});

test('repeated default-argument calls have distinct exact source locations and IDs', () => {
  const result = analyze({'api.js':'export function quote(){return 1;}','main.js':'import {quote} from "./api.js"; export function checkout(price=quote){ const first=price(); const second=price(); return second; }'});
  const connections = result.connections.filter(item => item.resolution === 'default-argument');
  assert.equal(connections.length, 2);
  assert.equal(new Set(connections.map(item => item.id)).size, 2);
  assert.equal(new Set(connections.map(item => item.callSource.start)).size, 2);
});

function quoteBlocks(code, extra = {}) {
  return analyze({'pricing.js':code,...extra}).functions.find(fn => fn.name === 'quote').blocks;
}

test('block identity is invariant to comments, whitespace, line moves and unrelated files', () => {
  const before = quoteBlocks('export function quote(items){const amount=items.length; return amount * 2;}');
  const after = quoteBlocks('// heading\n\nexport function quote ( items ) {\n // note\n const amount = items.length ;\n\n return amount * 2 ;\n}', {'other.js':'export function unrelated(){return true;}'});
  assert.deepEqual(after.map(block => [block.id,block.fingerprint,block.canonical]), before.map(block => [block.id,block.fingerprint,block.canonical]));
  assert.notEqual(after[0].source.startLine, before[0].source.startLine);
});

test('inserting a declaration leaves every unchanged statement ID intact', () => {
  const before = quoteBlocks('export function quote(items){const amount=items.length; const total=amount*2; return total;}');
  const after = quoteBlocks('export function quote(items){const debug=true; const amount=items.length; const total=amount*2; return total;}');
  assert.deepEqual(after.slice(1).map(block => block.id), before.map(block => block.id));
  assert.equal(after[1].statementIndex, before[0].statementIndex + 1);
});

test('editing one operator changes only that statement fingerprint and ID', () => {
  const before = quoteBlocks('export function quote(items){const amount=items.length; const total=amount+2; return total;}');
  const after = quoteBlocks('export function quote(items){const amount=items.length; const total=amount-2; return total;}');
  assert.equal(before[0].id, after[0].id);
  assert.notEqual(before[1].id, after[1].id);
  assert.equal(before[2].id, after[2].id);
});

test('duplicate statements have distinct occurrence IDs and explicitly ambiguous identity', () => {
  const before = quoteBlocks('export function quote(){tick(); tick(); return 1;}');
  const after = quoteBlocks('export function quote(){const unrelated=true; tick(); tick(); return 1;}');
  assert.notEqual(before[0].id, before[1].id);
  assert.deepEqual(after.slice(1).map(block => block.id), before.map(block => block.id));
  assert.equal(before[0].identityAmbiguous, true);
  assert.equal(before[1].identityAmbiguous, true);
  assert.equal(before[2].identityAmbiguous, false);
});

test('empty statements do not create musical blocks and nested callback edits remain local', () => {
  const before = quoteBlocks('export function quote(items){; const total=items.reduce((sum,item)=>sum+item.price,0); return total;}');
  const after = quoteBlocks('export function quote(items){;; const total=items.reduce((sum,item)=>sum-item.price,0); return total;}');
  assert.equal(before.length, 2);
  assert.notEqual(before[0].id, after[0].id);
  assert.equal(before[1].id, after[1].id);
});

test('structural role metadata does not assign authorship, business role or quality', () => {
  const result = analyze({'math.js':'export function area(width,height){return width*height;}'});
  const metadata = result.functions[0].roleMetadata;
  assert.equal(metadata.basis, 'syntax-heuristic');
  assert.equal(metadata.label, '算術または reduce');
  assert.equal(metadata.businessRole, null);
  assert.equal(metadata.author, null);
  assert.equal(metadata.quality, null);
});

test('local investigation quotes exact evidence and leaves contract and execution unverified', () => {
  const result = analyze(fixtures.stages.draft.files);
  const connection = result.connections.find(item => item.calleeName === 'reserve');
  const snapshot = JSON.stringify(result);
  const report = analyzer.investigate(result, connection.id);
  assert.equal(report.facts.length, 1 + connection.returnSources.length + connection.uses.length);
  assert.equal(report.question, connection.question);
  assert.match(report.unknowns.join(' '), /契約.*未確認/);
  assert.match(report.unknowns.join(' '), /実行結果.*確認していません/);
  assert.equal(report.nextSources.length >= 3, true);
  for (const fact of report.facts) {
    assert.equal(typeof result.files[fact.source.file], 'string');
    assert.equal(fact.source.end > fact.source.start, true);
  }
  assert.equal(JSON.stringify(result), snapshot, 'the local report does not mutate the model');
  assert.equal(analyzer.investigate(result, 'missing').facts.length, 0);
});
