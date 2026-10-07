import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import ts from 'typescript';

type Span = { file_id: string; path: string; start_line: number; end_line: number };
type Unit = {
  unit_id: string;
  symbol_id: string;
  label: string;
  primary_span: Span;
  calls: string[];
  start_offset: number;
  end_offset: number;
  parent_unit_id?: string;
};
const id = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

export function createSnapshotProgram(input: { snapshot_id: string; sources: Record<string, string> }) {
  const virtual = new Map<string, ts.SourceFile>();
  const absolute = (path: string) => posix.normalize(`/snapshot/${path}`);
  for (const [path, source] of Object.entries(input.sources)) {
    if (/\.tsx?$/.test(path))
      virtual.set(
        absolute(path),
        ts.createSourceFile(
          absolute(path),
          source,
          ts.ScriptTarget.Latest,
          true,
          path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        ),
      );
  }
  const resolve = (moduleName: string, containingFile: string): ts.ResolvedModule | undefined => {
    if (!moduleName.startsWith('.')) return undefined;
    const target = posix.resolve(posix.dirname(containingFile), moduleName).replace(/\.js$/, '');
    const resolved = [
      target,
      `${target}.ts`,
      `${target}.tsx`,
      `${target}/index.ts`,
      `${target}/index.tsx`,
    ].find((path) => virtual.has(path));
    return resolved ? { resolvedFileName: resolved } : undefined;
  };
  const host: ts.CompilerHost = {
    getSourceFile: (name) => virtual.get(name),
    getDefaultLibFileName: () => '/snapshot/no-library.d.ts',
    writeFile: () => {
      throw new Error('EMIT_NOT_ALLOWED');
    },
    getCurrentDirectory: () => '/snapshot',
    getDirectories: () => [],
    fileExists: (name) => virtual.has(name),
    readFile: (name) => virtual.get(name)?.text,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    resolveModuleNames: (names, containingFile) => names.map((name) => resolve(name, containingFile)),
  };
  const program = ts.createProgram(
    [...virtual.keys()],
    { noEmit: true, noLib: true, module: ts.ModuleKind.ESNext },
    host,
  );
  return { program, virtual, absolute, resolve };
}

export function indexSnapshot(input: { snapshot_id: string; sources: Record<string, string> }) {
  const { program, virtual, absolute, resolve } = createSnapshotProgram(input);
  const checker = program.getTypeChecker();
  const files = [],
    units: Unit[] = [],
    nodes = new Map<ts.Node, Unit>();
  const calls: { caller: string; expression: ts.Expression }[] = [];
  const functionLike = (node: ts.Node) =>
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node);
  for (const [path, source] of Object.entries(input.sources).sort()) {
    const fileId = `file_${id(path)}`;
    const isSource = /\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$|(^|\/)tests?\//.test(path);
    const file = virtual.get(absolute(path));
    const imports =
      file?.statements.filter(ts.isImportDeclaration).map((node) => ({
        module: (node.moduleSpecifier as ts.StringLiteral).text,
        resolved: !!resolve((node.moduleSpecifier as ts.StringLiteral).text, file.fileName),
        path:
          resolve((node.moduleSpecifier as ts.StringLiteral).text, file.fileName)?.resolvedFileName.replace(
            '/snapshot/',
            '',
          ) ?? null,
      })) ?? [];
    files.push({
      file_id: fileId,
      path,
      lines: source.split('\n').length,
      is_source: isSource,
      parse_errors:
        (file as (ts.SourceFile & { parseDiagnostics?: unknown[] }) | undefined)?.parseDiagnostics?.length ??
        0,
      imports,
    });
    if (!isSource || !file) continue;
    function visit(node: ts.Node, parentUnitId?: string) {
      let owner = parentUnitId;
      if (functionLike(node) && (node as ts.FunctionLikeDeclaration).body) {
        const start = file!.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        const end = file!.getLineAndCharacterOfPosition(node.end).line + 1;
        const name =
          (node as ts.FunctionDeclaration).name?.getText(file) ??
          (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(file) : `anonymous_${start}`);
        let unitId = `unit_${id(`${input.snapshot_id}:${path}:${node.kind}:${start}:${end}`)}`;
        if (units.some((unit) => unit.unit_id === unitId))
          unitId = `unit_${id(`${input.snapshot_id}:${path}:${node.kind}:${node.pos}:${node.end}`)}`;
        const unit: Unit = {
          unit_id: unitId,
          symbol_id: unitId,
          label: name,
          primary_span: { file_id: fileId, path, start_line: start, end_line: end },
          calls: [],
          start_offset: node.getStart(file),
          end_offset: node.end,
          ...(parentUnitId ? { parent_unit_id: parentUnitId } : {}),
        };
        owner = unitId;
        units.push(unit);
        nodes.set(node, unit);
        if (ts.isVariableDeclaration(node.parent)) nodes.set(node.parent, unit);
        function readCalls(child: ts.Node) {
          if (functionLike(child)) return;
          if (ts.isCallExpression(child)) {
            unit.calls.push(child.expression.getText(file));
            calls.push({ caller: unitId, expression: child.expression });
          }
          ts.forEachChild(child, readCalls);
        }
        ts.forEachChild(node, readCalls);
      }
      ts.forEachChild(node, (child) => visit(child, owner));
    }
    visit(file);
  }
  const relations = calls.map((call) => {
    let symbol = checker.getSymbolAtLocation(
      ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression,
    );
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const targets =
      symbol?.declarations
        ?.map((declaration) => nodes.get(declaration))
        .filter((unit): unit is Unit => !!unit) ?? [];
    return {
      caller: call.caller,
      callee: targets.length === 1 ? targets[0].unit_id : null,
      name: call.expression.getText(),
      resolved: targets.length === 1,
    };
  });
  return { files, units, relations };
}
