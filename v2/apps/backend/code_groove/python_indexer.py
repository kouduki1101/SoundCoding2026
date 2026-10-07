"""Trusted static parser, run in an isolated child process; never imports repository code."""

import ast
import hashlib
import json
import posixpath
import sys
from io import TextIOWrapper
from typing import Any, cast


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:16]


def index_python(snapshot_id: str, sources: dict[str, str]) -> dict:
    child: ast.AST
    files: list[dict[str, Any]] = []
    units: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    symbols, bindings, unit_nodes = {}, {}, {}
    for path, source in sorted(sources.items()):
        if not path.endswith(".py"):
            continue
        is_source = not ("/tests/" in f"/{path}" or posixpath.basename(path).startswith("test_"))
        file_id = f"file_{digest(path)}"
        file: dict[str, Any] = {
            "file_id": file_id,
            "path": path,
            "lines": len(source.splitlines()),
            "is_source": is_source,
            "parse_errors": 0,
            "imports": [],
        }
        files.append(file)
        try:
            tree = ast.parse(source, filename=path)
        except (SyntaxError, ValueError, RecursionError):
            file["parse_errors"] = 1
            continue

        def resolve_import(node, path=path, file=file):
            imported: dict[str, tuple[str | None, str]] = {}
            if isinstance(node, ast.Import):
                entries = [(alias, alias.name, 0, "") for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                entries = [(alias, node.module or "", node.level, alias.name) for alias in node.names]
            else:
                return imported
            for alias, module_name, level, symbol in entries:
                base = posixpath.dirname(path) if level else ""
                for _ in range(max(0, level - 1)):
                    base = posixpath.dirname(base)
                module = posixpath.join(base, module_name.replace(".", "/"))
                options = [module + ".py", module + "/__init__.py"]
                # A common src-layout is resolved only when its target is unambiguous.
                if not level:
                    options += ["src/" + option for option in options]
                targets = [option for option in options if option in sources]
                target = targets[0] if len(targets) == 1 else None
                imported_symbol = symbol
                if isinstance(node, ast.ImportFrom) and (not target or not module_name):
                    submodule = posixpath.join(module, symbol)
                    children = [p for p in (submodule + ".py", submodule + "/__init__.py") if p in sources]
                    if len(children) == 1:
                        target, imported_symbol = children[0], ""
                external = not level and module_name.split(".")[0] in sys.stdlib_module_names
                file["imports"].append(
                    {
                        "module": "." * level + module_name,
                        "resolved": bool(target),
                        "path": target,
                        "resolution": "local" if target else "external" if external else "unresolved_local",
                    }
                )
                imported[alias.asname or alias.name] = (target, imported_symbol)
            return imported

        global_bindings = {}
        for child in tree.body:
            global_bindings.update(resolve_import(child))
        bindings[path] = global_bindings
        if not is_source:
            continue

        def visit(
            node,
            prefix="",
            parent_id=None,
            class_name=None,
            scope_bindings=None,
            path=path,
            file_id=file_id,
            global_bindings=global_bindings,
        ):
            child: ast.AST
            current_bindings = dict(scope_bindings or global_bindings)
            if isinstance(node, ast.ClassDef):
                name = f"{prefix}.{node.name}" if prefix else node.name
                for child in node.body:
                    visit(child, name, parent_id, name, current_bindings)
                return
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                name = (
                    node.name
                    if not isinstance(node, ast.Lambda)
                    else f"lambda_{node.lineno}_{node.col_offset}"
                )
                label = f"{prefix}.{name}" if prefix else name
                start_line = min([node.lineno, *[d.lineno for d in getattr(node, "decorator_list", [])]])
                identity = f"{snapshot_id}:{path}:python:{node.lineno}:{node.end_lineno}"
                if isinstance(node, ast.Lambda):
                    identity += f":lambda:{node.col_offset}"
                unit_id = f"unit_{digest(identity)}"
                unit = {
                    "unit_id": unit_id,
                    "symbol_id": unit_id,
                    "label": label,
                    "primary_span": {
                        "file_id": file_id,
                        "path": path,
                        "start_line": start_line,
                        "end_line": node.end_lineno,
                    },
                    "calls": [],
                }
                if parent_id:
                    unit["parent_unit_id"] = parent_id
                units.append(unit)
                symbols[(path, label)] = unit_id
                # Collect this scope's imports, skipping nested definitions.
                pending = list(ast.iter_child_nodes(node))
                while pending:
                    child = pending.pop()
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                        continue
                    current_bindings.update(resolve_import(child))
                    pending.extend(ast.iter_child_nodes(child))
                unit_nodes[unit_id] = (node, class_name, label, current_bindings)
                for child in ast.iter_child_nodes(node):
                    visit(child, label, unit_id, class_name, current_bindings)
                return
            for child in ast.iter_child_nodes(node):
                visit(child, prefix, parent_id, class_name, current_bindings)

        for child in tree.body:
            visit(child)
    for unit in units:
        path = unit["primary_span"]["path"]
        node, class_name, label, scope_bindings = unit_nodes[unit["unit_id"]]
        stack: list[ast.AST] = [node.body] if isinstance(node, ast.Lambda) else list(node.body)
        while stack:
            child = stack.pop()
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                continue
            if isinstance(child, ast.Call):
                name = ast.unparse(child.func)[:160]
                target = None
                if isinstance(child.func, ast.Name):
                    imported_path, imported_name = scope_bindings.get(name, (path, name))
                    target = symbols.get((imported_path, imported_name))
                    if name not in scope_bindings:
                        lexical = label.split(".")
                        while lexical and not target:
                            target = symbols.get((path, ".".join([*lexical, name])))
                            lexical.pop()
                elif isinstance(child.func, ast.Attribute) and isinstance(child.func.value, ast.Name):
                    receiver = child.func.value.id
                    if receiver in ("self", "cls") and class_name:
                        target = symbols.get((path, f"{class_name}.{child.func.attr}"))
                    else:
                        imported_path, imported_name = scope_bindings.get(receiver, (path, receiver))
                        target = symbols.get(
                            (
                                imported_path,
                                f"{imported_name}.{child.func.attr}" if imported_name else child.func.attr,
                            )
                        )
                unit["calls"].append(name)
                relations.append(
                    {"caller": unit["unit_id"], "callee": target, "name": name, "resolved": bool(target)}
                )
            stack.extend(ast.iter_child_nodes(child))
    return {"files": files, "units": units, "relations": relations}


def python_relationships(snapshot_id: str, sources: dict[str, str], unit_span: dict) -> dict:
    index = index_python(snapshot_id, sources)
    matches = [u for u in index["units"] if u["primary_span"] == unit_span]
    if len(matches) != 1:
        raise ValueError("INVALID_SELECTION")
    unit = matches[0]
    definitions = {}
    parents = {}
    module_rebindings: dict[str, set[str]] = {}
    for path, source in sources.items():
        if not path.endswith(".py"):
            continue
        tree = ast.parse(source)
        names: dict[str, int] = {}
        module_assigned_names: set[str] = set()
        pending: list[ast.AST] = list(tree.body)
        while pending:
            item = pending.pop()
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names[item.name] = names.get(item.name, 0) + 1
                continue
            if isinstance(item, (ast.Import, ast.ImportFrom)):
                for alias in item.names:
                    name = alias.asname or alias.name
                    names[name] = names.get(name, 0) + 1
            if isinstance(item, ast.Name) and isinstance(item.ctx, ast.Store):
                module_assigned_names.add(item.id)
            pending.extend(ast.iter_child_nodes(item))
        module_rebindings[path] = module_assigned_names | {name for name, count in names.items() if count > 1}
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                parents[child] = node
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                start = min([node.lineno, *[d.lineno for d in getattr(node, "decorator_list", [])]])
                definitions[(path, start, node.end_lineno)] = node

    def definition(span):
        return definitions.get((span["path"], span["start_line"], span["end_line"]))

    def scope(node):
        pending = [node.body] if isinstance(node, ast.Lambda) else list(node.body)
        result: list[ast.AST] = []
        while pending:
            child = pending.pop()
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                result.append(child)
                continue
            result.append(child)
            pending.extend(ast.iter_child_nodes(child))
        return sorted(
            result, key=lambda child: (getattr(child, "lineno", 0), getattr(child, "col_offset", 0))
        )

    def span(node, path):
        return {
            "file_id": f"file_{digest(path)}",
            "path": path,
            "start_line": node.lineno,
            "end_line": node.end_lineno,
        }

    selected = definition(unit_span)
    if selected is None:
        raise ValueError("INVALID_SELECTION")
    nodes = scope(selected)
    calls = [node for node in nodes if isinstance(node, ast.Call)]
    links = []
    path = unit_span["path"]
    parameters = {arg.arg for arg in ast.walk(selected.args) if isinstance(arg, ast.arg)}
    assigned = {node.id for node in nodes if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)}
    for call in calls[:24]:
        name = ast.unparse(call.func)[:160]
        relations = [r for r in index["relations"] if r["caller"] == unit["unit_id"] and r["name"] == name]
        targets = {r["callee"] for r in relations if r["resolved"]}
        callee = (
            next((u for u in index["units"] if u["unit_id"] in targets), None) if len(targets) == 1 else None
        )
        # Object dispatch and locally rebound names do not establish a unique definition.
        if (
            not isinstance(call.func, ast.Name)
            or call.func.id in parameters | assigned | module_rebindings[path]
        ):
            callee = None
        if callee and callee["label"] in module_rebindings[callee["primary_span"]["path"]]:
            callee = None
        if (
            callee
            and sum(
                u["label"] == callee["label"] and u["primary_span"]["path"] == callee["primary_span"]["path"]
                for u in index["units"]
            )
            != 1
        ):
            callee = None
        target = definition(callee["primary_span"]) if callee else None
        return_spans = []
        if callee and isinstance(target, ast.Lambda):
            return_spans = [span(target.body, callee["primary_span"]["path"])]
        elif callee and target:
            return_spans = [
                span(node, callee["primary_span"]["path"])
                for node in scope(target)
                if isinstance(node, ast.Return)
            ]
        expression: ast.AST = call
        while isinstance(parents.get(expression), ast.Await):
            expression = parents[expression]
        parent = parents.get(expression)
        binding, use_status, uses = None, "unresolved", []
        limitations = ["returnはすべて候補です。選ばれる経路・返却値・呼出回数は未確認です。"]
        assignment_target = None
        if isinstance(parent, ast.Assign) and len(parent.targets) == 1 and parent.value is expression:
            assignment_target = parent.targets[0]
        elif isinstance(parent, ast.AnnAssign) and parent.value is expression:
            assignment_target = parent.target
        if isinstance(assignment_target, ast.Name):
            binding = assignment_target.id
            stores = [
                node
                for node in nodes
                if isinstance(node, ast.Name) and node.id == binding and isinstance(node.ctx, ast.Store)
            ]
            rebound = any(
                isinstance(node, (ast.Global, ast.Nonlocal))
                or isinstance(node, ast.ExceptHandler)
                and node.name == binding
                or isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
                and node.name == binding
                or isinstance(node, (ast.Import, ast.ImportFrom))
                and any((alias.asname or alias.name) == binding for alias in node.names)
                for node in nodes
            )
            if len(stores) == 1 and not rebound:
                uses = [
                    span(node, path)
                    for node in nodes
                    if isinstance(node, ast.Name)
                    and isinstance(node.ctx, ast.Load)
                    and node.id == binding
                    and node.lineno >= (getattr(expression, "end_lineno", None) or call.lineno)
                ]
                use_status = "named_references"
            limitations.append(
                "同じ変数への静的参照です。再代入・入れ子関数・実行順・値の変更は追跡しません。"
            )
        elif isinstance(parent, (ast.expr, ast.Return, ast.If)):
            uses, use_status = [span(parent, path)], "immediate_expression"
            limitations.append("呼出結果を含む式です。実行されたことや値の伝播は保証しません。")
        if use_status == "unresolved":
            limitations.append("結果の利用は未確認です。再代入や分割代入を含む場合は結び付けません。")
        if not callee:
            limitations.append("呼出先の定義は未解決です。動的な呼出先を推測しません。")
        unique_uses = list({(s["path"], s["start_line"], s["end_line"]): s for s in uses}.values())
        links.append(
            {
                "link_id": f"link_{digest(f'{snapshot_id}:{unit["unit_id"]}:{call.lineno}:{call.col_offset}')}",
                "name": name,
                "call_span": span(call, path),
                "callee_span": callee["primary_span"] if callee else None,
                "resolution": "static_definition" if callee else "unresolved",
                "return_spans": return_spans[:16],
                "result_binding": binding,
                "use_spans": unique_uses[:16],
                "use_status": use_status,
                "truncated": len(return_spans) > 16 or len(unique_uses) > 16,
                "limitations": limitations,
            }
        )
    return {
        "extraction_version": "static-call-links-v1",
        "snapshot_id": snapshot_id,
        "unit_span": unit_span,
        "status": "ready",
        "links": links,
        "truncated": len(calls) > 24,
        "limitations": [
            "Pythonの静的定義と再代入のないローカル変数参照を表示します。メソッド・動的参照は未解決です。",
            "実行時の流れではありません。Agent未調査の範囲には旋律を追加しません。",
        ],
    }


def main():
    cast(TextIOWrapper, sys.stdin).reconfigure(encoding="utf-8")
    cast(TextIOWrapper, sys.stdout).reconfigure(encoding="utf-8")
    if sys.platform != "win32":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
    payload = json.loads(sys.stdin.read(8 * 1024 * 1024))
    result = (
        python_relationships(payload["snapshot_id"], payload["sources"], payload["unit_span"])
        if payload.get("operation") == "relationships"
        else index_python(payload["snapshot_id"], payload["sources"])
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
