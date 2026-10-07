import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('development and music tests never import executable analyzed fixture repositories', () => {
  function files(path: string): string[] {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory() ? files(child) : /\.tsx?$/.test(entry.name) ? [child] : [];
    });
  }
  for (const path of [...files('apps/web/src'), ...files('packages')]) {
    const tree = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const imported: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
        imported.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(tree) === 'require') &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        imported.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(tree);
    expect(
      imported.filter((name) => name.includes('fixtures/repos/')),
      path,
    ).toEqual([]);
  }
});
