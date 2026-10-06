const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const analyzer = require('../src/story-analyzer.js');
const compiler = require('../src/vendor/score-compiler.js');
const parser = require('../src/vendor/acorn.js');
const score = require('../src/score-generator.js');
const critique = require('../src/code-critique.js');
const src = path.join(__dirname, '../src');
const fixtures = JSON.parse(fs.readFileSync(path.join(src, 'story-fixtures.json'), 'utf8'));
const scenes = JSON.parse(fs.readFileSync(path.join(src, 'review-scenes.json'), 'utf8')).scenes;

// This harness verifies the real app's event handlers and playback state, not
// browser rendering, audible quality or Web Audio scheduling. The only code
// evaluated is the app itself; supplied JavaScript remains parser input.
async function createApp() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const attributes = new Map(), classes = new Set();
      elements.set(id, {
        id, value:id === 'volume' ? '0.35' : '', textContent:'', innerHTML:'', checked:false,
        hidden:false, disabled:false, dataset:{}, scrollTop:0, offsetTop:0,
        classList:{
          toggle(name, enabled) { if (enabled ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
          add(name) { classes.add(name); }, remove(name) { classes.delete(name); }
        },
        style:{setProperty() {}},
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        removeAttribute(name) { attributes.delete(name); },
        addEventListener() {}, querySelector() { return null; },
        scrollIntoView() {}, focus() {}, click() {}, showModal() {}, close() {}
      });
    }
    return elements.get(id);
  }
  class MockPlayer {
    constructor() { this.plays = []; this.current = null; }
    stop() { this.current = null; }
    setVolume(value) { this.volume = value; }
    async play(events, options) {
      this.current = {events, options};
      this.plays.push(this.current);
    }
    tick(seconds) {
      assert.ok(this.current, 'a playback must be active before a mock tick');
      const active = this.current.events.filter(event => event.at <= seconds && seconds < event.at + event.duration);
      this.current.options.onTick(seconds, active.at(-1), active);
    }
    finish() {
      assert.ok(this.current, 'a playback must be active before ending it');
      const record = this.current;
      this.current = null;
      record.options.onEnd();
    }
  }
  const loggedErrors = [];
  const scope = {
    console:{log() {}, warn() {}, error(...args) { loggedErrors.push(args); }},
    ScorePlayer:MockPlayer,
    StoryAnalyzer:{...analyzer, analyze:files => analyzer.analyze(files, {parser, compiler})},
    StoryScore:score,
    StoryCritique:critique,
    TextEncoder, crypto:webcrypto,
    localStorage:{getItem() { return null; }, setItem() {}},
    document:{getElementById:element, querySelector:element, querySelectorAll() { return []; }, addEventListener() {}},
    window:{addEventListener() {}},
    fetch:async url => {
      assert.ok(['./story-fixtures.json','./review-scenes.json'].includes(url), 'only bundled sample fetches are mocked');
      return {ok:true, json:async () => JSON.parse(fs.readFileSync(path.join(src, url.slice(2)), 'utf8'))};
    }
  };
  const appSource = fs.readFileSync(path.join(src, 'story-app.js'), 'utf8');
  const marker = '})().catch(error=>';
  assert.equal(appSource.split(marker).length, 2, 'the app bootstrap must have one test injection point');
  // Expose closure references only in this in-memory test copy; production
  // source does not gain a debug API or a dependency on this harness.
  const instrumented = appSource.replace(marker,
    'globalThis.__appTest = {state, player, apply, setConnection, switchTake, playablePair, currentFn, startAudition, playCurrent, eventRange, jump, paint};\n' + marker);
  vm.createContext(scope);
  await vm.runInContext(instrumented, scope, {filename:'story-app.js', timeout:5000});
  assert.deepEqual(loggedErrors, [], 'the app must initialize without a caught bootstrap error');
  assert.ok(scope.__appTest);
  return {app:scope.__appTest, element};
}

async function deliveryScene(app) {
  const scene = scenes.find(item => item.id === 'delivery-route');
  await app.apply(scene.after, {before:scene.before});
}

test('paired audition pauses and resumes the same take before advancing once to the other take', async () => {
  const {app, element} = await createApp();
  await deliveryScene(app);
  app.startAudition();
  assert.equal(app.state.before, true);
  assert.equal(app.state.queue.length, 1);
  const beforeId = app.state.selection.beforeId;
  assert.ok(app.player.current.events.every(event => event.connectionId === beforeId));
  const at = app.state.range.start + 1.1;
  app.player.tick(at);
  element('play').onclick();
  assert.equal(app.state.playing, false);
  assert.equal(app.state.paused, true);
  assert.equal(app.state.queue.length, 1, 'pausing must preserve the queued after take');
  element('play').onclick();
  assert.equal(app.player.current.options.startSec, at);
  assert.equal(app.state.before, true);
  app.player.finish();
  assert.equal(app.state.before, false);
  assert.equal(app.state.queue.length, 0);
  assert.ok(app.player.current.events.every(event => event.connectionId === app.state.selection.afterId));
  app.player.finish();
  assert.equal(app.state.playing, false);
  assert.equal(app.state.before, false);
});

test('unmatched callsites keep their explicit null counterpart even when compiler edge IDs collide', async () => {
  const {app, element} = await createApp();
  const prefix = 'export function a(){return true;} export function b(){return true;} export function work(){';
  await app.apply({'main.js':prefix + 'b(); b();}'}, {before:{'main.js':prefix + 'a(); a();}'}});
  assert.ok(app.state.comparison.relationPairs.every(pair => pair.reason === 'unmatched'));
  app.setConnection(app.state.model.connections[0].id, {before:false});
  assert.equal(app.state.selection.beforeId, null);
  assert.equal(app.playablePair(), false);
  const selected = app.state.selection.afterId, plays = app.player.plays.length;
  element('take-before').onclick();
  assert.equal(app.state.before, false, 'a missing counterpart must not select another relation');
  assert.equal(app.state.selection.afterId, selected);
  assert.equal(app.player.plays.length, plays, 'there is no corresponding take to play');
});

test('seeking preserves the requested position while paused and while playing', async () => {
  const {app, element} = await createApp();
  await deliveryScene(app);
  const start = app.state.range.start;
  app.state.position = start + 1;
  element('seek').value = '3';
  element('seek').oninput();
  assert.equal(app.state.position, start + 3);
  app.startAudition({pair:false});
  app.player.tick(start + 1);
  element('seek').value = '3.5';
  element('seek').oninput();
  assert.equal(app.state.position, start + 3.5);
  assert.equal(app.player.current.options.startSec, start + 3.5);
});

test('recorded-failure audition retains its stop boundary through pause, resume and seek', async () => {
  const {app, element} = await createApp();
  await app.apply(fixtures.stages.draft.files, {before:fixtures.stages.base.files});
  element('evidence-detail').onclick({target:{id:'listen-failure'}});
  const end = app.player.current.options.duration, rangeEnd = app.state.range.end;
  assert.ok(end < rangeEnd, 'recorded failure playback must have a shorter explicit endpoint');
  app.player.tick(app.state.range.start + 1);
  element('play').onclick();
  element('play').onclick();
  assert.equal(app.player.current.options.duration, end);
  element('seek').value = '2';
  element('seek').oninput();
  assert.equal(app.player.current.options.duration, end);
  element('seek').value = String(rangeEnd - app.state.range.start);
  element('seek').oninput();
  assert.equal(app.player.current.options.duration, end, 'seeking cannot bypass the selected failure endpoint');
  app.player.finish();
  assert.equal(app.state.playing, false);
  assert.equal(app.state.queue.length, 0);
  assert.match(element('status').textContent, /失敗.*中断/);
});

test('selecting a line outside all functions clears the old playback target', async () => {
  const {app, element} = await createApp();
  await app.apply({'calc.js':'export function quote(){return 1;}','constants.js':'export const LIMIT=3;'});
  assert.equal(app.currentFn().name, 'quote');
  app.jump('constants.js', 1);
  assert.equal(app.state.file, 'constants.js');
  assert.equal(app.state.line, 1);
  assert.equal(app.state.selection, null);
  assert.equal(app.currentFn(), undefined);
  assert.equal(element('listen-selection').disabled, true);
  assert.equal(element('play').disabled, true, 'the selected-line transport must not play a different file');
  assert.equal(element('listen-all').disabled, false, 'explicit whole-program playback remains available');
});

test('a syntax error survives the reanalyze handler instead of becoming a success message', async () => {
  const {app, element} = await createApp();
  await app.apply({'calc.js':'export function quote(){return 1;}'});
  element('edit-toggle').onclick();
  element('editor').value = 'export function {';
  await element('reanalyze').onclick();
  const errors = app.state.model.errors.filter(error => error.kind === 'syntax');
  assert.equal(errors.length, 1);
  assert.ok(element('status').textContent.includes(errors[0].message));
  assert.doesNotMatch(element('status').textContent, /演奏を組み直しました/);
  assert.equal(element('play').disabled, true);
});

test('a syntax error survives the file upload handler', async () => {
  const {app, element} = await createApp();
  const code = 'export function {';
  await element('file-input').onchange({target:{value:'bad.js',files:[{name:'bad.js',size:code.length,webkitRelativePath:'',text:async () => code}]}});
  const errors = app.state.model.errors.filter(error => error.kind === 'syntax');
  assert.equal(errors.length, 1);
  assert.ok(element('status').textContent.includes(errors[0].message));
  assert.equal(element('play').disabled, true);
});

test('editing the selected file into invalid code cannot replay or seek into another valid file', async () => {
  const {app, element} = await createApp();
  await app.apply({
    'calc.js':'export function quote(){return 1;}',
    'other.js':'export function unrelated(){return 2;}'
  });
  app.jump('calc.js', 1);
  element('edit-toggle').onclick();
  element('editor').value = 'export function {';
  await element('reanalyze').onclick();
  assert.equal(app.state.file, 'calc.js');
  assert.equal(app.state.model.functions.length, 1);
  assert.equal(app.state.model.functions[0].name, 'unrelated');
  assert.equal(app.state.selection, null, 'an invalid edited file must not inherit the other file target');
  assert.equal(element('play').disabled, true);
  assert.equal(element('replay').disabled, true);
  assert.equal(element('seek').disabled, true);
  assert.equal(element('listen-all').disabled, false, 'valid code remains available through explicit full playback');
  const count = app.player.plays.length;
  // Invoke the handlers directly as an additional guard check, even though a
  // real browser will suppress interactions with these disabled controls.
  element('replay').onclick();
  element('seek').value = '1';
  element('seek').oninput();
  await app.playCurrent();
  assert.equal(app.player.plays.length, count);
  assert.equal(app.state.playing, false);
});

test('looping a whole-program audition repeats the full take, not the last selected relation', async () => {
  const {app, element} = await createApp();
  await deliveryScene(app);
  element('loop').checked = true;
  element('listen-all').onclick();
  const duration = app.player.current.options.duration, before = app.state.before;
  assert.equal(app.player.current.options.startSec, 0);
  const lastEvent = app.player.current.events.at(-1);
  app.player.tick(lastEvent.at + Math.min(lastEvent.duration / 2, 0.05));
  app.player.finish();
  assert.equal(app.state.full, true);
  assert.equal(app.state.before, before);
  assert.equal(app.player.current.options.startSec, 0);
  assert.equal(app.player.current.options.duration, duration);
  assert.equal(app.state.range.start, 0);
  assert.equal(app.state.range.end, duration);
});

test('loading an empty analysis cancels old playback callbacks and stale comparison state', async () => {
  const {app, element} = await createApp();
  await deliveryScene(app);
  app.startAudition();
  const old = app.player.current, plays = app.player.plays.length;
  await app.apply({});
  old.options.onTick(100, null, []);
  old.options.onEnd();
  assert.equal(app.state.model.functions.length, 0);
  assert.equal(app.state.selection, null);
  assert.equal(app.state.beforeModel, null);
  assert.equal(app.state.playing, false);
  assert.equal(app.state.position, 0);
  assert.equal(app.state.queue.length, 0);
  assert.equal(app.player.plays.length, plays, 'an obsolete onEnd must not start a queued old take');
  assert.equal(element('play').disabled, true);
  assert.equal(element('listen-all').disabled, true);
});

test('connection display uses the generator exact active return range', async () => {
  const {app} = await createApp();
  await app.apply(fixtures.stages.aligned.files);
  const quote = app.state.model.connections.find(connection => connection.calleeName === 'quote');
  const event = app.state.score.events.find(item => item.connectionId === quote.id && item.phase === 'callee');
  assert.ok(event.source.active);
  assert.equal(app.eventRange(event), event.source.active);
  assert.ok(event.source.active.startLine >= quote.calleeSource.startLine);
  assert.ok(event.source.active.endLine <= quote.calleeSource.endLine);
});

for (const before of [true, false]) {
  test(`looping an explicitly selected ${before ? 'before' : 'after'} take stays on that take`, async () => {
    const {app, element} = await createApp();
    await deliveryScene(app);
    element('loop').checked = true;
    element(before ? 'take-before' : 'take-after').onclick();
    const start = app.player.current.options.startSec, end = app.player.current.options.duration;
    assert.equal(app.state.before, before);
    app.player.finish();
    assert.equal(app.state.before, before, 'a single-take loop must not restart the paired audition');
    assert.equal(app.state.queue.length, 0);
    assert.equal(app.player.current.options.startSec, start);
    assert.equal(app.player.current.options.duration, end);
    app.player.finish();
    assert.equal(app.state.before, before, 'the second loop must also remain a single take');
  });
}

test('looping a voice-chip audition stays with its current take and function', async () => {
  const {app, element} = await createApp();
  await deliveryScene(app);
  const voice = app.state.model.functions.find(fn => fn.name === 'planExpress');
  element('loop').checked = true;
  element('handoff').onclick({target:{closest:() => ({dataset:{voice:voice.id}})}});
  assert.equal(app.state.selection.kind, 'function');
  assert.equal(app.state.before, false);
  const start = app.player.current.options.startSec, end = app.player.current.options.duration;
  app.player.finish();
  assert.equal(app.state.before, false);
  assert.equal(app.currentFn().id, voice.id);
  assert.equal(app.state.queue.length, 0);
  assert.equal(app.player.current.options.startSec, start);
  assert.equal(app.player.current.options.duration, end);
});

test('seeking during the before take retains the queued after take', async () => {
  const {app, element} = await createApp();
  await deliveryScene(app);
  app.startAudition();
  assert.equal(app.state.before, true);
  app.player.tick(app.state.range.start + 1);
  element('seek').value = '3';
  element('seek').oninput();
  assert.equal(app.state.queue.length, 1, 'a seek is not cancellation of the paired audition');
  assert.equal(app.player.current.options.startSec, app.state.range.start + 3);
  app.player.finish();
  assert.equal(app.state.before, false);
  assert.equal(app.state.queue.length, 0);
  assert.ok(app.player.current.events.every(event => event.connectionId === app.state.selection.afterId));
});

test('an explicitly paired loop continues alternating before and after', async () => {
  const {app, element} = await createApp();
  await deliveryScene(app);
  element('loop').checked = true;
  app.startAudition();
  assert.equal(app.state.before, true);
  app.player.finish();
  assert.equal(app.state.before, false);
  app.player.finish();
  assert.equal(app.state.before, true);
  assert.equal(app.state.queue.length, 1);
  app.player.finish();
  assert.equal(app.state.before, false);
});

test('initial selection prioritizes a changed target relation over the changed caller function', async () => {
  const {app} = await createApp();
  await deliveryScene(app);
  assert.equal(app.state.selection.kind, 'relation');
  const before = app.state.beforeModel.connections.find(connection => connection.id === app.state.selection.beforeId);
  const after = app.state.model.connections.find(connection => connection.id === app.state.selection.afterId);
  assert.equal(before.calleeName, 'planStandard');
  assert.equal(after.calleeName, 'planExpress');
});

test('initial selection chooses the changed function when call targets are unchanged', async () => {
  const {app} = await createApp();
  const scene = scenes.find(item => item.id === 'session-total');
  await app.apply(scene.after, {before:scene.before});
  assert.equal(app.state.selection.kind, 'function');
  assert.equal(app.currentFn().name, 'totalMinutes');
  app.startAudition();
  assert.ok(app.player.current.events.every(event => event.part === app.state.selection.beforeId));
  app.player.finish();
  assert.equal(app.state.before, false);
  assert.ok(app.player.current.events.every(event => event.part === app.state.selection.afterId));
});
