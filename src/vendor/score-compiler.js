/* SoundCoding deterministic JavaScript score compiler. No input is executed. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ScoreCompiler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var RULE_VERSION = 'ast-motifs/1.0.0';
  var LIMITS = Object.freeze({ maxFiles: 150, maxCharacters: 2000000, maxFileCharacters: 200000, maxNodes: 40000, maxEvents: 4000, maxBlocks: 1000, maxDepth: 180 });
  var DICTIONARY = {
    '+': [[60, 64, 67], 0.75, 'piano', '加算'],
    '-': [[67, 64, 60], 0.75, 'piano', '減算'],
    '*': [[60, 67, 72], 0.75, 'pluck', '乗算'],
    '/': [[72, 67, 60], 0.75, 'pluck', '除算'],
    '%': [[60, 67, 60], 0.75, 'pluck', '剰余'],
    '**': [[60, 72, 79], 0.75, 'pluck', '累乗'],
    comparison: [[64, 65], 0.5, 'bell', '比較'],
    logical: [[60, 65, 64], 0.75, 'bell', '論理演算'],
    call: [[62, 67], 0.5, 'piano', '呼び出し'],
    reduce: [[60, 64, 67, 64], 1, 'pluck', 'reduce 呼び出し'],
    map: [[60, 62, 64], 0.75, 'pluck', 'map 呼び出し'],
    loop: [[60, 67, 60], 0.75, 'pluck', '反復構造（回数未確認）'],
    if: [[60, 65], 0.5, 'bell', '分岐構造（経路未確認）'],
    await: [[62, 64, 67], 0.75, 'pad', 'await'],
    return: [[67, 60], 0.5, 'piano', 'return'],
    literal: [[64], 0.25, 'bell', 'リテラル'],
    declaration: [[60], 0.25, 'piano', '宣言'],
    assignment: [[60, 64], 0.5, 'piano', '代入'],
    member: [[62], 0.25, 'pluck', 'プロパティ参照'],
    array: [[60, 64], 0.5, 'pluck', '配列'],
    object: [[60, 67], 0.5, 'pluck', 'オブジェクト'],
    new: [[60, 64, 67], 0.75, 'piano', 'new'],
    throw: [[61, 67], 0.5, 'bell', 'throw 文（実行未確認）'],
    try: [[60, 62, 60], 0.75, 'pad', 'try 構造'],
    function: [[60, 67], 0.5, 'piano', '関数定義'],
    yield: [[67, 62], 0.5, 'pad', 'yield'],
    unary: [[64, 60], 0.5, 'bell', '単項演算'],
    update: [[60, 62], 0.5, 'piano', '更新'],
    switch: [[60, 64, 65], 0.75, 'bell', 'switch 構造'],
    spread: [[60, 64, 67], 0.75, 'pluck', '展開'],
    break: [[67, 60], 0.5, 'pluck', 'break 文'],
    continue: [[67, 60, 67], 0.75, 'pluck', 'continue 文'],
  };
  Object.keys(DICTIONARY).forEach(function (key) {
    Object.freeze(DICTIONARY[key][0]); Object.freeze(DICTIONARY[key]);
  });
  Object.freeze(DICTIONARY);
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  function location(file, node) { return { file: file, startLine: node.loc.start.line, endLine: node.loc.end.line }; }
  function normalizePath(value) {
    if (typeof value !== 'string' || /[\x00-\x1f:]/.test(value)) return null;
    var raw = value.replace(/\\/g, '/');
    if (raw[0] === '/') return null;
    var parts = [];
    for (var item of raw.split('/')) {
      if (!item || item === '.') continue;
      if (item === '..') { if (!parts.length) return null; parts.pop(); }
      else parts.push(item);
    }
    return parts.length ? parts.join('/') : null;
  }
  function children(node) {
    var result = [];
    Object.keys(node).forEach(function (key) {
      if (key === 'loc' || key === 'start' || key === 'end') return;
      var value = node[key];
      if (Array.isArray(value)) value.forEach(function (child) { if (child && typeof child.type === 'string') result.push([child, key]); });
      else if (value && typeof value.type === 'string') result.push([value, key]);
    });
    return result;
  }
  function isFunction(node) { return node && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type); }
  function identifierNames(pattern, target) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') { target.push(pattern.name); return; }
    if (pattern.type === 'Property') { identifierNames(pattern.value, target); return; }
    children(pattern).forEach(function (child) { identifierNames(child[0], target); });
  }
  function localBindings(fn) {
    var map = new Map(), names = [], index = 0;
    (fn.node.params || []).forEach(function (param) { identifierNames(param, names); });
    names.forEach(function (name) { if (!map.has(name)) map.set(name, 'p' + index++); });
    index = 0;
    function visit(node) {
      if (node !== fn.node && isFunction(node)) {
        if (node.id) names.push(node.id.name);
        return;
      }
      if (node.type === 'VariableDeclarator') identifierNames(node.id, names);
      if (node.type === 'CatchClause') identifierNames(node.param, names);
      children(node).forEach(function (child) { visit(child[0]); });
    }
    names = [];
    visit(fn.node.body || fn.node);
    names.forEach(function (name) { if (!map.has(name)) map.set(name, 'v' + index++); });
    if (fn.node.id && !map.has(fn.node.id.name)) map.set(fn.node.id.name, 'self');
    return map;
  }
  function canonical(node, bindings, parent, key) {
    if (node === null || node === undefined) return null;
    if (Array.isArray(node)) return node.map(function (value) { return canonical(value, bindings, parent, key); });
    if (typeof node !== 'object') return typeof node === 'bigint' ? String(node) + 'n' : node;
    if (node.type === 'Identifier') {
      var property = parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) || ((parent.type === 'Property' || parent.type === 'MethodDefinition') && key === 'key' && !parent.computed));
      return ['Identifier', property ? node.name : (bindings.get(node.name) || 'global:' + node.name)];
    }
    if (node.type === 'Literal') {
      if (node.regex) return ['Literal', 'regexp', node.regex.pattern, node.regex.flags];
      return ['Literal', typeof node.value, typeof node.value === 'bigint' ? String(node.value) : node.value];
    }
    if (isFunction(node)) return ['FunctionValue', !!node.async, !!node.generator, node.params.length];
    var result = [node.type || 'record'];
    Object.keys(node).sort(cmp).forEach(function (field) {
      if (/^(type|start|end|loc|raw|sourceType)$/.test(field)) return;
      result.push([field, canonical(node[field], bindings, node, field)]);
    });
    return result;
  }
  function publicBoundary(path) {
    var parts = path.replace(/^src\//, '').split('/');
    return parts.length > 1 ? parts[0] : '(root)';
  }
  function isPrivate(source, target) {
    if (publicBoundary(source) === publicBoundary(target)) return false;
    var parts = target.replace(/^src\//, '').split('/');
    return parts.some(function (part, i) { return part[0] === '_' || (part === 'internal' && i < parts.length - 1); });
  }

  function compileProject(files, options) {
    options = options || {};
    var parser = options.parser || (typeof globalThis !== 'undefined' && globalThis.acorn);
    var limits = {};
    Object.keys(LIMITS).forEach(function (key) { limits[key] = Number.isFinite(options[key]) ? Math.max(1, Math.min(LIMITS[key], Math.floor(options[key]))) : LIMITS[key]; });
    var result = { ruleVersion: RULE_VERSION, blocks: [], edges: [], diagnostics: [], functions: [] };
    function diagnostic(kind, message, source, extra) {
      var severity = /^(parser-unavailable|input|syntax|unsupported-syntax)$/.test(kind) ? 'error' : /^(limit|partial-syntax)$/.test(kind) ? 'warning' : 'info';
      result.diagnostics.push(Object.assign({ kind: kind, message: message, source: source || null, severity: severity }, extra || {}));
    }
    if (!parser || typeof parser.parse !== 'function') {
      diagnostic('parser-unavailable', 'Acorn parser を注入してください。入力コードは実行していません。'); return result;
    }
    if (!files || typeof files !== 'object' || Array.isArray(files)) { diagnostic('input', 'files は { path: code } 形式です。'); return result; }
    var paths = Object.keys(files).sort(cmp);
    if (paths.length > limits.maxFiles) { diagnostic('limit', 'ファイル数上限 ' + limits.maxFiles + ' を超えています。'); return result; }
    var normalized = new Map(), duplicates = new Set(), totalCharacters = 0;
    paths.forEach(function (inputPath) {
      var file = normalizePath(inputPath), text = files[inputPath];
      if (!file || typeof text !== 'string') { diagnostic('input', '無効な相対パスまたはファイル内容: ' + inputPath); return; }
      if (normalized.has(file) || duplicates.has(file)) { normalized.delete(file); duplicates.add(file); return; }
      if (!/\.(?:js|mjs|cjs)$/.test(file)) { diagnostic('unsupported-syntax', 'JavaScript ES modules のみ対象です。TypeScript/JSX は未対応です。', { file: file, startLine: 1, endLine: 1 }); return; }
      if (text.length > limits.maxFileCharacters) { diagnostic('limit', file + ' は1ファイルの文字数上限を超えています。'); return; }
      normalized.set(file, text); totalCharacters += text.length;
    });
    duplicates.forEach(function (file) { diagnostic('input', '重複した正規化パスを除外しました: ' + file); });
    if (totalCharacters > limits.maxCharacters) { diagnostic('limit', '合計文字数上限 ' + limits.maxCharacters + ' を超えています。'); return result; }
    var modules = new Map(), allFunctions = [], totalNodes = 0;
    for (var entry of Array.from(normalized.entries()).sort(function (a, b) { return cmp(a[0], b[0]); })) {
      var path = entry[0], code = entry[1], ast;
      try { ast = parser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true }); }
      catch (error) {
        var line = error.loc ? error.loc.line : 1;
        diagnostic('syntax', '構文を解析できません: ' + error.message, { file: path, startLine: line, endLine: line }); continue;
      }
      var stack = [[ast, 0]], count = 0, tooDeep = false;
      while (stack.length) {
        var pair = stack.pop(); count++;
        if (pair[1] > limits.maxDepth) { tooDeep = true; break; }
        children(pair[0]).forEach(function (child) { stack.push([child[0], pair[1] + 1]); });
      }
      if (tooDeep || totalNodes + count > limits.maxNodes) { diagnostic('limit', path + ' はASTの深さ・ノード数上限を超えたため除外しました。'); continue; }
      totalNodes += count;
      modules.set(path, { path: path, ast: ast, functions: [], imports: new Map(), exports: new Map(), stars: [], references: [], topFunctions: new Map(), firstBlock: null });
    }
    function resolvePath(from, specifier) {
      if (!/^\.\.?\//.test(specifier)) return { path: null, reason: 'external' };
      var base = normalizePath(from.slice(0, from.lastIndexOf('/') + 1) + specifier);
      if (!base) return { path: null, reason: 'outside-project' };
      var candidates = [base, base + '.js', base + '.mjs', base + '.cjs', base + '/index.js', base + '/index.mjs', base + '/index.cjs'];
      for (var candidate of candidates) if (modules.has(candidate)) return { path: candidate, reason: null };
      return { path: null, reason: 'missing-file' };
    }
    modules.forEach(function (mod) {
      var anonymous = 0, usedNames = new Map();
      function discover(node, parent, owner, key) {
        var current = owner;
        if (isFunction(node)) {
          var name = node.id && node.id.name;
          if (!name && parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') name = parent.id.name;
          if (!name && parent && (parent.type === 'Property' || parent.type === 'MethodDefinition')) name = parent.key.name || String(parent.key.value);
          if (!name && parent && parent.type === 'ExportDefaultDeclaration') name = 'default';
          if (!name) name = '<callback' + (++anonymous) + '>';
          var qualified = (owner ? owner.qualifiedName + '/' : '') + name;
          var duplicateIndex = usedNames.get(qualified) || 0; usedNames.set(qualified, duplicateIndex + 1);
          var id = 'fn:' + mod.path + '#' + qualified + (duplicateIndex ? '~' + duplicateIndex : '');
          current = { id: id, name: name, qualifiedName: qualified, file: mod.path, node: node, parent: owner, children: new Map(), blocks: [], bindings: null, source: location(mod.path, node) };
          current.bindings = localBindings(current);
          current.ownBindings = new Set(current.bindings.keys());
          if (owner) owner.bindings.forEach(function (value, name) { if (!current.bindings.has(name)) current.bindings.set(name, 'outer:' + value); });
          mod.functions.push(current); allFunctions.push(current);
          if (owner) owner.children.set(name, current);
          else mod.topFunctions.set(name, current);
        }
        children(node).forEach(function (child) { discover(child[0], node, current, child[1]); });
      }
      discover(mod.ast, null, null, '');
      mod.ast.body.forEach(function (node) {
        if (node.type === 'ImportDeclaration') {
          var specifier = node.source.value;
          var resolved = resolvePath(mod.path, specifier);
          mod.references.push({ node: node, specifier: specifier, resolution: resolved, kind: 'import' });
          node.specifiers.forEach(function (item) { mod.imports.set(item.local.name, { path: resolved.path, reason: resolved.reason, specifier: specifier, imported: item.type === 'ImportDefaultSpecifier' ? 'default' : item.type === 'ImportNamespaceSpecifier' ? '*' : item.imported.name || item.imported.value }); });
        }
        if (node.type === 'ExportNamedDeclaration') {
          if (node.source) {
            var resolution = resolvePath(mod.path, node.source.value);
            mod.references.push({ node: node, specifier: node.source.value, resolution: resolution, kind: 'reexport' });
            node.specifiers.forEach(function (item) { mod.exports.set(item.exported.name || item.exported.value, { path: resolution.path, imported: item.local.name || item.local.value }); });
          } else {
            if (node.declaration && node.declaration.id) mod.exports.set(node.declaration.id.name, { local: node.declaration.id.name });
            if (node.declaration && node.declaration.type === 'VariableDeclaration') node.declaration.declarations.forEach(function (item) { if (item.id.type === 'Identifier') mod.exports.set(item.id.name, { local: item.id.name }); });
            node.specifiers.forEach(function (item) { mod.exports.set(item.exported.name || item.exported.value, { local: item.local.name }); });
          }
        }
        if (node.type === 'ExportDefaultDeclaration') mod.exports.set('default', { local: node.declaration.id ? node.declaration.id.name : node.declaration.type === 'Identifier' ? node.declaration.name : 'default' });
        if (node.type === 'ExportAllDeclaration') {
          var target = resolvePath(mod.path, node.source.value);
          mod.references.push({ node: node, specifier: node.source.value, resolution: target, kind: 'reexport' });
          if (node.exported) mod.exports.set(node.exported.name || node.exported.value, { namespace: target.path });
          else mod.stars.push(target.path);
        }
      });
      mod.functions.forEach(function (fn) {
        mod.imports.forEach(function (item, name) { if (!fn.bindings.has(name)) fn.bindings.set(name, 'import:' + item.imported); });
      });
    });
    function exportedFunction(path, name, visited) {
      if (!path || !modules.has(path)) return null;
      visited = visited || new Set();
      var key = path + '#' + name;
      if (visited.has(key)) return null; visited.add(key);
      var mod = modules.get(path), value = mod.exports.get(name);
      if (value) {
        if (value.local && mod.topFunctions.has(value.local)) return mod.topFunctions.get(value.local);
        if (value.local && mod.imports.has(value.local)) { var imported = mod.imports.get(value.local); return exportedFunction(imported.path, imported.imported, visited); }
        if (value.path) return exportedFunction(value.path, value.imported, visited);
      }
      if (name === 'default') return null;
      var matches = [];
      mod.stars.forEach(function (target) { var match = exportedFunction(target, name, new Set(visited)); if (match && !matches.includes(match)) matches.push(match); });
      return matches.length === 1 ? matches[0] : null;
    }
    function resolveCall(mod, fn, callee) {
      if (callee.type === 'Identifier') {
        var owner = fn;
        while (owner) {
          if (owner.name === callee.name && (!owner.ownBindings.has(callee.name) || owner.bindings.get(callee.name) === 'self')) return { fn: owner };
          if (owner.children.has(callee.name)) return { fn: owner.children.get(callee.name) };
          if (owner.ownBindings.has(callee.name)) return { fn: null, reason: 'local-value-or-parameter' };
          owner = owner.parent;
        }
        if (mod.topFunctions.has(callee.name)) return { fn: mod.topFunctions.get(callee.name) };
        var imported = mod.imports.get(callee.name);
        if (imported) return { fn: exportedFunction(imported.path, imported.imported), reason: imported.reason || 'export-not-resolved' };
        return { fn: null, reason: 'global-or-dynamic' };
      }
      if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier') {
        var scope = fn;
        while (scope) {
          if (scope.ownBindings.has(callee.object.name)) return { fn: null, reason: 'local-value-or-parameter' };
          scope = scope.parent;
        }
        var namespace = mod.imports.get(callee.object.name);
        if (namespace && namespace.imported === '*') return { fn: exportedFunction(namespace.path, callee.property.name), reason: namespace.reason || 'namespace-export-not-resolved' };
      }
      return { fn: null, reason: 'member-or-dynamic' };
    }

    var eventCount = 0, eventCapReported = false, pendingCalls = [];
    function eventsFor(node, mod, fn, block) {
      var events = [];
      function emit(kind, current, tokenSuffix) {
        if (eventCount >= limits.maxEvents) {
          if (!eventCapReported) { diagnostic('limit', 'イベント上限 ' + limits.maxEvents + ' に達しました。以降の音は省略しています。'); eventCapReported = true; }
          return;
        }
        var definition = DICTIONARY[kind] || DICTIONARY.unary;
        var notes = definition[0].slice(), token = kind + (tokenSuffix === undefined ? '' : ':' + tokenSuffix);
        if (kind === 'literal' && typeof current.value === 'number' && Number.isFinite(current.value)) notes = [[60, 62, 64, 65, 67, 69, 71][Math.abs(Math.trunc(current.value)) % 7]];
        var event = { kind: kind, label: definition[3], notes: notes, beats: definition[1], instrument: definition[2], source: location(mod.path, current), token: token };
        if (current.operator) event.operator = current.operator;
        if (kind === 'literal' && current.type === 'Literal') event.value = typeof current.value === 'bigint' ? String(current.value) + 'n' : current.value;
        events.push(event); eventCount++;
      }
      function visit(current) {
        if (isFunction(current)) { emit('function', current, (current.async ? 'async:' : '') + current.params.length); return; }
        var type = current.type;
        if (type === 'ImportDeclaration' || type === 'ExportAllDeclaration') return;
        if (type === 'ExportNamedDeclaration' || type === 'ExportDefaultDeclaration') { if (current.declaration) visit(current.declaration); return; }
        if (type === 'BinaryExpression' || type === 'LogicalExpression') {
          visit(current.left);
          var op = current.operator;
          emit(DICTIONARY[op] ? op : /^(==|===|!=|!==|<|>|<=|>=|in|instanceof)$/.test(op) ? 'comparison' : 'logical', current, op);
          visit(current.right); return;
        }
        if (type === 'VariableDeclaration') emit('declaration', current, current.kind);
        else if (type === 'AssignmentExpression') emit('assignment', current, current.operator);
        else if (type === 'CallExpression' || type === 'NewExpression') {
          var method = current.callee.type === 'MemberExpression' && !current.callee.computed && current.callee.property.name;
          emit(type === 'NewExpression' ? 'new' : method === 'reduce' || method === 'map' ? method : 'call', current);
          pendingCalls.push({ node: current, mod: mod, fn: fn, block: block, resolution: resolveCall(mod, fn, current.callee) });
        } else if (/^(ForStatement|ForInStatement|ForOfStatement|WhileStatement|DoWhileStatement)$/.test(type)) emit('loop', current, type);
        else if (type === 'IfStatement' || type === 'ConditionalExpression') emit('if', current, type);
        else if (type === 'AwaitExpression') emit('await', current);
        else if (type === 'ReturnStatement') emit('return', current);
        else if (type === 'Literal') emit('literal', current, current.regex ? 'regexp:' + current.regex.pattern + '/' + current.regex.flags : typeof current.value + ':' + String(current.value));
        else if (type === 'MemberExpression') emit('member', current, current.computed ? 'computed' : 'named');
        else if (type === 'ArrayExpression') emit('array', current);
        else if (type === 'ObjectExpression') emit('object', current);
        else if (type === 'ThrowStatement') emit('throw', current);
        else if (type === 'TryStatement') emit('try', current);
        else if (type === 'YieldExpression') emit('yield', current);
        else if (type === 'UnaryExpression') emit('unary', current, current.operator);
        else if (type === 'UpdateExpression') emit('update', current, current.operator);
        else if (type === 'SwitchStatement') emit('switch', current);
        else if (type === 'SpreadElement') emit('spread', current);
        else if (type === 'BreakStatement') emit('break', current);
        else if (type === 'ContinueStatement') emit('continue', current);
        else if (type === 'ImportExpression') { emit('call', current, 'dynamic-import'); diagnostic('dynamic-import', '動的 import の参照先は解決していません。', location(mod.path, current)); }
        else if (type === 'TaggedTemplateExpression' || type === 'TemplateLiteral') emit('literal', current, type);
        else if (type === 'WithStatement' || type === 'ClassDeclaration' || type === 'ClassExpression') diagnostic('partial-syntax', type + ' は一部の構造だけを音に対応しています。', location(mod.path, current));
        children(current).forEach(function (child) { visit(child[0]); });
      }
      visit(node);
      return events;
    }
    function makeBlocks(mod, fn, statements) {
      var occurrences = new Map();
      statements.forEach(function (node, index) {
        if (result.blocks.length >= limits.maxBlocks) return;
        var ordinal = occurrences.get(node.type) || 0; occurrences.set(node.type, ordinal + 1);
        var structure = JSON.stringify(canonical(node, fn.bindings));
        var block = { id: fn.id + ':' + node.type + ':' + ordinal, functionId: fn.id, functionName: fn.qualifiedName, statementIndex: index, statementKind: node.type, canonical: structure, fingerprint: hash(structure), source: location(mod.path, node), events: [] };
        block.events = eventsFor(node, mod, fn, block);
        fn.blocks.push(block); result.blocks.push(block);
      });
    }
    modules.forEach(function (mod) {
      mod.functions.sort(function (a, b) { return cmp(a.qualifiedName, b.qualifiedName); });
      mod.functions.forEach(function (fn) { makeBlocks(mod, fn, fn.node.body.type === 'BlockStatement' ? fn.node.body.body : [fn.node.body]); });
      var top = mod.ast.body.filter(function (node) {
        if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') return false;
        var declaration = node.declaration || node;
        if (isFunction(declaration)) return false;
        if (node.type === 'ExportNamedDeclaration' && !node.declaration) return false;
        if (declaration.type === 'VariableDeclaration' && declaration.declarations.every(function (item) { return item.init && isFunction(item.init); })) return false;
        return true;
      });
      if (top.length) {
        var synthetic = { id: 'fn:' + mod.path + '#<module>', name: '<module>', qualifiedName: '<module>', file: mod.path, node: mod.ast, parent: null, children: new Map(), blocks: [], source: location(mod.path, mod.ast) };
        synthetic.bindings = localBindings(synthetic); synthetic.ownBindings = new Set(synthetic.bindings.keys());
        mod.imports.forEach(function (item, name) { if (!synthetic.bindings.has(name)) synthetic.bindings.set(name, 'import:' + item.imported); });
        allFunctions.push(synthetic); makeBlocks(mod, synthetic, top);
      }
    });
    if (result.blocks.length >= limits.maxBlocks) diagnostic('limit', 'ブロック数上限に達しました。省略された文がある可能性があります。');
    result.blocks.sort(function (a, b) { return cmp(a.functionName, b.functionName) || cmp(a.source.file, b.source.file) || a.statementIndex - b.statementIndex; });
    modules.forEach(function (mod) { mod.firstBlock = result.blocks.find(function (block) { return block.source.file === mod.path; }); });
    allFunctions.forEach(function (fn) { result.functions.push({ id: fn.id, name: fn.qualifiedName, source: fn.source, canonical: JSON.stringify(fn.blocks.map(function (block) { return block.canonical; })), blockIds: fn.blocks.map(function (block) { return block.id; }) }); });
    result.functions.sort(function (a, b) { return cmp(a.name, b.name) || cmp(a.source.file, b.source.file); });
    modules.forEach(function (mod) {
      mod.references.forEach(function (reference, index) {
        var target = reference.resolution.path, targetMod = target && modules.get(target);
        var edge = { id: reference.kind + ':' + mod.path + '->' + reference.specifier + ':' + index, source: mod.firstBlock ? mod.firstBlock.id : 'module:' + mod.path, target: targetMod ? targetMod.firstBlock ? targetMod.firstBlock.id : 'module:' + target : null, sourceFunction: null, targetFunction: null, sourceLocation: location(mod.path, reference.node), sourceFile: mod.path, targetFile: target, kind: reference.kind, status: target ? 'resolved' : 'unresolved', specifier: reference.specifier, reason: reference.resolution.reason, boundary: target && isPrivate(mod.path, target) ? 'internal' : 'public' };
        result.edges.push(edge);
        if (!target) diagnostic('unresolved-import', '参照先を解決できません: ' + reference.specifier + ' (' + reference.resolution.reason + ')', edge.sourceLocation, { edgeIds: [edge.id] });
        if (edge.boundary === 'internal') diagnostic('internal', '別の境界から internal/ または _ で始まる実装を直接参照しています。規約に基づく指摘です。', edge.sourceLocation, { severity: 'warning', files: [mod.path, target], edgeIds: [edge.id] });
      });
    });
    var callOrdinals = new Map();
    pendingCalls.forEach(function (call) {
      var index = callOrdinals.get(call.block.id) || 0; callOrdinals.set(call.block.id, index + 1);
      var target = call.resolution.fn;
      var edge = { id: 'call:' + call.block.id + ':' + index, source: call.block.id, target: target && target.blocks.length ? target.blocks[0].id : target ? target.id : null, sourceFunction: call.fn.id, targetFunction: target ? target.id : null, sourceFunctionName: call.fn.qualifiedName, targetFunctionName: target ? target.qualifiedName : null, sourceFile: call.mod.path, targetFile: target ? target.file : null, kind: 'call', status: target ? 'resolved' : 'unresolved', reason: target ? null : call.resolution.reason, sourceLocation: location(call.mod.path, call.node) };
      result.edges.push(edge);
      if (!target) diagnostic('unresolved-call', '呼び出し先の実装は未解決です (' + call.resolution.reason + ')。呼び出し構文の音だけを生成します。', edge.sourceLocation, { edgeIds: [edge.id] });
    });
    // Module cycles use import/re-export edges, never ordinary recursion.
    var adjacency = new Map(); modules.forEach(function (_, path) { adjacency.set(path, []); });
    var dependencies = result.edges.filter(function (edge) { return edge.kind !== 'call' && edge.targetFile; });
    dependencies.forEach(function (edge) { adjacency.get(edge.sourceFile).push(edge.targetFile); });
    var indices = new Map(), lows = new Map(), onStack = new Set(), active = [], next = 0;
    function component(file) {
      indices.set(file, next); lows.set(file, next++); active.push(file); onStack.add(file);
      adjacency.get(file).forEach(function (target) {
        if (!indices.has(target)) { component(target); lows.set(file, Math.min(lows.get(file), lows.get(target))); }
        else if (onStack.has(target)) lows.set(file, Math.min(lows.get(file), indices.get(target)));
      });
      if (lows.get(file) !== indices.get(file)) return;
      var members = [], member;
      do { member = active.pop(); onStack.delete(member); members.push(member); } while (member !== file);
      members.sort(cmp);
      var internal = dependencies.filter(function (edge) { return members.includes(edge.sourceFile) && members.includes(edge.targetFile); });
      if (members.length > 1 || internal.some(function (edge) { return edge.sourceFile === edge.targetFile; })) diagnostic('cycle', '静的 import / re-export の循環依存: ' + members.join(' → '), internal[0].sourceLocation, { severity: 'warning', files: members, edgeIds: internal.map(function (edge) { return edge.id; }) });
    }
    Array.from(adjacency.keys()).sort(cmp).forEach(function (file) { if (!indices.has(file)) component(file); });
    result.edges.sort(function (a, b) { return cmp(a.id, b.id); });
    result.diagnostics.sort(function (a, b) { return cmp(a.source ? a.source.file : '', b.source ? b.source.file : '') || (a.source ? a.source.startLine : 0) - (b.source ? b.source.startLine : 0) || cmp(a.kind, b.kind) || cmp(a.message, b.message); });
    return result;
  }

  function lcsPairs(before, after, equal) {
    var rows = before.length + 1, cols = after.length + 1;
    var table = Array.from({ length: rows }, function () { return new Uint16Array(cols); });
    for (var i = before.length - 1; i >= 0; i--) for (var j = after.length - 1; j >= 0; j--) table[i][j] = equal(before[i], after[j]) ? 1 + table[i + 1][j + 1] : Math.max(table[i + 1][j], table[i][j + 1]);
    var pairs = [], x = 0, y = 0;
    while (x < before.length && y < after.length) {
      if (equal(before[x], after[y])) { pairs.push([x++, y++]); }
      else if (table[x + 1][y] >= table[x][y + 1]) x++;
      else y++;
    }
    return pairs;
  }
  function alignSequences(before, after, equal, compatible) {
    var matches = lcsPairs(before, after, equal), output = [], left = 0, right = 0;
    matches.concat([[before.length, after.length]]).forEach(function (match) {
      while (left < match[0] || right < match[1]) {
        var a = left < match[0] ? before[left] : null, b = right < match[1] ? after[right] : null;
        if (a && b && compatible(a, b)) { output.push([a, b]); left++; right++; }
        else if (a) { output.push([a, null]); left++; }
        else { output.push([null, b]); right++; }
      }
      if (match[0] < before.length) { output.push([before[match[0]], after[match[1]]]); left++; right++; }
    });
    return output;
  }
  function eventEqual(a, b) { return a.token === b.token && a.instrument === b.instrument && a.beats === b.beats && JSON.stringify(a.notes) === JSON.stringify(b.notes); }
  function alignScores(before, after) {
    var output = { ruleVersion: RULE_VERSION, blocks: [], diagnostics: [] };
    if (!before || !after || before.ruleVersion !== after.ruleVersion || before.ruleVersion !== RULE_VERSION) {
      output.diagnostics.push({ kind: 'rule-version', message: '同じ変換ルール版の譜面を比較してください。' }); return output;
    }
    function groups(score) {
      var map = new Map();
      score.blocks.forEach(function (block) { if (!map.has(block.functionId)) map.set(block.functionId, []); map.get(block.functionId).push(block); });
      map.forEach(function (blocks) { blocks.sort(function (a, b) { return a.statementIndex - b.statementIndex; }); });
      return map;
    }
    var oldGroups = groups(before), newGroups = groups(after), used = new Set(), paired = [];
    var groupCanonical = function (blocks) { return JSON.stringify(blocks.map(function (block) { return block.canonical; })); };
    oldGroups.forEach(function (blocks, id) {
      var other = newGroups.has(id) ? id : null;
      if (!other) {
        var exact = Array.from(newGroups.keys()).filter(function (candidate) { return !used.has(candidate) && groupCanonical(newGroups.get(candidate)) === groupCanonical(blocks); });
        if (exact.length === 1) other = exact[0];
        else if (exact.length > 1) output.diagnostics.push({ kind: 'ambiguous-match', message: '同じ内容の関数が複数あり、移動先を一意に対応付けできません: ' + id });
      }
      if (!other) {
        var named = Array.from(newGroups.keys()).filter(function (candidate) { return !used.has(candidate) && newGroups.get(candidate)[0].functionName === blocks[0].functionName; });
        if (named.length === 1) other = named[0];
      }
      if (other && !used.has(other)) { used.add(other); paired.push([blocks, newGroups.get(other)]); }
      else paired.push([blocks, []]);
    });
    newGroups.forEach(function (blocks, id) { if (!used.has(id)) paired.push([[], blocks]); });
    paired.forEach(function (pair) {
      alignSequences(pair[0], pair[1], function (a, b) { return a.canonical === b.canonical; }, function (a, b) { return a.statementKind === b.statementKind; }).forEach(function (blocks) {
        var a = blocks[0], b = blocks[1];
        var slots = alignSequences(a ? a.events : [], b ? b.events : [], eventEqual, function () { return true; }).map(function (events) {
          return { before: events[0], after: events[1], status: !events[0] ? 'added' : !events[1] ? 'removed' : eventEqual(events[0], events[1]) ? 'unchanged' : 'changed', beats: Math.max(events[0] ? events[0].beats : 0, events[1] ? events[1].beats : 0) };
        });
        output.blocks.push({ id: a ? a.id : b.id, status: !a ? 'added' : !b ? 'removed' : a.canonical === b.canonical ? 'unchanged' : 'changed', before: a, after: b, slots: slots });
      });
    });
    return output;
  }
  return { compileProject: compileProject, alignScores: alignScores, RULE_VERSION: RULE_VERSION, LIMITS: LIMITS, DICTIONARY: DICTIONARY };
});
