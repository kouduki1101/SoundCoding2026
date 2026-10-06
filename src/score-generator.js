(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StoryScore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 'story-score-2.1.0';
  var OMIT = new Set(['loc', 'start', 'end', 'range', 'raw', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens', 'parent', 'extra']);
  var SCALE = [0, 2, 4, 7, 9];
  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function digest(text) { return hash(text).toString(16).padStart(8, '0'); }
  function identityNumber(text) {
    // Avalanche the hash before choosing notes: adjacent binding names and
    // note indices must not collapse into the same few four-note rotations.
    var h = hash(text);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
  function round(value) { return Math.round(value * 1000000) / 1000000; }
  function canonicalAST(ast) {
    var stack = new WeakSet();
    function clean(value) {
      if (value === null || typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
      if (stack.has(value)) return undefined;
      stack.add(value);
      var out;
      if (Array.isArray(value)) out = value.map(clean);
      else {
        out = {};
        Object.keys(value).sort().forEach(function (key) {
          if (!OMIT.has(key)) { var item = clean(value[key]); if (item !== undefined) out[key] = item; }
        });
      }
      stack.delete(value);
      return out;
    }
    return JSON.stringify(clean(ast || null));
  }
  function isFunction(node) { return node && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].indexOf(node.type) >= 0; }
  function features(ast) {
    var f = { loops: 0, reducers: 0, maps: 0, branches: 0, branchDepth: 0, awaits: 0, returns: 0, arithmetic: 0, calls: 0 };
    var seen = new WeakSet();
    function walk(node, depth, initial) {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) { node.forEach(function (n) { walk(n, depth, false); }); return; }
      if (!initial && isFunction(node)) return;
      var t = node.type;
      if (['IfStatement', 'ConditionalExpression', 'SwitchStatement'].indexOf(t) >= 0) { f.branches++; depth++; f.branchDepth = Math.max(f.branchDepth, depth); }
      if (['ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement'].indexOf(t) >= 0) f.loops++;
      if (t === 'AwaitExpression') f.awaits++;
      if (t === 'ReturnStatement') f.returns++;
      if ((t === 'BinaryExpression' || t === 'AssignmentExpression') && ['+', '-', '*', '/', '%', '+=', '-=', '*=', '/='].indexOf(node.operator) >= 0) f.arithmetic++;
      if (t === 'CallExpression' || t === 'OptionalCallExpression') {
        f.calls++;
        var c = node.callee, p = c && (c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') && c.property;
        var method = p && (p.name || p.value);
        if (method === 'reduce' || method === 'reduceRight') f.reducers++;
        if (method === 'map' || method === 'filter' || method === 'flatMap') f.maps++;
      }
      Object.keys(node).sort().forEach(function (key) { if (!OMIT.has(key)) walk(node[key], depth, false); });
    }
    walk(ast, 0, true);
    f.style = f.reducers && !f.loops ? 'flowing' : f.loops && !f.reducers ? 'stepped' : f.loops && f.reducers ? 'mixed' : 'phrased';
    return f;
  }
  function sourceOf(fn, supplied) {
    var s = supplied || fn.source || {}, ast = fn.ast || {};
    return Object.assign({}, s, {
      functionId: fn.id, file: s.file || fn.file || null,
      startLine: s.startLine || (ast.loc && ast.loc.start.line) || null,
      endLine: s.endLine || (ast.loc && ast.loc.end.line) || null
    });
  }
  function blocksOf(fn) {
    var body = fn.ast && fn.ast.body;
    var raw = Array.isArray(fn.blocks) ? fn.blocks : body && body.type === 'BlockStatement' ? body.body.map(function (ast) { return { ast: ast }; }) : body ? [{ ast: body }] : [];
    var counts = Object.create(null);
    return raw.map(function (b, i) {
      var canonical = b.canonical || canonicalAST(b.ast), occurrence = counts[canonical] || 0;
      counts[canonical] = occurrence + 1;
      var node = b.ast || {}, source = b.source || (node.loc ? { file: fn.file || (fn.source && fn.source.file), startLine: node.loc.start.line, endLine: node.loc.end.line } : fn.source);
      return { id: b.id || fn.id + ':block:' + digest(canonical) + ':' + occurrence, functionId: fn.id, ast: node, canonical: canonical, fingerprint: b.fingerprint || digest(canonical), matchKey: canonical + ':' + occurrence, statementIndex: b.statementIndex === undefined ? i : b.statementIndex, statementKind: b.statementKind || node.type, source: sourceOf(fn, source), features: features(node) };
    });
  }
  // An auditory name, not a semantic score. The large combination of cells is
  // binding-stable; the code's structure enters in block phrasing and relations.
  function profile(fn, inherited) {
    if (!fn || typeof fn.id !== 'string' || !fn.id) throw new TypeError('Each function needs a stable, non-empty id.');
    var key = inherited && inherited.identityKey || fn.identityKey || fn.id;
    var seed = hash(key), instrument = inherited && inherited.instrument || ['piano', 'pluck', 'strings'][identityNumber(key + ':instrument') % 3];
    // A single timbral dimension differentiates some performers sharing the
    // same recorded instrument. It follows the performer, never a defect flag
    // or the role of caller / callee. It does not change the quoted melody.
    var voiceToneRatio = inherited && inherited.voiceToneRatio || [2, 4, 8, 16][identityNumber(key + ':voice-tone') % 4];
    var rootMidi = inherited && inherited.rootMidi || (instrument === 'pluck' ? 72 : 60);
    var notes = inherited && inherited.notes ? inherited.notes.slice() : [0, 1, 2, 3].map(function (i) { return rootMidi + SCALE[identityNumber(key + ':note:' + i) % SCALE.length]; });
    if (!inherited && notes.every(function (n) { return n === notes[0]; })) notes[2] = rootMidi + SCALE[(SCALE.indexOf(notes[0] - rootMidi) + 2) % SCALE.length];
    return {
      id: fn.id, name: fn.name || (fn.ast && fn.ast.id && fn.ast.id.name) || fn.id, role: fn.role || 'utility',
      identityKey: key, instrument: instrument, voiceToneRatio: voiceToneRatio, rootMidi: rootMidi, notes: notes,
      starts: [0, 0.75, 1.75, 2.75], lengths: [0.66, 0.80, 0.80, 0.95],
      features: features(fn.ast), source: sourceOf(fn), identityFingerprint: seed.toString(16).padStart(8, '0'), astFingerprint: digest(canonicalAST(fn.ast)),
      explanation: { identity: 'A stable auditory name identifies a function; it does not encode its type, quality or author.', voice: 'A stable low-pass cutoff ratio colors the performer without transposing or changing the quoted rhythm. Similar voices can still occur.', rhythm: 'Each source block supplies its own phrasing. Unchanged blocks keep their notes, timing and articulation.', relation: 'The caller quotes the callee theme, the callee answers in its own timbre, and the caller receives the same theme.' }
    };
  }
  function validateProgram(program) {
    if (!program || !Array.isArray(program.functions)) throw new TypeError('program.functions must be an array.');
    var ids = new Set();
    program.functions.forEach(function (fn) {
      if (!fn || typeof fn.id !== 'string' || !fn.id) throw new TypeError('Function id is required.');
      if (ids.has(fn.id)) throw new TypeError('Duplicate function id: ' + fn.id);
      ids.add(fn.id);
      var blocks = blocksOf(fn), blockIds = new Set();
      blocks.forEach(function (b) { if (blockIds.has(b.id)) throw new TypeError('Duplicate block id: ' + b.id); blockIds.add(b.id); });
    });
    var edges = new Set();
    (program.connections || []).forEach(function (c) { var id = connectionId(c); if (edges.has(id)) throw new TypeError('Duplicate connection id: ' + id); edges.add(id); });
  }
  function connectionId(c) { return c.id || c.source + '>' + c.target; }
  function connectionInfo(c, byId) {
    var caller = byId[c.source], callee = byId[c.target];
    if (!caller || !callee) return null;
    var call = sourceOf(caller, c.callSource || c.callerSource || (c.line ? { file: caller.file || (caller.source && caller.source.file), startLine: c.line, endLine: c.line } : caller.source));
    var use = c.useSource ? sourceOf(caller, c.useSource) : null;
    var returns = (c.returnSources || []).map(function (s) { return sourceOf(callee, s); });
    return {
      id: connectionId(c), source: c.source, target: c.target, sourceBlockId: c.sourceBlockId || null,
      expected: c.expected || 'unknown', provided: c.provided || 'unknown', providedShape: c.providedShape || 'unknown', projection: c.projection || null,
      usageKind: c.usageKind || 'unknown', observations: c.observations || [], questionKind: c.questionKind || null,
      status: 'observed', correctness: 'unknown', caller: call, callee: sourceOf(callee, c.calleeSource), call: call, use: use, returns: returns,
      explanation: 'The voices identify the two connected functions. Quotation, answer and reception are a musical view of this static relation, not proof of a runtime path, compatible contract or successful test.'
    };
  }
  function naturalSlots(program) {
    return program.functions.slice().sort(function (a, b) { return a.id.localeCompare(b.id); }).map(function (fn) { return { key: fn.id, id: fn.id, blocks: blocksOf(fn).map(function (b) { return { key: b.id, id: b.id }; }) }; });
  }
  function buildScore(program, options) {
    options = options || {};
    validateProgram(program);
    var functions = program.functions.slice().sort(function (a, b) { return a.id.localeCompare(b.id); });
    var byId = Object.create(null), profiles = Object.create(null), blockById = Object.create(null);
    functions.forEach(function (fn) {
      byId[fn.id] = fn;
      profiles[fn.id] = profile(fn, options.identityProfiles && options.identityProfiles[fn.id]);
      blocksOf(fn).forEach(function (b) { blockById[b.id] = b; });
    });
    var ids = functions.map(function (f) { return f.id; });
    var relations = (program.connections || []).map(function (c) { return connectionInfo(c, byId); }).filter(Boolean).sort(function (a, b) { return a.id.localeCompare(b.id); });
    var relationById = Object.create(null); relations.forEach(function (c) { relationById[c.id] = c; });
    var omitted = (program.connections || []).filter(function (c) { return !byId[c.source] || !byId[c.target]; }).map(function (c) { return { id: connectionId(c), source: c.source, target: c.target, reason: 'endpoint-outside-scope' }; });
    var functionSlots = options.functionSlots || naturalSlots(program);
    var relationSlots = options.relationSlots || relations.map(function (c) { return { key: c.id, id: c.id }; });
    if (options.mode === 'block' && options.focusId) {
      functionSlots = functionSlots.filter(function (s) { return s.id === options.focusId; });
      relationSlots = relationSlots.filter(function (s) { var c = relationById[s.id]; return c && (c.source === options.focusId || c.target === options.focusId); });
    } else if (options.mode === 'relation') {
      functionSlots = [];
      relationSlots = relationSlots.filter(function (s) { return options.comparisonKey ? s.key === options.comparisonKey : s.id === options.connectionId; });
    }
    var bpm = clamp(Number.isFinite(options.bpm) ? options.bpm : 100, 50, 180), beatSec = 60 / bpm;
    var events = [], sections = [], cursor = 0;
    function add(atBeat, durationBeats, midi, gain, part, kind, sectionId, extra) {
      var p = profiles[part]; if (!p) return;
      var source = Object.assign({ kind: 'function' }, p.source);
      var e = Object.assign({ at: round(atBeat * beatSec), duration: round(durationBeats * beatSec), midi: midi, gain: round(gain), part: part, blockId: part, instrument: p.instrument, voiceToneRatio: p.voiceToneRatio, kind: kind, sectionId: sectionId, source: source }, extra || {});
      e.id = [sectionId, e.blockId, part, kind, e.phase || '', e.noteIndex || 0, e.at].join(':');
      var active = e.source.active || (e.source.activeSide === 'callee' ? e.source.callee : e.source.activeSide === 'caller' ? e.source.caller : e.source);
      e.line = active && active.startLine || null;
      events.push(e);
    }
    function gainOf(id) { return profiles[id].instrument === 'strings' ? 0.30 : profiles[id].instrument === 'pluck' ? 0.44 : 0.48; }
    function playTheme(owner, performer, start, sid, scale, extra) {
      var p = profiles[owner]; if (!p || !profiles[performer]) return;
      p.notes.forEach(function (midi, i) {
        add(start + p.starts[i], p.lengths[i], midi, gainOf(performer) * scale * (i === 0 ? 1 : 0.9), performer, extra && extra.kind || 'theme', sid, Object.assign({ themeId: owner, noteIndex: i }, extra || {}));
      });
    }
    function blockPhrase(b, start, sid) {
      var p = profiles[b.functionId], f = b.features;
      if (!p) return;
      var starts = [0, 0.5, 1, 1.5], lengths = [0.40, 0.40, 0.40, 0.43], notes = p.notes.slice();
      if (f.reducers || f.maps) { starts = [0, 0.35, 0.90, 1.40]; lengths = [0.52, 0.52, 0.56, 0.54]; }
      if (f.loops) { notes = [p.notes[0], p.notes[1], p.notes[0], p.notes[1]]; lengths = [0.26, 0.26, 0.26, 0.32]; }
      if (f.branches) { starts[2] = Math.max(starts[2], 1.20); lengths[1] = Math.min(lengths[1], 0.25); }
      // Await changes only this block's notation. It is not measured latency.
      if (f.awaits) { starts[3] = 1.64; lengths[3] = 0.29; }
      notes.forEach(function (midi, i) {
        add(start + starts[i], Math.min(lengths[i], 1.97 - starts[i]), midi, gainOf(b.functionId) * (i === 0 ? 0.90 : 0.78), b.functionId, 'block', sid, { blockId: b.id, themeId: b.functionId, noteIndex: i, fingerprint: b.fingerprint, source: Object.assign({ kind: 'block', blockId: b.id, statementKind: b.statementKind }, b.source) });
      });
    }
    function section(id, beats, label, members, connectionIds, slotKey) {
      var s = { id: id, at: round(cursor * beatSec), end: round((cursor + beats) * beatSec), duration: round(beats * beatSec), label: label, blockIds: members, connectionIds: connectionIds, comparisonKey: slotKey, slotKey: slotKey };
      sections.push(s); return s;
    }
    functionSlots.forEach(function (slot) {
      var p = profiles[slot.id], sid = 'voice:' + (slot.id || slot.key), bs = slot.blocks || [];
      var beats = Math.max(16, 4 + bs.length * 2);
      var s = section(sid, beats, p ? p.name + 'の主題とブロック' : 'この版にはない関数', slot.id ? [slot.id] : [], [], slot.key);
      s.functionId = slot.id || null; s.blocks = []; s.absent = !p;
      if (p) playTheme(slot.id, slot.id, cursor, sid, 1);
      bs.forEach(function (slotBlock, index) {
        var b = blockById[slotBlock.id], at = cursor + 4 + index * 2;
        s.blocks.push({ id: slotBlock.id || null, key: slotBlock.key, at: round(at * beatSec), end: round((at + 2) * beatSec), absent: !b });
        if (b) blockPhrase(b, at, sid);
      });
      // The same identifying motif returns in unused space, without stretching
      // or speeding up code blocks to fill a fixed song duration.
      if (p && beats - (4 + bs.length * 2) >= 4) playTheme(slot.id, slot.id, cursor + beats - 4, sid, 0.72);
      cursor += beats;
    });
    relationSlots.forEach(function (slot) {
      var c = relationById[slot.id], sid = 'relation:' + (slot.id || slot.key);
      var s = section(sid, 16, c ? profiles[c.source].name + ' → ' + profiles[c.target].name : 'この版にはない接点', c ? [c.source, c.target] : [], c ? [c.id] : [], slot.key);
      s.absent = !c;
      if (c) {
        var common = { kind: 'connection', connectionId: c.id, caller: c.caller, callee: c.callee, call: c.call, use: c.use, returns: c.returns, themeSource: profiles[c.target].source };
        function phase(phaseName, performer, start, active, scale) {
          playTheme(c.target, performer, start, sid, scale, { kind: 'relation-' + phaseName, connectionId: c.id, phase: phaseName, blockId: c.sourceBlockId || c.source, source: Object.assign({}, common, { phase: phaseName, activeSide: phaseName === 'callee' ? 'callee' : 'caller', active: active }) });
        }
        phase('caller', c.source, cursor, c.call, 1);
        phase('callee', c.target, cursor + 4, c.returns.length === 1 ? c.returns[0] : c.callee, 1);
        phase('reception', c.source, cursor + 8, c.use || c.call, 0.92);
        // A quiet two-voice ending keeps both identities in context. No unrelated
        // part, inferred mismatch interval or success cadence is added.
        playTheme(c.source, c.source, cursor + 12, sid, 0.55, { kind: 'relation-context', phase: 'context', connectionId: c.id, source: Object.assign({}, common, { phase: 'context', activeSide: 'caller', active: c.call }) });
        playTheme(c.target, c.target, cursor + 12, sid, 0.64, { kind: 'relation-context', phase: 'context', connectionId: c.id, source: Object.assign({}, common, { phase: 'context', activeSide: 'callee', active: c.callee }) });
      }
      cursor += 16;
    });
    events.sort(function (a, b) { return a.at - b.at || a.part.localeCompare(b.part) || a.kind.localeCompare(b.kind) || a.midi - b.midi || a.id.localeCompare(b.id); });
    return {
      version: VERSION, mode: options.mode || 'story', bpm: bpm, durationSec: round(cursor * beatSec + (cursor ? 0.35 : 0)), events: events, sections: sections, profiles: profiles, relations: relations,
      omittedConnections: omitted, functionIds: ids, layoutFunctionIds: functionSlots.map(function (s) { return s.key; }), layoutConnectionIds: relationSlots.map(function (s) { return s.key; }),
      assumptions: ['A static relation score, not an execution trace or measured runtime.', 'Themes are stable auditory identities; block phrasing represents observed syntax without quality grading.', 'Quotation and response show connected functions, not compatible types, author identity or test success.', 'Unknown value usage does not add a warning interval or suppress a known connection.', 'Tempo is fixed. durationSec does not compress an arbitrary program into a fixed song.', 'Stopping for a confirmed test failure belongs to explicit evidence playback, outside this generator.']
    };
  }
  function declarationSignature(fn) {
    // Conservative rename / move: only an otherwise identical function AST,
    // unique in both complete inputs. Recursive rename is intentionally unknown.
    var ast = JSON.parse(canonicalAST(fn.ast));
    if (ast && ast.type === 'FunctionDeclaration') ast.id = null;
    return canonicalAST(ast);
  }
  function uniquePairs(before, after, keyOfBefore, keyOfAfter) {
    var a = new Map(), b = new Map(), pairs = [];
    before.forEach(function (item) { var key = keyOfBefore(item); if (key !== null) { if (!a.has(key)) a.set(key, []); a.get(key).push(item); } });
    after.forEach(function (item) { var key = keyOfAfter(item); if (key !== null) { if (!b.has(key)) b.set(key, []); b.get(key).push(item); } });
    a.forEach(function (items, key) { if (items.length === 1 && b.has(key) && b.get(key).length === 1) pairs.push([items[0], b.get(key)[0], key]); });
    return pairs;
  }
  function mergeBlocks(a, b) {
    // Shortest common supersequence keeps source order on both sides. A moved
    // block can occupy two silent counterpart slots; we do not fake its order.
    var table = Array.from({ length: a.length + 1 }, function () { return new Uint32Array(b.length + 1); });
    for (var x = a.length - 1; x >= 0; x--) for (var y = b.length - 1; y >= 0; y--) table[x][y] = a[x].matchKey === b[y].matchKey ? table[x + 1][y + 1] + 1 : Math.max(table[x + 1][y], table[x][y + 1]);
    var out = [], i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i].matchKey === b[j].matchKey) { out.push({ before: a[i++], after: b[j++] }); }
      else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) out.push({ before: a[i++] });
      else out.push({ after: b[j++] });
    }
    return out.map(function (s, index) { return { key: (s.before || s.after).fingerprint + ':' + index, before: s.before, after: s.after }; });
  }
  function callsiteSignature(c, fn) {
    if (c.callsiteKey) return c.callsiteKey;
    if (!fn || !c.callAst) return null;
    var statement = blocksOf(fn).find(function (b) { return b.id === c.sourceBlockId; });
    var original = c.callAst, replaced = false;
    function copy(node) {
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node)) return node.map(copy);
      var atCall = node === original || Number.isInteger(node.start) && node.start === original.start && node.end === original.end && node.type === original.type;
      var out = {};
      Object.keys(node).sort().forEach(function (key) {
        if (OMIT.has(key)) return;
        if (atCall && key === 'callee') { out.callee = { type: 'SoundCodingCallTarget' }; replaced = true; }
        else out[key] = copy(node[key]);
      });
      return out;
    }
    var clean = copy(statement ? statement.ast : original);
    // Detached handcrafted ASTs can lack offsets; use the call itself, with
    // uniqueness checking below rather than guessing a surrounding statement.
    if (!replaced) clean = copy(original);
    return canonicalAST(clean);
  }
  function buildComparison(before, after, options) {
    validateProgram(before); validateProgram(after); options = options || {};
    var aById = new Map(before.functions.map(function (f) { return [f.id, f]; })), bById = new Map(after.functions.map(function (f) { return [f.id, f]; }));
    var usedA = new Set(), usedB = new Set(), functionPairs = [];
    before.functions.forEach(function (fn) { if (bById.has(fn.id)) { functionPairs.push({ key: fn.id, beforeId: fn.id, afterId: fn.id, reason: 'same-binding' }); usedA.add(fn.id); usedB.add(fn.id); } });
    uniquePairs(before.functions.filter(function (f) { return !usedA.has(f.id); }), after.functions.filter(function (f) { return !usedB.has(f.id); }), declarationSignature, declarationSignature).forEach(function (pair) {
      var sig = pair[2];
      // If another exact-id function has the same body, an unmatched clone is
      // not evidence that the old declaration moved.
      if (before.functions.filter(function (f) { return declarationSignature(f) === sig; }).length !== 1 || after.functions.filter(function (f) { return declarationSignature(f) === sig; }).length !== 1) return;
      functionPairs.push({ key: pair[0].id, beforeId: pair[0].id, afterId: pair[1].id, reason: 'unique-identical-declaration' }); usedA.add(pair[0].id); usedB.add(pair[1].id);
    });
    before.functions.forEach(function (f) { if (!usedA.has(f.id)) functionPairs.push({ key: f.id, beforeId: f.id, afterId: null, reason: 'only-before' }); });
    after.functions.forEach(function (f) { if (!usedB.has(f.id)) functionPairs.push({ key: f.id, beforeId: null, afterId: f.id, reason: 'only-after' }); });
    functionPairs.sort(function (a, b) { return a.key.localeCompare(b.key); });
    var aSlots = [], bSlots = [], inheritedA = Object.create(null), inheritedB = Object.create(null), aFunctionKey = new Map(), bFunctionKey = new Map();
    functionPairs.forEach(function (pair) {
      var a = aById.get(pair.beforeId), b = bById.get(pair.afterId), bs = mergeBlocks(a ? blocksOf(a) : [], b ? blocksOf(b) : []);
      aSlots.push({ key: pair.key, id: pair.beforeId, blocks: bs.map(function (s) { return { key: s.key, id: s.before && s.before.id }; }) });
      bSlots.push({ key: pair.key, id: pair.afterId, blocks: bs.map(function (s) { return { key: s.key, id: s.after && s.after.id }; }) });
      if (a) { aFunctionKey.set(a.id, pair.key); inheritedA[a.id] = profile(a, options.identityProfiles && options.identityProfiles[a.id]); }
      if (b) { bFunctionKey.set(b.id, pair.key); inheritedB[b.id] = profile(b, a ? inheritedA[a.id] : options.identityProfiles && options.identityProfiles[b.id]); }
    });
    var aEdges = (before.connections || []).filter(function (c) { return aById.has(c.source) && aById.has(c.target); });
    var bEdges = (after.connections || []).filter(function (c) { return bById.has(c.source) && bById.has(c.target); });
    var usedEdgeA = new Set(), usedEdgeB = new Set(), relationPairs = [];
    function edgeKey(c, side) {
      var signature = callsiteSignature(c, (side === 'before' ? aById : bById).get(c.source));
      return signature === null ? null : (side === 'before' ? aFunctionKey : bFunctionKey).get(c.source) + '\n' + signature;
    }
    // Callsite identity takes precedence over source-target edge names. When a
    // target changes, the caller's unique statement still supplies one slot.
    uniquePairs(aEdges, bEdges, function (c) { return edgeKey(c, 'before'); }, function (c) { return edgeKey(c, 'after'); }).forEach(function (pair) {
      relationPairs.push({ key: 'callsite:' + connectionId(pair[0]), beforeId: connectionId(pair[0]), afterId: connectionId(pair[1]), reason: 'unique-callsite' }); usedEdgeA.add(connectionId(pair[0])); usedEdgeB.add(connectionId(pair[1]));
    });
    aEdges.forEach(function (a) {
      if (usedEdgeA.has(connectionId(a))) return;
      var b = bEdges.find(function (e) { return !usedEdgeB.has(connectionId(e)) && connectionId(e) === connectionId(a) && aFunctionKey.get(a.source) === bFunctionKey.get(e.source) && aFunctionKey.get(a.target) === bFunctionKey.get(e.target); });
      // Explicit stable edge id can pair unchanged endpoints only. It cannot
      // resolve an ambiguous changed-target callsite by source line alone.
      if (b) { relationPairs.push({ key: 'edge:' + connectionId(a), beforeId: connectionId(a), afterId: connectionId(b), reason: 'same-edge' }); usedEdgeA.add(connectionId(a)); usedEdgeB.add(connectionId(b)); }
    });
    aEdges.forEach(function (c) { if (!usedEdgeA.has(connectionId(c))) relationPairs.push({ key: 'before:' + connectionId(c), beforeId: connectionId(c), afterId: null, reason: 'unmatched' }); });
    bEdges.forEach(function (c) { if (!usedEdgeB.has(connectionId(c))) relationPairs.push({ key: 'after:' + connectionId(c), beforeId: null, afterId: connectionId(c), reason: 'unmatched' }); });
    relationPairs.sort(function (a, b) { return a.key.localeCompare(b.key); });
    var aOptions = Object.assign({}, options, { identityProfiles: inheritedA, functionSlots: aSlots, relationSlots: relationPairs.map(function (p) { return { key: p.key, id: p.beforeId }; }) });
    var bOptions = Object.assign({}, options, { identityProfiles: inheritedB, functionSlots: bSlots, relationSlots: relationPairs.map(function (p) { return { key: p.key, id: p.afterId }; }) });
    if (options.mode === 'relation' && options.connectionId) {
      var selectedPair = relationPairs.find(function (p) { return p.beforeId === options.connectionId || p.afterId === options.connectionId; });
      if (selectedPair) aOptions.comparisonKey = bOptions.comparisonKey = selectedPair.key;
    }
    return { before: buildScore(before, aOptions), after: buildScore(after, bOptions), functionPairs: functionPairs, relationPairs: relationPairs, layoutFunctionIds: functionPairs.map(function (p) { return p.key; }), layoutConnectionIds: relationPairs.map(function (p) { return p.key; }) };
  }
  return Object.freeze({ version: VERSION, canonicalAST: canonicalAST, features: features, profile: profile, buildScore: buildScore, buildComparison: buildComparison });
});
