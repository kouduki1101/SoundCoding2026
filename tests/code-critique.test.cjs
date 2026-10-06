const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const critique = require('../src/code-critique.js');
const analyzer = require('../src/story-analyzer.js');
const parser = require('../src/vendor/acorn.js');
const compiler = require('../src/vendor/score-compiler.js');
const analyze = files => analyzer.analyze(files, {parser,compiler});
const one = source => analyze({'code.js':source});
function selected(model, name) {
  const fn = model.functions.find(item => item.name === name);
  return {fn,connection:model.connections.find(item => item.source === fn.id)};
}
function review(model, name, oldModel = null) {
  const current = selected(model,name), old = oldModel && selected(oldModel,name);
  return critique.review(model,current.fn.id,current.connection?.id,{previousModel:oldModel,previousFunctionId:old?.fn.id,previousConnectionId:old?.connection?.id});
}
function validLinks(model, result) {
  assert.ok(result.sources.length, 'specific observations need source evidence');
  for (const item of result.sources) {
    assert.equal(typeof item.label, 'string');
    const code = model.files[item.source.file];
    assert.equal(typeof code, 'string');
    assert.ok(item.source.startLine >= 1);
    assert.ok(item.source.endLine <= code.split('\n').length);
    assert.ok(code.slice(item.source.start,item.source.end).length > 0);
  }
}

test('a one-return call is described as argument passing and delegation before any music metaphor', () => {
  const model = one('export function scale(x){return x*2;}\nexport function relay(value){return scale(value); }');
  const result = review(model,'relay');
  assert.match(result.prose, /return scale\(value\)/);
  assert.match(result.prose, /引数.*value.*そのまま返/);
  assert.doesNotMatch(result.prose, /ピアノ|旋律|主題|和音/);
  assert.match(result.relationship, /relay.*scale/);
  assert.match(result.musicalMetaphor, /小品/);
  validLinks(model,result);
});

test('a direct record exposes actual fields without claiming the caller contract is satisfied', () => {
  const model=one('export const detail = value => ({category:"fixed", itemId:value.id, days:1});');
  const result=review(model,'detail');
  assert.match(result.prose,/category、itemId、days/);
  assert.match(result.heading,/返す情報の形/);
  assert.doesNotMatch(result.prose,/正しい|互換|高品質/);
  validLinks(model,result);
});

test('a generic loop quotes its update without assigning business quality or pretending to synthesize rock', () => {
  const model = one('export function collect(rows){let out=0; for(const row of rows){out+=row.size;} return out;}');
  const result = review(model,'collect');
  assert.match(result.prose, /out\+=row.size/);
  assert.match(result.musicalMetaphor, /ロックのリフ.*書き味/);
  assert.doesNotMatch(result.prose + result.musicalMetaphor, /高品質|優秀|ロックを生成|ロックとして再生|料金/);
  validLinks(model,result);
});

test('reduce has its own code style critique rather than being misclassified as delegation', () => {
  const model = one('export function collect(rows){return rows.reduce((acc,row)=>acc+row.size,0);}');
  const result = review(model,'collect');
  assert.match(result.prose, /rows.reduce/);
  assert.match(result.prose, /コールバック/);
  assert.match(result.musicalMetaphor, /レガート/);
  assert.doesNotMatch(result.heading, /委ねる/);
  validLinks(model,result);
});

test('a named reduce callback does not invent what the reduction calculates', () => {
  const model = one('export function collect(rows,transform,seed){return rows.reduce(transform,seed);}');
  const result = review(model,'collect');
  assert.match(result.prose, /rows.reduce\(transform,seed\)/);
  assert.match(result.prose, /何を算出するかは断定できません/);
  assert.doesNotMatch(result.prose, /料金|合計|金額|平均/);
});

test('branches quote the actual condition and ask about its intent', () => {
  const model = one('export function choose(flag){if(flag.ready)return 1; return 0;}');
  const result = review(model,'choose');
  assert.match(result.prose, /flag.ready/);
  assert.match(result.question, /区別したい状態/);
  validLinks(model,result);
});

function handoff(provider, condition = '!result') {
  return one(`export function acquire(){${provider}}\nexport function consume(){const result=acquire(); if(${condition})return null; return result;}`);
}

test('a boolean-to-record handoff explains actual truthiness while leaving intent unconfirmed', () => {
  const before = handoff('return false;'), after = handoff('return {ok:false,token:null};');
  const result = review(after,'consume',before);
  assert.match(result.prose, /ok:false/);
  assert.match(result.prose, /!result.*false/);
  assert.match(result.prose, /ok の違いでこの分岐を選べません/);
  assert.equal(result.heading, '返事は変わったが、受け取り方はそのまま');
  assert.match(result.relationship, /変更前.*boolean.*現在.*ok/);
  assert.match(result.question, /ok の値.*存在/);
  assert.match(result.soundStatus, /まだ表しません/);
  assert.doesNotMatch(result.prose, /テストで失敗|実行した|バグです|修正すべき/);
  validLinks(after,result);
});

test('positive truthiness guards are described as true rather than as negation', () => {
  const result = review(handoff('return {ok:false};','result'),'consume');
  assert.match(result.prose, /真偽判定は true/);
  assert.doesNotMatch(result.prose, /「result」は false/);
});

test('an all-true ok return does not invent a written false return', () => {
  const result = review(handoff('return {ok:true};'),'consume');
  assert.match(result.prose, /仮に ok が false/);
  assert.doesNotMatch(result.prose, /ok:false を返して/);
});

test('async return operands are not mistaken for direct record results', () => {
  const model = one('export async function acquire(){return {ok:false};}\nexport function consume(){const result=acquire();if(!result)return null;return result;}');
  const result = review(model,'consume');
  assert.doesNotMatch(result.prose, /オブジェクト自体は truthy/);
  assert.doesNotMatch(result.relationship, /現在は \{ ok/);
});

test('a nullable object existence guard is not called an incompatible contract', () => {
  const model = one('export function lookup(flag){if(flag)return {online:false};return null;}\nexport function show(flag){const item=lookup(flag);if(!item)return "missing";return item;}');
  const result = review(model,'show');
  assert.match(result.prose, /object と null/);
  assert.match(result.prose, /!item/);
  assert.match(result.question, /null.*分岐の向き/);
  assert.doesNotMatch(result.prose, /バグ|不一致|破綻/);
  assert.equal(result.soundStatus, '');
  validLinks(model,result);
});

test('reading ok is a concrete change of use, not a guarantee of a correct fix', () => {
  const before = handoff('return {ok:false};'), after = handoff('return {ok:false};','!result.ok');
  const result = review(after,'consume',before);
  assert.match(result.prose, /!result.ok/);
  assert.match(result.question, /分岐の向き.*仕様/);
  assert.match(result.soundStatus, /まだ表しません/);
});

test('a target change names both peers and raw return-field changes without inferring business meaning', () => {
  const prefix = 'export function slow(parcel){return {service:"standard",parcelId:parcel.id,days:3};}\nexport function quick(parcel){return {service:"express",parcelId:parcel.id,days:1};}\n';
  const before = one(prefix + 'export function prepare(parcel){return slow(parcel);}');
  const after = one(prefix + 'export function prepare(parcel){return quick(parcel);}');
  const result = review(after,'prepare',before);
  assert.match(result.relationship, /slow から quick/);
  assert.match(result.relationship, /文の形は同じ/);
  assert.match(result.relationship, /service: "standard" → "express"/);
  assert.match(result.relationship, /days: 3 → 1/);
  assert.doesNotMatch(result.relationship, /速くなる|安全|改善|品質/);
  assert.equal(result.soundStatus, '');
  validLinks(after,result);
});

test('changing an argument as well as the peer does not claim an unchanged call frame', () => {
  const prefix = 'export function a(x){return x;} export function b(x){return x;} ';
  const before = one(prefix + 'export function f(x){return a(x);}');
  const after = one(prefix + 'export function f(x){return b(x+1);}');
  const result = review(after,'f',before);
  assert.match(result.relationship, /文にも差があります/);
  assert.doesNotMatch(result.relationship, /文の形は同じ/);
});

test('literal spreads and multiple differing return values are not invented as fixed output differences', () => {
  const prefix = 'export function a(x){if(x)return {n:1};return {n:2};} export function b(x){return {n:3,...x};} ';
  const before = one(prefix + 'export function f(x){return a(x);}');
  const after = one(prefix + 'export function f(x){return b(x);}');
  const result = review(after,'f',before);
  assert.doesNotMatch(result.relationship, /return に書かれた値は/);
});

test('the browser UMD export and missing selection keep the complete result contract', () => {
  const scope = {};
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/code-critique.js'),'utf8'),scope);
  assert.equal(typeof scope.StoryCritique.review, 'function');
  const result = scope.StoryCritique.review({functions:[],connections:[],files:{}},'missing');
  for (const key of ['heading','prose','relationship','question','musicalMetaphor','soundStatus']) assert.equal(typeof result[key], 'string');
  assert.equal(result.sources.length, 0);
});

test('critique generation does not execute user code or mutate its source model', () => {
  const model = one('throw new Error("must not run"); export function example(){return 42;}');
  const before = JSON.stringify(model);
  const result = review(model,'example');
  assert.match(result.prose, /return 42/);
  assert.equal(JSON.stringify(model),before);
});
