/* Source-based prose about code, not a quality score or a claim about its sound. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StoryCritique = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const functionTypes = new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
  function children(node) {
    return Object.entries(node || {}).filter(([key]) => !['loc','start','end'].includes(key)).flatMap(([,value]) =>
      Array.isArray(value) ? value.filter(item => item && typeof item.type === 'string') : value && typeof value.type === 'string' ? [value] : []);
  }
  function nodes(root) {
    const result = [];
    function visit(node, first) {
      if (!node || (!first && functionTypes.has(node.type))) return;
      result.push(node); children(node).forEach(child => visit(child, false));
    }
    visit(root, true); return result;
  }
  function at(file, node) {
    return node?.loc ? {file,startLine:node.loc.start.line,endLine:node.loc.end.line,startColumn:node.loc.start.column,endColumn:node.loc.end.column,start:node.start,end:node.end} : null;
  }
  function validSource(model, source) {
    const code = source && model?.files?.[source.file];
    return typeof code === 'string' && Number.isInteger(source.startLine) && Number.isInteger(source.endLine) && source.startLine >= 1 && source.endLine >= source.startLine && source.endLine <= code.split('\n').length;
  }
  function excerpt(model, source, limit = 140) {
    if (!validSource(model, source)) return '';
    const code = model.files[source.file];
    const raw = Number.isInteger(source.start) && Number.isInteger(source.end) && source.start >= 0 && source.end <= code.length
      ? code.slice(source.start,source.end) : code.split('\n').slice(source.startLine-1,source.endLine).join('\n');
    const text = raw.replace(/\s+/g,' ').trim();
    return text.length > limit ? text.slice(0,limit) + '…' : text;
  }
  function quote(model, file, node) { const text = excerpt(model, at(file,node)); return text ? '「' + text + '」' : 'この記述'; }
  function returnsOf(fn) {
    if (!fn?.ast || fn.ast.async || fn.ast.generator) return [];
    return fn.ast.body.type === 'BlockStatement' ? nodes(fn.ast.body).filter(node => node.type === 'ReturnStatement').map(node => ({node,value:node.argument})) : [{node:fn.ast.body,value:fn.ast.body}];
  }
  function literalFields(object) {
    if (object?.type !== 'ObjectExpression' || object.properties.some(property => property.type === 'SpreadElement' || property.computed)) return new Map();
    const fields = new Map();
    for (const property of object.properties) {
      const name = property.key?.name ?? property.key?.value;
      if (name === undefined) continue;
      if (property.kind === 'init' && !property.method && property.value?.type === 'Literal' && !property.value.regex) fields.set(String(name),property.value);
      else fields.delete(String(name));
    }
    return fields;
  }
  function literalKey(node) { return JSON.stringify([typeof node.value,typeof node.value === 'bigint' ? String(node.value) : node.value]); }
  function commonFields(fn) {
    const returned = returnsOf(fn);
    if (!returned.length || returned.some(item => item.value?.type !== 'ObjectExpression')) return new Map();
    const fields = literalFields(returned[0].value);
    for (const item of returned.slice(1)) {
      const other = literalFields(item.value);
      for (const [key,value] of fields) if (!other.has(key) || literalKey(value) !== literalKey(other.get(key))) fields.delete(key);
    }
    return fields;
  }
  function canonical(node, hiddenCall) {
    if (node === null || node === undefined) return null;
    if (Array.isArray(node)) return node.map(item => canonical(item, hiddenCall));
    if (typeof node !== 'object') return typeof node === 'bigint' ? String(node) + 'n' : node;
    const isCall = hiddenCall && node.type === hiddenCall.type && node.start === hiddenCall.start && node.end === hiddenCall.end;
    return Object.keys(node).sort().filter(key => !['start','end','loc','raw'].includes(key)).map(key => [key,isCall && key === 'callee' ? '<selected-callee>' : canonical(node[key],hiddenCall)]);
  }
  function frame(model, connection) {
    if (!connection?.callAst) return null;
    const caller = model.functions.find(fn => fn.id === connection.source);
    const block = caller?.blocks?.find(item => item.id === connection.sourceBlockId);
    return JSON.stringify(canonical(block?.ast || connection.callAst,connection.callAst));
  }
  function review(model, fnId, connectionId, options = {}) {
    const functions = model?.functions || [];
    let connection = model?.connections?.find(item => item.id === connectionId);
    const fn = functions.find(item => item.id === fnId) || functions.find(item => item.id === connection?.source);
    if (!fn) return {heading:'読み取るコードを選ぶ',prose:'選択中の関数を解析結果に見つけられません。',relationship:'',question:'解析できた関数か接点を選んでください。',musicalMetaphor:'',soundStatus:'',sources:[]};
    if (connection && connection.source !== fn.id && connection.target !== fn.id) connection = null;
    const result = {heading:fn.name + ' の書き方',prose:'',relationship:'',question:'',musicalMetaphor:'',soundStatus:'',sources:[]};
    const add = (label,source) => {
      if (!validSource(model,source)) return;
      if (!result.sources.some(item => item.source.file === source.file && item.source.start === source.start && item.source.end === source.end)) result.sources.push({label,source});
    };
    const addNode = (label,node) => add(label,at(fn.file,node));
    const body = fn.ast?.body;
    const own = nodes(body), loop = own.find(node => /^(ForStatement|ForOfStatement|ForInStatement|WhileStatement|DoWhileStatement)$/.test(node.type));
    const reduce = own.find(node => node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.property.name === 'reduce');
    const branch = own.find(node => ['IfStatement','ConditionalExpression','SwitchStatement'].includes(node.type));
    const statements = body?.type === 'BlockStatement' ? body.body.filter(node => node.type !== 'EmptyStatement') : [];
    const direct = statements.length === 1 && statements[0].type === 'ReturnStatement' ? statements[0].argument : ['CallExpression','ObjectExpression'].includes(body?.type) ? body : null;
    if (loop) {
      const update = nodes(loop.body).find(node => node.type === 'AssignmentExpression' && node.operator === '+=');
      result.heading = '一つずつ進める反復';
      result.prose = update ? quote(model,fn.file,update) + ' を反復の中に置き、更新する手順を一つずつ見せる書き方です。' : quote(model,fn.file,loop) + ' で、同じ形の処理を繰り返す手順を一つずつ見せています。';
      result.question = '反復の対象と、途中で終える条件は意図した範囲になっていますか？';
      result.musicalMetaphor = '同じ型を刻む、ロックのリフのような書き味です。';
      addNode('反復の記述',loop); if (update) addNode('繰り返す更新',update);
    } else if (reduce) {
      const callback = reduce.arguments[0], inline = functionTypes.has(callback?.type);
      result.heading = '更新を一つの式へまとめる';
      result.prose = quote(model,fn.file,reduce) + ' と、処理を reduce の呼出しへまとめています。' + (inline ? 'コールバックの記述で、集約の更新を一つの句として読めます。' : 'コールバックの中身はこの式だけでは分からず、何を算出するかは断定できません。');
      result.question = inline ? '初期値と、各回に返す値の形はそろっていますか？' : '渡したコールバックは何を受け取り、次の回へ何を返しますか？';
      result.musicalMetaphor = '流れを一つの式につなぐ、レガートのような書き味です。';
      addNode('reduce の呼出し',reduce);
    } else if (direct?.type === 'CallExpression') {
      const returned = statements[0] || direct;
      const args = direct.arguments.map(node => excerpt(model,at(fn.file,node),70)).filter(Boolean).join(', ');
      result.heading = '相手へ委ねる短い関数';
      const target = excerpt(model,at(fn.file,direct.callee),70) || '呼出し先';
      result.prose = quote(model,fn.file,returned) + ' が処理の中心です。' + (args ? '引数として「' + args + '」を渡して ' : '引数なしで ') + target + ' に任せ、結果をそのまま返す。短く潔い書き方です。';
      result.question = 'この関数が渡す引数と、委譲先に任せる範囲は意図どおりですか？';
      result.musicalMetaphor = '一つの依頼と返答でまとまる、短い小品のような書きぶりです。';
      addNode('委譲と返却',returned);
    } else if (branch) {
      const condition = branch.test || branch.discriminant;
      result.heading = '条件を節目にする';
      result.prose = quote(model,fn.file,condition) + ' を節目に、処理を分けています。どちらへ進むかの意図を、この条件式から読ませる書き方です。';
      result.question = 'この条件で区別したい状態と、各分岐で返すものは対応していますか？';
      result.musicalMetaphor = '条件の問いで句を分ける、応答のある作風にたとえられます。';
      addNode('分岐の条件',condition);
    } else if (direct?.type === 'ObjectExpression' && direct.properties.every(p=>p.type==='Property'&&!p.computed)) {
      const fields=direct.properties.map(p=>String(p.key.name??p.key.value));
      result.heading='返す情報の形を、そのまま見せる';
      result.prose=fields.length?fields.join('、')+' を一つにまとめて返しています。処理の手順を重ねず、相手へ渡す情報の形を前面に出した書き方です。':'空のオブジェクトを、そのまま返す小さな関数です。';
      result.question='ここで固定する値と、入力から引き継ぐ値の分け方は意図どおりですか？';
      result.musicalMetaphor='一つの和音を置くように、返答の形を示す書き味です。';
      addNode('組み立てる返答',statements[0]||direct);
    } else {
      const first = statements[0] || body;
      result.prose = quote(model,fn.file,first) + (statements.length > 1 ? ' から始まる ' + statements.length + ' 文のまとまりです。記述された順序と、最後に渡す値を追って読めます。' : ' という小さなまとまりです。ここに書かれた値や式が、この関数の仕事の入口になります。');
      result.question = 'この記述が受け取る値と返す値を、呼ぶ側と共有できていますか？';
      result.musicalMetaphor = '';
      addNode('書き方の根拠',first);
    }
    if (!connection) return result;
    const caller = functions.find(item => item.id === connection.source), callee = functions.find(item => item.id === connection.target);
    const previous = options.previousModel;
    const old = previous?.connections?.find(item => item.id === options.previousConnectionId);
    const oldCallee = previous?.functions?.find(item => item.id === old?.target);
    const previousFn = previous?.functions?.find(item => item.id === (options.previousFunctionId || fn.id));
    add('呼ぶ箇所',connection.callSource); add('受け取った値を使う箇所',connection.useSource);
    (connection.returnSources || []).slice(0,3).forEach(source => add('相手が返す記述',source));
    result.relationship = (caller?.name || connection.callerName) + ' から ' + (callee?.name || connection.calleeName) + ' へ処理を渡しています。';
    if (old && old.target !== connection.target) {
      const sameFrame = frame(previous,old) !== null && frame(previous,old) === frame(model,connection);
      result.relationship = '呼ぶ相手が ' + old.calleeName + ' から ' + connection.calleeName + ' へ変わっています。' + (sameFrame ? '相手以外の呼出しを含む文の形は同じです。' : '呼出しを含む文にも差があります。');
      const beforeFields = commonFields(oldCallee), afterFields = commonFields(callee);
      const differences = [...afterFields].filter(([key,value]) => beforeFields.has(key) && literalKey(beforeFields.get(key)) !== literalKey(value)).slice(0,2);
      if (differences.length) result.relationship += ' return に書かれた値は ' + differences.map(([key,value]) => key + ': ' + excerpt(previous,at(oldCallee.file,beforeFields.get(key)),50) + ' → ' + excerpt(model,at(callee.file,value),50)).join('、') + ' です。';
    } else if (previousFn && previousFn.fingerprint !== fn.fingerprint) {
      result.relationship += '同じ関数でも、式や手順の書き方が変わっています。';
    }
    const shape = connection.providedShape || {}, whole = connection.usageKind === 'truthiness';
    const knownOk = shape.kind === 'object' && shape.booleanProperties?.includes('ok') && callee?.returns?.guaranteed;
    const returned = returnsOf(callee), hasNull = returned.some(item => item.value?.type === 'Literal' && item.value.value === null);
    const nullableObject = hasNull && returned.some(item => item.value?.type === 'ObjectExpression') && returned.every(item => item.value?.type === 'ObjectExpression' || item.value?.type === 'Literal' && item.value.value === null);
    const conditionText = excerpt(model,connection.useSource) || connection.binding || '受け取った値';
    if (whole && knownOk) {
      const falseReturn = returned.find(item => literalFields(item.value).get('ok')?.value === false);
      const outcome = connection.usageNegated ? '「' + conditionText + '」は false になり、ok の違いでこの分岐を選べません。' : '「' + conditionText + '」の真偽判定は true になり、ok の違いが条件に反映されません。';
      const changedReturn = old?.providedShape?.kind === 'boolean' && old.usageKind === 'truthiness';
      result.heading = changedReturn ? '返事は変わったが、受け取り方はそのまま' : '値の存在と ok の値を分けて読む';
      result.prose = (falseReturn ? quote(model,callee.file,falseReturn.node) + ' のように ok:false という返事でも、' : 'この形で仮に ok が false でも、') + outcome;
      if (changedReturn) result.relationship += '変更前の返り値は boolean、現在は { ok, … } です。呼ぶ側は値全体の判定のままです。';
      result.question = 'ここで確かめたいのは ok の値ですか、それとも返事の存在ですか？';
      result.musicalMetaphor = '返事の中身と受け取る側の問いが、すれ違って見える掛け合いです。';
      result.soundStatus = '現行の接点音は、この受取条件の差をまだ表しません。';
    } else if (whole && nullableObject) {
      result.heading = '見つかった値の有無を分ける';
      result.prose = '返す記述には object と null があり、呼ぶ側は「' + conditionText + '」で値の有無を分けています。オブジェクト内の属性の真偽と、その値が存在するかは別の問いです。';
      result.question = 'null を値がない状態として扱う仕様と、この分岐の向きは合っていますか？';
      result.musicalMetaphor = '返答があるかを節目にして、次の句へ進む書きぶりです。';
    } else if (connection.usageKind === 'property-truthiness') {
      result.prose += ' 接点では「' + conditionText + '」と、受け取った値の ' + connection.projection + ' を条件にしています。';
      result.question = connection.projection + ' で分ける状態と、分岐の向きは仕様に対応していますか？';
    }
    if (old && (old.usageKind !== connection.usageKind || old.projection !== connection.projection || JSON.stringify(old.providedShape) !== JSON.stringify(connection.providedShape))) result.soundStatus = '現行の接点音は、この受取条件の差をまだ表しません。';
    return result;
  }
  return Object.freeze({review});
});
