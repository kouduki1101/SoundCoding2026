import ts from 'typescript';
import { createHash } from 'node:crypto';
import { createSnapshotProgram, indexSnapshot } from './indexer';
import type { CallRelationships, StaticCallLink, Span } from '../../contracts/CallRelationships';

type Input = { snapshot_id: string; sources: Record<string, string>; unit_span: Span };
const functionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node);

export function callRelationships(input: Input): CallRelationships {
  const index = indexSnapshot(input);
  const matches = index.units.filter(
    (unit) =>
      unit.primary_span.path === input.unit_span.path &&
      unit.primary_span.start_line === input.unit_span.start_line &&
      unit.primary_span.end_line === input.unit_span.end_line,
  );
  if (matches.length !== 1) throw new Error('INVALID_SELECTION');
  const unit = matches[0];
  const { program, virtual, absolute } = createSnapshotProgram(input);
  const checker = program.getTypeChecker();
  const source = virtual.get(absolute(unit.primary_span.path))!;
  const span = (node: ts.Node): Span => ({
    file_id: index.files.find((file) => absolute(file.path) === node.getSourceFile().fileName)!.file_id,
    path: node.getSourceFile().fileName.replace('/snapshot/', ''),
    start_line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
    end_line: node.getSourceFile().getLineAndCharacterOfPosition(node.end).line + 1,
  });
  let selected: ts.FunctionLikeDeclaration | undefined;
  function locate(node: ts.Node) {
    if (functionLike(node) && node.getStart(source) === unit.start_offset && node.end === unit.end_offset)
      selected = node;
    ts.forEachChild(node, locate);
  }
  locate(source);
  if (!selected?.body) throw new Error('INVALID_SELECTION');
  const walk = (node: ts.Node, visit: (node: ts.Node) => void) => {
    if (functionLike(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) return;
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
  };
  const calls: ts.CallExpression[] = [];
  walk(selected.body, (node) => {
    if (ts.isCallExpression(node)) calls.push(node);
  });
  const links = calls.slice(0, 24).map((call): StaticCallLink => {
    const limitations: string[] = [];
    let symbol = ts.isIdentifier(call.expression) ? checker.getSymbolAtLocation(call.expression) : undefined;
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const definitions =
      symbol?.declarations?.flatMap((declaration) => {
        const value = ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration;
        return value && functionLike(value) && value.body ? [value] : [];
      }) ?? [];
    const target = definitions.length === 1 ? definitions[0] : undefined;
    const returns: Span[] = [];
    if (target?.body) {
      if (!ts.isBlock(target.body)) returns.push(span(target.body));
      else
        walk(target.body, (node) => {
          if (ts.isReturnStatement(node)) returns.push(span(node));
        });
    } else limitations.push('呼出先の定義は未解決です。動的な呼出先を推測しません。');
    let expression: ts.Node = call;
    while (ts.isAwaitExpression(expression.parent) || ts.isParenthesizedExpression(expression.parent))
      expression = expression.parent;
    const parent = expression.parent;
    const uses: Span[] = [];
    let binding: string | null = null;
    let useStatus: StaticCallLink['use_status'] = 'unresolved';
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === expression &&
      ts.isIdentifier(parent.name) &&
      ts.isVariableDeclarationList(parent.parent) &&
      parent.parent.flags & ts.NodeFlags.Const
    ) {
      binding = parent.name.text;
      useStatus = 'named_references';
      const bindingSymbol = checker.getSymbolAtLocation(parent.name);
      walk(selected!.body!, (node) => {
        if (!ts.isIdentifier(node) || node.getStart() <= parent.name.getStart()) return;
        const reference = ts.isShorthandPropertyAssignment(node.parent)
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
        if (reference === bindingSymbol) uses.push(span(node));
      });
      limitations.push('同じconst変数の静的参照です。参照先オブジェクトの変更や実行順は追跡しません。');
    } else if (!ts.isVariableDeclaration(parent) && !ts.isExpressionStatement(parent)) {
      uses.push(span(parent));
      useStatus = 'immediate_expression';
      limitations.push('呼出結果を含む式です。実行されたことや値の伝播は保証しません。');
    } else limitations.push('結果の利用は未確認です。再代入・分割代入・入れ子関数への伝播は追跡しません。');
    const uniqueUses = [
      ...new Map(uses.map((use) => [`${use.path}:${use.start_line}:${use.end_line}`, use])).values(),
    ];
    return {
      link_id: `link_${createHash('sha256').update(`${input.snapshot_id}:${unit.unit_id}:${call.getStart()}`).digest('hex').slice(0, 16)}`,
      name: call.expression.getText().slice(0, 160),
      call_span: span(call),
      callee_span: target ? span(target) : null,
      resolution: target ? 'static_definition' : 'unresolved',
      return_spans: returns.slice(0, 16) as StaticCallLink['return_spans'],
      result_binding: binding,
      use_spans: uniqueUses.slice(0, 16) as StaticCallLink['use_spans'],
      use_status: useStatus,
      truncated: returns.length > 16 || uniqueUses.length > 16,
      limitations: [
        'returnはすべて候補です。選ばれる経路・返却値・呼出回数は未確認です。',
        ...limitations,
      ] as StaticCallLink['limitations'],
    };
  });
  return {
    extraction_version: 'static-call-links-v1',
    snapshot_id: input.snapshot_id,
    unit_span: unit.primary_span,
    status: 'ready',
    links,
    truncated: calls.length > 24,
    limitations: [
      'TypeScript/TSXの静的な定義と直接のconst参照を表示します。メソッド・動的参照は未解決です。',
      '実行時の流れではありません。Agentが意味を調査していない範囲には旋律を追加しません。',
    ],
  };
}
