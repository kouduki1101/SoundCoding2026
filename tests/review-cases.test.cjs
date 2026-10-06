const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const fixtureRoot = path.join(__dirname, '../fixtures/review-cases');
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
const source = (id, stage, file) => fs.readFileSync(path.join(fixtureRoot, id, stage, file), 'utf8');
const loadModule = (id, stage, file) => import(pathToFileURL(path.join(fixtureRoot, id, stage, file)).href);

test('public review scenes contain exactly the independently stored fixture sources', () => {
  const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/review-scenes.json'), 'utf8'));
  assert.equal(bundle.scenes.length, 3);
  for (const scene of bundle.scenes) {
    const entry = manifest.cases.find(item => item.id === scene.id);
    assert.ok(entry, scene.id);
    for (const stage of ['before', 'after']) {
      assert.deepEqual(Object.keys(scene[stage]).sort(), [...entry.files].sort());
      for (const file of entry.files) {
        assert.equal(scene[stage][file], source(scene.id, stage, file), scene.id + '/' + stage + '/' + file);
      }
    }
  }
});

for (const entry of manifest.cases) {
  test(entry.id + ': only the stated files change between revisions', () => {
    const actual = entry.files.filter(file => source(entry.id, 'before', file) !== source(entry.id, 'after', file));
    assert.deepEqual(actual.sort(), [...entry.changedFiles].sort());
  });
}

test('delivery target change intentionally produces two valid plans; both providers stay identical', async () => {
  for (const stage of ['before', 'after']) {
    const { prepareDelivery } = await loadModule('delivery-route', stage, 'src/delivery.js');
    const { planStandard, planExpress } = await loadModule('delivery-route', stage, 'src/channels.js');
    for (const id of ['parcel-7', 'parcel-42', 'parcel-88']) {
      const parcel = Object.freeze({ id });
      assert.deepEqual(planStandard(parcel), { service: 'standard', parcelId: id, dueDays: 3 });
      assert.deepEqual(planExpress(parcel), { service: 'express', parcelId: id, dueDays: 1 });
      assert.deepEqual(prepareDelivery(parcel), stage === 'before'
        ? { service: 'standard', parcelId: id, dueDays: 3 }
        : { service: 'express', parcelId: id, dueDays: 1 });
    }
  }
  const before = source('delivery-route', 'before', 'src/delivery.js').split('\n');
  const after = source('delivery-route', 'after', 'src/delivery.js').split('\n');
  assert.equal(before.length, after.length);
  assert.deepEqual(before.flatMap((line, index) => line === after[index] ? [] : [index + 1]), [4]);
});

test('reduce and for variants agree on 55 bounded input arrays without mutating inputs', async () => {
  const before = await loadModule('session-total', 'before', 'src/report.js');
  const after = await loadModule('session-total', 'after', 'src/report.js');
  let checked = 0;
  for (let length = 0; length <= 10; length++) {
    for (let seed = 0; seed < 5; seed++) {
      const sessions = Object.freeze(Array.from({ length }, (_, index) =>
        Object.freeze({ minutes: (index * 37 + seed * 17) % 241 })));
      const snapshot = JSON.stringify(sessions);
      const expected = { minutes: sessions.map(session => session.minutes).reduce((a, b) => a + b, 0), count: length };
      assert.deepEqual(before.makeReport(sessions), expected);
      assert.deepEqual(after.makeReport(sessions), expected);
      assert.equal(JSON.stringify(sessions), snapshot);
      checked++;
    }
  }
  assert.equal(checked, 55);
  assert.deepEqual(before.makeReport([{ minutes: 60 }, { minutes: 0 }, { minutes: 30 }]), { minutes: 90, count: 3 });
  assert.deepEqual(after.makeReport([{ minutes: 60 }, { minutes: 0 }, { minutes: 30 }]), { minutes: 90, count: 3 });
});

test('object presence check accepts a found offline profile and handles absence in both revisions', async () => {
  for (const stage of ['before', 'after']) {
    const { profileCaption } = await loadModule('profile-presence', stage, 'src/caption.js');
    const { findProfile } = await loadModule('profile-presence', stage, 'src/profiles.js');
    assert.equal(findProfile('local').online, false);
    assert.ok(findProfile('local'), 'an offline profile is still a found object');
    assert.equal(profileCaption('local'), 'Local profile');
    assert.equal(profileCaption('guest'), 'Guest profile');
    assert.equal(findProfile('missing'), null);
    assert.equal(profileCaption('missing'), 'Not found');
  }
});

test('dynamic dispatch uses the supplied runtime function, including one absent from source files', async () => {
  for (const stage of ['before', 'after']) {
    const { executeStep } = await loadModule('runtime-dispatch', stage, 'src/runner.js');
    const { double, offset } = await loadModule('runtime-dispatch', stage, 'src/handlers.js');
    const registry = Object.freeze({ first: double, second: offset });
    const argument = stage === 'before' ? 3 : 4;
    assert.equal(executeStep(registry, 'first', 3), argument * 2);
    assert.equal(executeStep(registry, 'second', 3), argument + 10);
    const observed = [];
    const external = Object.freeze({ supplied: value => { observed.push(value); return value * -3; } });
    assert.equal(executeStep(external, 'supplied', 3), argument * -3);
    assert.deepEqual(observed, [argument], 'the selected function receives the intended argument exactly once');
  }
});
