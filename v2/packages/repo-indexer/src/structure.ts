import ts from 'typescript';
import { createHash } from 'node:crypto';
import { createSnapshotProgram, indexSnapshot } from './indexer';
import type {
  SyntaxEvent,
  SyntaxProjection,
  StructureComparison,
  StructureRow,
} from '../../contracts/StructureComparison';
import { structureHash } from '../../groove-core/src/structure';

type Input = { snapshot_id: string; sources: Record<string, string> };
const isFunction = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

// Only parser trivia is removed. Names, keys, literal spelling and operators are preserved.
function canonical(node: ts.Node, source: ts.SourceFile): string {
  if (isFunction(node))
    return `Function(${
      ts.canHaveModifiers(node)
        ? (ts
            .getModifiers(node)
            ?.map((m) => ts.SyntaxKind[m.kind])
            .join(',') ?? '')
        : ''
    };${node.name?.getText(source) ?? ''};${node.typeParameters?.map((p) => canonical(p, source)).join(',') ?? ''};${node.parameters.map((p) => canonical(p, source)).join(',')};${node.type ? canonical(node.type, source) : ''})`;
  const children: string[] = [];
  ts.forEachChild(node, (child) => {
    children.push(canonical(child, source));
  });
  return `${ts.SyntaxKind[node.kind]}(${children.length ? children.join(',') : node.getText(source)})`;
}

export function extractSyntax(input: Input, unitId: string): SyntaxProjection {
  const index = indexSnapshot(input);
  const unit = index.units.find((u) => u.unit_id === unitId);
  if (!unit) throw new Error('INVALID_SELECTION');
  const path = unit.primary_span.path;
  const { program, virtual, absolute } = createSnapshotProgram(input);
  const source = virtual.get(absolute(path))!;
  const checker = program.getTypeChecker();
  let selected: ts.FunctionLikeDeclaration | undefined;
  function locate(node: ts.Node) {
    if (isFunction(node) && node.getStart(source) === unit!.start_offset && node.end === unit!.end_offset)
      selected = node;
    ts.forEachChild(node, locate);
  }
  locate(source);
  const location = (node: ts.Node) => {
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    const end = source.getLineAndCharacterOfPosition(node.end);
    return {
      path,
      start_line: start.line + 1,
      end_line: end.line + 1,
      start_column: start.character + 1,
      end_column: end.character + 1,
      start_offset: node.getStart(source),
      end_offset: node.end,
    };
  };
  if (!selected) throw new Error('INVALID_SELECTION');
  const projection: SyntaxProjection = {
    snapshot_id: input.snapshot_id,
    source_hash: digest(input.sources[path]),
    unit_id: unitId,
    label: unit.label,
    location: location(selected),
    signature: canonical(selected, source),
    extraction_version: 'ts-syntax-v1',
    normalization_version: 'ast-trivia-only-v1',
    status: 'ok',
    diagnostics: [],
    events: [],
  };
  if (
    path.endsWith('.tsx') ||
    selected.end - selected.getStart(source) > 16000 ||
    projection.location.end_line - projection.location.start_line >= 160
  ) {
    return {
      ...projection,
      status: 'out_of_scope',
      diagnostics: ['初版は160行未満・16,000文字以内のTypeScript関数（.ts）。TSXは未対応。'],
    };
  }
  const errors = (source as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (errors.length)
    return {
      ...projection,
      status: 'parse_failed',
      diagnostics: errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n')),
    };
  const event = (
    node: ts.Node,
    kind: SyntaxEvent['kind'],
    syntax: string,
    parent: string | null,
    depth: number,
    context: string,
    label = node.getText(source).slice(0, 100),
  ): SyntaxEvent => {
    const row: SyntaxEvent = {
      event_id: `syntax_${digest(`${unitId}:${node.getStart(source)}:${node.kind}`).slice(0, 24)}`,
      kind,
      order: projection.events.length,
      parent_id: parent,
      depth,
      context,
      syntax,
      shape: `${kind}:${context}`,
      location: location(node),
      call_key: null,
      call_identity: null,
      label,
    };
    if (kind === 'call' && ts.isCallExpression(node)) {
      const expression = node.expression;
      let symbol = checker.getSymbolAtLocation(
        ts.isPropertyAccessExpression(expression) ? expression.name : expression,
      );
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const declarations = symbol?.declarations ?? [];
      // Resolve only a single immutable function declaration/binding. Mutable receivers stay uncertain.
      const declaration = declarations.length === 1 ? declarations[0] : undefined;
      const binding =
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        isFunction(declaration.initializer) &&
        ts.isVariableDeclarationList(declaration.parent) &&
        !!(declaration.parent.flags & ts.NodeFlags.Const);
      const target =
        declaration && (ts.isFunctionDeclaration(declaration) || binding) && ts.isIdentifier(expression)
          ? declaration
          : undefined;
      if (target && virtual.has(target.getSourceFile().fileName)) {
        row.call_key = `target:${target.getSourceFile().fileName.replace('/snapshot/', '')}:${target.getStart()}:${target.name?.getText() ?? ''}`;
        row.call_identity = 'static_target';
      } else {
        row.call_key = `expression:${canonical(expression, source)}`;
        row.call_identity = 'same_expression';
      }
    }
    projection.events.push(row);
    return row;
  };
  function visit(node: ts.Node, parent: string | null, depth: number, context: string) {
    if (isFunction(node)) {
      event(
        node,
        'function_boundary',
        canonical(node, source),
        parent,
        depth,
        context,
        '別の関数単位（本体を展開しない）',
      );
      return;
    }
    let current: SyntaxEvent | undefined;
    if (ts.isIfStatement(node)) {
      current = event(node, 'branch', canonical(node.expression, source), parent, depth, context);
      visit(node.expression, current.event_id, depth + 1, `${context}/condition`);
      visit(node.thenStatement, current.event_id, depth + 1, `${context}/then`);
      if (node.elseStatement) visit(node.elseStatement, current.event_id, depth + 1, `${context}/else`);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      current = event(node, 'branch', canonical(node, source), parent, depth, context);
      visit(node.condition, current.event_id, depth + 1, `${context}/condition`);
      visit(node.whenTrue, current.event_id, depth + 1, `${context}/whenTrue`);
      visit(node.whenFalse, current.event_id, depth + 1, `${context}/whenFalse`);
      return;
    }
    if (
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    ) {
      const headers: string[] = [];
      ts.forEachChild(node, (child) => {
        if (child !== node.statement) headers.push(canonical(child, source));
      });
      current = event(
        node,
        'loop',
        `${ts.SyntaxKind[node.kind]}(${headers.join(',')})`,
        parent,
        depth,
        context,
      );
    } else if (ts.isBlock(node)) current = event(node, 'block', '{}', parent, depth, context, 'ブロック');
    else if (ts.isCallExpression(node))
      current = event(node, 'call', canonical(node, source), parent, depth, context);
    else if (ts.isVariableDeclaration(node))
      current = event(
        node,
        'declaration',
        `${ts.isVariableDeclarationList(node.parent) ? node.parent.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let) : 0}:${canonical(node, source)}`,
        parent,
        depth,
        context,
      );
    else if (
      (ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      ts.isPostfixUnaryExpression(node) ||
      (ts.isPrefixUnaryExpression(node) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator))
    )
      current = event(node, 'assignment', canonical(node, source), parent, depth, context);
    else if (ts.isReturnStatement(node))
      current = event(node, 'return', canonical(node, source), parent, depth, context);
    else if (ts.isThrowStatement(node))
      current = event(node, 'throw', canonical(node, source), parent, depth, context);
    else if (
      ts.isStatement(node) &&
      !ts.isVariableStatement(node) &&
      !ts.isExpressionStatement(node) &&
      !ts.isEmptyStatement(node)
    ) {
      event(node, 'unsupported', canonical(node, source), parent, depth, context);
      projection.diagnostics.push(`未対応構文 ${ts.SyntaxKind[node.kind]}:${location(node).start_line}`);
      return;
    } else if (
      ts.isExpressionStatement(node) &&
      !ts.isCallExpression(node.expression) &&
      !(
        ts.isBinaryExpression(node.expression) &&
        node.expression.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.expression.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) &&
      !ts.isPostfixUnaryExpression(node.expression) &&
      !ts.isPrefixUnaryExpression(node.expression)
    ) {
      event(node, 'unsupported', canonical(node, source), parent, depth, context);
      projection.diagnostics.push(`未対応の式文:${location(node).start_line}`);
      return;
    }
    ts.forEachChild(node, (child) =>
      visit(child, current?.event_id ?? parent, depth + (current ? 1 : 0), context),
    );
  }
  if (selected.body) {
    if (ts.isBlock(selected.body)) {
      if (selected.body.statements.length) visit(selected.body, null, 0, 'body');
    } else {
      const returned = event(
        selected.body,
        'return',
        canonical(selected.body, source),
        null,
        0,
        'body',
        '式本体（暗黙のreturn）',
      );
      visit(selected.body, returned.event_id, 1, 'body');
    }
  }
  if (projection.events.length > 512)
    return {
      ...projection,
      events: [],
      status: 'out_of_scope',
      diagnostics: ['構文イベントは512個以内。抽出結果は切り捨てません。'],
    };
  projection.status = projection.diagnostics.length
    ? 'unsupported'
    : projection.events.length
      ? 'ok'
      : 'empty';
  return projection;
}

export function alignSyntax(a: SyntaxProjection, b: SyntaxProjection): StructureComparison {
  const rows: StructureRow[] = [];
  const key = (e: SyntaxEvent) => `${e.shape}:${e.depth}:${e.syntax}`;
  const candidates = a.events.flatMap((e, i) => {
    const peers = b.events.map((p, j) => (key(e) === key(p) ? j : -1)).filter((j) => j >= 0);
    return peers.length === 1 && a.events.filter((p) => key(p) === key(e)).length === 1
      ? [{ a: i, b: peers[0] }]
      : [];
  });
  // An exact anchor is reliable only when no other unique exact anchor reverses it.
  const anchors = candidates.filter((c, i) =>
    candidates.every((d, j) => i === j || (j < i ? d.b < c.b : d.b > c.b)),
  );
  const push = (ea: SyntaxEvent | undefined, eb: SyntaxEvent | undefined, status: StructureRow['status']) =>
    rows.push({
      row_id: `row_${rows.length}`,
      a: ea?.event_id ?? null,
      b: eb?.event_id ?? null,
      status: ea?.kind === 'unsupported' || eb?.kind === 'unsupported' ? 'unsupported' : status,
    });
  let ai = 0,
    bi = 0;
  for (const anchor of [...anchors, { a: a.events.length, b: b.events.length }]) {
    const left = a.events.slice(ai, anchor.a),
      right = b.events.slice(bi, anchor.b);
    const bounded =
      anchors.length > 0 && ![a, b].some((p) => ['parse_failed', 'out_of_scope'].includes(p.status));
    if (
      left.length === 1 &&
      right.length === 1 &&
      left[0].shape === right[0].shape &&
      left[0].depth === right[0].depth
    )
      push(left[0], right[0], 'different');
    else {
      left.forEach((e) => push(e, undefined, !right.length && bounded ? 'absent' : 'unknown'));
      right.forEach((e) => push(undefined, e, !left.length && bounded ? 'absent' : 'unknown'));
    }
    if (anchor.a < a.events.length) push(a.events[anchor.a], b.events[anchor.b], 'equal');
    ai = anchor.a + 1;
    bi = anchor.b + 1;
  }
  return {
    comparison_id: `comparison_${structureHash({ a, b, version: 'unique-monotone-v1' }).slice(0, 32)}`,
    alignment_version: 'unique-monotone-v1',
    a,
    b,
    rows,
  };
}

export function compareStructure(input: Input, a: string, b: string) {
  if (a === b) throw new Error('INVALID_SELECTION');
  return alignSyntax(extractSyntax(input, a), extractSyntax(input, b));
}
