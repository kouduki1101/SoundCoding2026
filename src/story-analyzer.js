/* A bounded, source-derived review model. Uploaded JavaScript is never executed. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StoryAnalyzer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const version = 'ensemble-observations/2.0';
  function children(node) {
    return Object.entries(node).filter(([key]) => !['loc','start','end'].includes(key)).flatMap(([, value]) =>
      Array.isArray(value) ? value.filter(item => item && typeof item.type === 'string') : value && typeof value.type === 'string' ? [value] : []);
  }
  function walk(node, fn, skipNested = false, first = true) {
    if (!node || (!first && skipNested && /Function|ArrowFunction/.test(node.type))) return;
    fn(node); children(node).forEach(child => walk(child, fn, skipNested, false));
  }
  function hash(text) { let n = 2166136261; for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return (n >>> 0).toString(16).padStart(8, '0'); }
  function pathJoin(file, target) {
    if (!target.startsWith('.')) return null;
    const out = file.split('/').slice(0, -1);
    for (const part of target.split('/')) { if (part === '..') { if (!out.length) return null; out.pop(); } else if (part && part !== '.') out.push(part); }
    return out.join('/');
  }
  function source(file, node) { return { file, startLine: node.loc.start.line, endLine: node.loc.end.line, startColumn:node.loc.start.column, endColumn:node.loc.end.column, start:node.start, end:node.end }; }
  function isFunction(node) { return /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type); }
  // Canonicalize each statement independently. The compiler's function-wide
  // binding ordinals change after an unrelated declaration is inserted. Keep
  // identifier spellings here rather than claiming unproved rename identity.
  function canonical(node) {
    if (node === null || node === undefined) return null;
    if (Array.isArray(node)) return node.map(canonical);
    if (typeof node !== 'object') return typeof node === 'bigint' ? String(node) + 'n' : node;
    if (node.type === 'Literal') return node.regex ? ['Literal','regexp',node.regex.pattern,node.regex.flags] : ['Literal',typeof node.value,typeof node.value === 'bigint' ? String(node.value) : node.value];
    return Object.keys(node).sort().filter(key => !['start','end','loc','raw','comments','leadingComments','trailingComments'].includes(key)).map(key => [key,canonical(node[key])]);
  }
  function statementBlocks(fn, ast, file) {
    const occurrences = new Map();
    const statements = ast.body.type === 'BlockStatement' ? ast.body.body : [ast.body];
    return statements.flatMap((node, statementIndex) => {
      if (node.type === 'EmptyStatement') return [];
      const structure = JSON.stringify(canonical(node));
      const fingerprint = hash(structure) + hash('statement:' + structure);
      const occurrence = occurrences.get(fingerprint) || 0;
      occurrences.set(fingerprint, occurrence + 1);
      return [{ id:fn.id + ':block:' + fingerprint + ':' + occurrence, functionId:fn.id, statementIndex, statementKind:node.type, ast:node, source:source(file,node), canonical:structure, fingerprint, occurrence, identityBasis:'function-id-and-statement-syntax', identityAmbiguous:false }];
    }).map(block => ({...block, identityAmbiguous:occurrences.get(block.fingerprint) > 1}));
  }
  // Mirror the compiler's function identity, including declaration bindings. A line
  // can contain several anonymous functions, so a line-number fallback is unsafe.
  function indexFunctions(file, ast) {
    const result = new Map(), usedNames = new Map();
    let anonymous = 0;
    function visit(node, parent, owner) {
      let current = owner;
      if (isFunction(node)) {
        let name = node.id?.name;
        if (!name && parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') name = parent.id.name;
        if (!name && ['Property', 'MethodDefinition'].includes(parent?.type)) name = parent.key.name || String(parent.key.value);
        if (!name && parent?.type === 'ExportDefaultDeclaration') name = 'default';
        if (!name) name = '<callback' + (++anonymous) + '>';
        current = (owner ? owner + '/' : '') + name;
        const occurrence = usedNames.get(current) || 0;
        usedNames.set(current, occurrence + 1);
        result.set('fn:' + file + '#' + current + (occurrence ? '~' + occurrence : ''), node);
      }
      children(node).forEach(child => visit(child, node, current));
    }
    visit(ast, null, null);
    return result;
  }
  function callsIn(statement) {
    const result = [];
    function visit(node) {
      if (isFunction(node) || ['ImportDeclaration', 'ExportAllDeclaration'].includes(node.type)) return;
      // NewExpression also occupies a compiler call ordinal, even though its
      // constructor-return semantics are not interpreted by this analyzer.
      if (['CallExpression', 'NewExpression'].includes(node.type)) result.push(node);
      children(node).forEach(visit);
    }
    visit(statement);
    return result;
  }
  function callFor(edge, caller, blocks, fallbackNodes) {
    if (fallbackNodes.has(edge)) return fallbackNodes.get(edge);
    const block = blocks.get(edge.source);
    const statements = caller.ast.body.type === 'BlockStatement' ? caller.ast.body.body : [caller.ast.body];
    const statement = block && block.functionId === caller.id && statements[block.statementIndex];
    const prefix = block && 'call:' + block.id + ':';
    if (!statement || !edge.id.startsWith(prefix)) return null;
    const ordinal = edge.id.slice(prefix.length);
    if (!/^\d+$/.test(ordinal)) return null;
    const node = callsIn(statement)[Number(ordinal)];
    // The compiler's statement index and call ordinal recover the exact AST
    // node (and therefore offsets), rather than picking the last call on a line.
    if (!node || node.type !== 'CallExpression' || node.loc.start.line !== edge.sourceLocation.startLine || node.loc.end.line !== edge.sourceLocation.endLine) return null;
    return node;
  }
  function returnsOf(ast, file) {
    const returns = [];
    if (ast.body.type !== 'BlockStatement') returns.push({ argument:ast.body, source:source(file,ast.body) });
    else walk(ast.body, node => { if (node.type === 'ReturnStatement') returns.push({ argument:node.argument, source:source(file,node) }); }, true);
    const sources = returns.map(item => item.source);
    const unknown = reason => ({ type:'unknown', label:'未確定', guaranteed:false, shape:{kind:'unknown',booleanProperties:[]}, sources, reason, scope:'direct-return-syntax-only' });
    // async/generator calls return a Promise/iterator, not their return operand.
    // Await/iteration-aware contracts are outside this bounded observation.
    if (ast.async || ast.generator) return unknown('async-or-generator-wrapper');
    const tail = ast.body.type === 'BlockStatement' ? ast.body.body.at(-1) : null;
    const terminal = ast.body.type !== 'BlockStatement' || tail?.type === 'ReturnStatement';
    const operands = returns.map(item => item.argument);
    const objects = operands.filter(node => node?.type === 'ObjectExpression');
    const hasOk = node => {
      let knownBoolean = false;
      for (const property of node.properties) {
        if (property.type === 'SpreadElement' || property.computed) knownBoolean = false;
        else if ((property.key?.name || property.key?.value) === 'ok') {
          knownBoolean = property.kind === 'init' && !property.method && property.value?.type === 'Literal' && typeof property.value.value === 'boolean';
        }
      }
      return knownBoolean;
    };
    const result = (type,label,kind,booleanProperties=[]) => ({type,label,guaranteed:true,shape:{kind,booleanProperties},sources,reason:'direct-literal-returns',scope:'normal-return-shape-only'});
    if (terminal && returns.length && objects.length === returns.length && objects.every(hasOk)) return result('reservation-result','{ ok, … }','object',['ok']);
    if (terminal && returns.length && operands.every(n => n?.type === 'Literal' && typeof n.value === 'boolean')) return result('boolean-success','boolean','boolean');
    if (terminal && returns.length && objects.length === returns.length) return result('record','object','object');
    return unknown(terminal ? 'indirect-or-mixed-return-values' : 'possible-implicit-return');
  }
  function usageOf(ast, call, file) {
    let binding = null;
    const statements = ast.body.type === 'BlockStatement' ? ast.body.body : [];
    // A nested declaration can be out of scope at a later if. Restrict this
    // observation to a directly declared function-body local, without aliases.
    for (const statement of statements) if (statement.type === 'VariableDeclaration') for (const declaration of statement.declarations) {
      const init = declaration.init?.type === 'AwaitExpression' ? declaration.init.argument : declaration.init;
      if (declaration.id.type === 'Identifier' && init?.start === call.start) binding = declaration.id.name;
    }
    const unknown = reason => ({expected:'unknown',kind:'unknown',projection:null,binding,test:null,uses:[],reason});
    if (!binding) return unknown('no-direct-local-binding');
    const containsBinding = pattern => {
      if (!pattern) return false;
      if (pattern.type === 'Identifier') return pattern.name === binding;
      if (pattern.type === 'Property') return containsBinding(pattern.value);
      if (pattern.type === 'MemberExpression') return containsBinding(pattern.object);
      return children(pattern).some(containsBinding);
    };
    let reassigned = false, shadowed = false;
    const uses = [];
    walk(ast.body, node => {
      if (node.start > call.end && ((node.type === 'AssignmentExpression' && containsBinding(node.left)) || (node.type === 'UpdateExpression' && containsBinding(node.argument)))) reassigned = true;
      if (node.start > call.end && ((node.type === 'VariableDeclarator' && containsBinding(node.id)) || (node.type === 'CatchClause' && containsBinding(node.param)))) shadowed = true;
      if (node.type !== 'IfStatement' || node.start < call.end) return;
      let operand = node.test;
      const negated = operand.type === 'UnaryExpression' && operand.operator === '!';
      if (negated) operand = operand.argument;
      if (operand.type === 'Identifier' && operand.name === binding) uses.push({kind:'truthiness',projection:null,negated,test:node.test,source:source(file,node.test)});
      if (operand.type === 'MemberExpression' && !operand.computed && operand.object.type === 'Identifier' && operand.object.name === binding) uses.push({kind:'property-truthiness',projection:operand.property.name,negated,test:node.test,source:source(file,node.test)});
    }, true);
    if (reassigned || shadowed) return unknown(reassigned ? 'binding-or-property-reassigned' : 'binding-shadowed');
    if (!uses.length) return unknown('no-supported-if-use');
    if (uses.some(use => use.kind !== uses[0].kind || use.projection !== uses[0].projection || use.negated !== uses[0].negated)) return {...unknown('multiple-distinct-if-uses'),uses};
    // Truthiness is a language operation, not evidence of an intended boolean
    // success/failure protocol. Keep expected unknown even for an ok property.
    return {expected:'unknown',...uses[0],binding,uses,reason:'direct-local-if-use'};
  }
  function analyze(files, options = {}) {
    const parser = options.parser || globalThis.acorn;
    const compiler = options.compiler || globalThis.ScoreCompiler;
    // Reuse the compiler's parsed ASTs. Re-parsing the original upload would
    // bypass its file/character/depth/node rejection and duplicate parser work.
    const parsed = new Map();
    const recordingParser = parser && typeof parser.parse === 'function' ? {
      parse(text, settings) {
        const ast = parser.parse(text, settings);
        parsed.set(text, ast);
        return ast;
      }
    } : parser;
    const compiled = compiler.compileProject(files, { parser: recordingParser, maxFiles: 24, maxCharacters: 300000, maxFileCharacters: 150000, maxNodes: 18000, maxBlocks: 400 });
    const errors = compiled.diagnostics.filter(d => ['error', 'warning'].includes(d.severity) && ['input','syntax','unsupported-syntax','parser-unavailable','limit'].includes(d.kind));
    if (errors.some(error => !error.source?.file)) {
      return { version, functions: [], connections: [], diagnostics: compiled.diagnostics, errors, files, fingerprint: hash('rejected-input') };
    }
    const functions = [], fallbackCalls = [], fallbackNodes = new Map();
    const acceptedFiles = new Set(compiled.functions.map(fn => fn.source.file));
    const blocks = new Map(compiled.blocks.map(block => [block.id, block]));
    for (const file of Object.keys(files).sort()) {
      if (!acceptedFiles.has(file) || errors.some(e => e.source?.file === file)) continue;
      const ast = parsed.get(files[file]);
      if (!ast) continue;
      const bindings = new Map();
      for (const statement of ast.body) if (statement.type === 'ImportDeclaration') for (const specifier of statement.specifiers) {
        bindings.set(specifier.local.name, { file: pathJoin(file, statement.source.value), name: specifier.imported?.name || 'default' });
      }
      const nodes = indexFunctions(file, ast);
      for (const fn of compiled.functions.filter(fn => fn.source.file === file && !fn.name.includes('/') && !fn.name.startsWith('<'))) {
        const node = nodes.get(fn.id);
        if (!node) continue;
        const features = { reduce:0, loop:0, await:0, branch:0, arithmetic:0, writes:0, calls:0 };
        walk(node.body, n => {
          if (n.type === 'CallExpression') { features.calls++; if (n.callee.property?.name === 'reduce') features.reduce++; if (['set','delete','push'].includes(n.callee.property?.name)) features.writes++; }
          if (/^(For|While|DoWhile)/.test(n.type)) features.loop++;
          if (n.type === 'AwaitExpression') features.await++;
          if (['IfStatement','ConditionalExpression','SwitchStatement'].includes(n.type)) features.branch++;
          if (n.type === 'BinaryExpression' && ['+','-','*','/','%'].includes(n.operator)) features.arithmetic++;
        });
        const called = compiled.edges.filter(e => e.kind === 'call' && e.sourceFunction === fn.id && e.status === 'resolved' && e.targetFile !== file);
        let defaults = 0;
        for (const param of node.params) walk(param, n => {
          if (n.type === 'AssignmentPattern' && n.left.type === 'Identifier' && n.right.type === 'Identifier' && bindings.has(n.right.name)) {
            const target = bindings.get(n.right.name);
            walk(node.body, call => { if (call.type === 'CallExpression' && call.callee.type === 'Identifier' && call.callee.name === n.left.name) { defaults++; fallbackCalls.push({ callerId:fn.id, target, call }); } }, true);
          }
        });
        const role = called.length + defaults >= 2 ? 'checkout' : features.writes && (features.loop || features.branch) ? 'inventory' : features.arithmetic || features.reduce ? 'pricing' : features.await ? 'inventory' : 'utility';
        const style = features.reduce ? '集約するフレーズ' : features.loop ? '一歩ずつ刻むフレーズ' : features.await ? '待って応えるフレーズ' : features.branch ? '問いと応答のフレーズ' : '短く結ぶフレーズ';
        const roleLabels = {checkout:'複数の外部呼出し',inventory:features.writes && (features.loop || features.branch)?'更新名の呼出しと制御構造':'await を含む構造',pricing:'算術または reduce',utility:'その他の構造'};
        functions.push({ id:fn.id, name:fn.name, role, roleMetadata:{basis:'syntax-heuristic',label:roleLabels[role],businessRole:null,author:null,quality:null}, file, source:source(file,node), ast:node, fingerprint:hash(JSON.stringify(canonical(node))), blocks:statementBlocks(fn,node,file), features, style, returns:returnsOf(node,file), code:files[file].slice(node.start,node.end) });
      }
    }
    for (const fallback of fallbackCalls) {
      const target = functions.find(fn => fn.file === fallback.target.file && fn.name === fallback.target.name);
      if (target) {
        const baseId = 'default:' + fallback.callerId + ':' + target.id;
        const duplicate = compiled.edges.filter(edge => edge.id === baseId || edge.id.startsWith(baseId + ':occurrence:')).length;
        const edge = { id:baseId + (duplicate ? ':occurrence:' + duplicate : ''), kind:'call', status:'resolved', sourceFunction:fallback.callerId, targetFunction:target.id, sourceLocation:source(functions.find(fn=>fn.id===fallback.callerId).file,fallback.call), resolution:'default-argument' };
        compiled.edges.push(edge);
        fallbackNodes.set(edge, fallback.call);
      }
    }
    const connections = [];
    for (const edge of compiled.edges.filter(e => e.kind === 'call' && e.status === 'resolved')) {
      const caller = functions.find(fn => fn.id === edge.sourceFunction), callee = functions.find(fn => fn.id === edge.targetFunction);
      if (!caller || !callee || caller.id === callee.id) continue;
      const call = callFor(edge, caller, blocks, fallbackNodes);
      if (!call) continue;
      const usage = usageOf(caller.ast, call, caller.file);
      const callSource = source(caller.file,call), useSource = usage.test ? source(caller.file,usage.test) : null;
      const wholeWithOk = usage.kind === 'truthiness' && callee.returns.type === 'reservation-result';
      const projected = usage.kind === 'property-truthiness' && usage.projection === 'ok' && callee.returns.type === 'reservation-result';
      const shapeText = callee.returns.guaranteed ? '直接書かれた返り値は ' + callee.returns.label + ' です。' : '返り値の形はこの解析では未確定です。';
      const useText = usage.kind === 'truthiness' ? '呼ぶ側は受け取った値全体を if の真偽判定に使っています。' : usage.kind === 'property-truthiness' ? '呼ぶ側は受け取った値の ' + usage.projection + ' を if の真偽判定に使っています。' : '受け取った値の利用は、この限定した if 解析では未確定です。';
      const sourceBlock = caller.blocks.find(block => block.source.start <= call.start && block.source.end >= call.end);
      connections.push({ id:edge.id, source:caller.id, target:callee.id, callerName:caller.name, calleeName:callee.name, expected:'unknown', provided:callee.returns.type, providedShape:callee.returns.shape, projection:usage.projection, resolution:edge.resolution || 'direct', line:(useSource || callSource).startLine, sourceLocation:useSource || callSource, targetLocation:callee.source, callerSource:useSource || callSource, calleeSource:callee.source,
        callSource, useSource, useSources:usage.uses.map(use => use.source), returnSources:callee.returns.sources, callAst:call, sourceBlockId:sourceBlock?.id || null,
        usageKind:usage.kind, usageReason:usage.reason, usageNegated:usage.negated ?? null, uses:usage.uses.map(({test,...use}) => use), binding:usage.binding,
        // These are observations, never a proof of a broken or correct contract.
        review:false, projected, correctness:'unknown', questionKind:wholeWithOk ? 'whole-value-with-ok' : usage.kind === 'property-truthiness' ? 'property-use' : 'handoff',
        observation:shapeText + useText,
        question:wholeWithOk ? 'ここで確かめたいのは値の存在ですか、それとも ok の値ですか？ 意図を仕様やテストで確認してください。' : usage.kind === 'property-truthiness' ? usage.projection + ' による分岐の向きは、この呼出しの仕様と合っていますか？' : 'この受け渡しで、どんな値と利用方法を想定していますか？' });
    }
    return { version, functions: functions.sort((a,b) => a.id.localeCompare(b.id)), connections, diagnostics:compiled.diagnostics, errors, files, fingerprint:hash(JSON.stringify(Object.keys(files).sort().map(file => [file,files[file]]))) };
  }
  function compare(before, after) {
    return after.functions.map(fn => { const old = before.functions.find(item => item.id === fn.id); return { id:fn.id, file:fn.file, name:fn.name, status:!old?'added':old.fingerprint === fn.fingerprint?'unchanged':'changed', before:old, after:fn }; });
  }
  function investigate(model, connectionId) {
    const connection = model.connections.find(item => item.id === connectionId);
    if (!connection) return {facts:[],unknowns:['指定された接点は現在の解析結果にありません。'],question:'現在のコードから接点を選び直してください。',nextSources:[]};
    const facts = [{text:connection.callerName + ' から ' + connection.calleeName + ' への静的な呼出しを解決しました。',source:connection.callSource}];
    for (const at of connection.returnSources) {
      const code = model.files[at.file];
      const excerpt = typeof code === 'string' ? code.slice(at.start,at.end).replace(/\s+/g,' ').slice(0,180) : '';
      facts.push({text:'返り値の原文: ' + excerpt,source:at});
    }
    for (const use of connection.uses) facts.push({text:use.kind === 'truthiness' ? '受け取った値全体を if の真偽判定に使っています。' : '受け取った値の ' + use.projection + ' を if の真偽判定に使っています。',source:use.source});
    const unknowns = ['期待する契約と、この分岐が業務上正しいかは未確認です。','入力値、選択される実行経路、実行結果は確認していません。'];
    if (connection.providedShape.kind === 'unknown') unknowns.push('直接記述以外の返り値、暗黙の返却、Promise／iterator の内容は追跡していません。');
    if (connection.usageKind === 'unknown') unknowns.push('利用の追跡範囲外です: ' + connection.usageReason + '。');
    if (connection.resolution === 'default-argument') unknowns.push('引数を省略した場合の既定の接続です。別の関数を渡す実行は未確認です。');
    const nextSources = [...new Map([connection.callSource,...connection.returnSources,...connection.useSources].filter(Boolean).map(at => [at.file + ':' + at.start + ':' + at.end,at])).values()];
    return {facts,unknowns,question:connection.question,nextSources};
  }
  function changedLines(before, after) {
    const a = before.split('\n'), b = after.split('\n');
    if (a.length * b.length > 400000) return new Set(b.map((_, i) => i+1));
    const table = Array.from({length:a.length+1},() => new Uint16Array(b.length+1));
    for (let i=a.length-1;i>=0;i--) for(let j=b.length-1;j>=0;j--) table[i][j]=a[i]===b[j]?1+table[i+1][j+1]:Math.max(table[i+1][j],table[i][j+1]);
    const same = new Set(); let i=0,j=0;
    while(i<a.length && j<b.length) { if(a[i]===b[j]) { same.add(j+1);i++;j++; } else if(table[i+1][j]>=table[i][j+1]) i++; else j++; }
    return new Set(b.map((_,index)=>index+1).filter(line=>!same.has(line)));
  }
  return { analyze, compare, investigate, changedLines, hash, version };
});
