import { useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Folder } from 'lucide-react';
type TreeNode = { name: string; path: string; children: TreeNode[] };
export function sourceTree(paths: string[]) {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const path of paths.sort()) {
    let parent = root;
    const parts = path.split('/');
    parts.forEach((name, index) => {
      const joined = parts.slice(0, index + 1).join('/');
      let node = parent.children.find((child) => child.path === joined);
      if (!node) {
        node = { name, path: joined, children: [] };
        parent.children.push(node);
      }
      parent = node;
    });
  }
  return root.children;
}
export function DirectoryTree({
  nodes,
  selected,
  select,
  concernPaths,
  inspectedPaths,
  recordedPaths,
  depth = 0,
}: {
  nodes: TreeNode[];
  selected: string;
  select: (path: string) => void;
  concernPaths: Set<string>;
  inspectedPaths?: Set<string>;
  recordedPaths?: Set<string>;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  return (
    <ul className="directory-tree">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.children.length ? (
            <>
              <button
                className="directory-row"
                style={{ paddingLeft: 10 + depth * 12 }}
                aria-expanded={!collapsed.includes(node.path)}
                onClick={() =>
                  setCollapsed(
                    collapsed.includes(node.path)
                      ? collapsed.filter((path) => path !== node.path)
                      : [...collapsed, node.path],
                  )
                }
              >
                {collapsed.includes(node.path) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <Folder size={13} />
                <span>{node.name}</span>
              </button>
              {!collapsed.includes(node.path) && (
                <DirectoryTree
                  nodes={node.children}
                  selected={selected}
                  select={select}
                  concernPaths={concernPaths}
                  inspectedPaths={inspectedPaths}
                  recordedPaths={recordedPaths}
                  depth={depth + 1}
                />
              )}
            </>
          ) : (
            <button
              className={`tree-file ${node.path === selected ? 'selected' : ''}`}
              style={{ paddingLeft: 25 + depth * 12 }}
              title={`${node.path}${inspectedPaths && !inspectedPaths.has(node.path) ? ' · 演奏対象外の参考コード' : ''}`}
              onClick={() => select(node.path)}
            >
              <FileCode2 size={13} />
              <span>{node.name}</span>
              {inspectedPaths && !inspectedPaths.has(node.path) && (
                <span className="source-context-badge" aria-hidden="true">
                  {recordedPaths && !recordedPaths.has(node.path) ? '未解析' : '参考'}
                </span>
              )}
              {concernPaths.has(node.path) && <i className="concern-dot" />}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
