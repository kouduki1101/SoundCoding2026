from code_groove.source import build_index


def test_python_is_static_and_resolves_only_local_function_imports(tmp_path):
    marker = tmp_path / "must-not-exist"
    sources = {
        "policy.py": "def evaluate(value):\n    return value * 2\n",
        "service.py": f'from policy import evaluate as policy\nopen({str(marker)!r}, "w").write("unsafe")\n\ndef submit(value):\n    return policy(value)\n',
        "tests/test_policy.py": "from policy import evaluate\n\ndef test_policy():\n    assert evaluate(1) == 2\n",
    }
    index = build_index("python_static", sources)
    assert not marker.exists()
    assert {u["label"] for u in index["units"]} == {"evaluate", "submit"}
    assert index["relations"][0]["resolved"]
    assert index["relations"][0]["callee"] in {u["unit_id"] for u in index["units"]}
    assert not next(f for f in index["files"] if f["path"].startswith("tests/"))["is_source"]


def test_nested_async_functions_lambdas_and_classes_preserve_lexical_owners():
    from code_groove.repository import plan_repository

    sources = {
        "nested.py": """import json
def outer(value):
    async def inner(x):
        return x
    choose = lambda x: inner(x)
    class Nested:
        def method(self):
            return choose(value)
    return inner(value)
class Service:
    def start(self):
        def helper():
            return self.finish()
        return helper()
    def finish(self):
        return 1
"""
    }
    index = build_index("snap_nested", sources, repository=True)
    by_label = {u["label"]: u for u in index["units"]}
    assert by_label["outer.inner"]["parent_unit_id"] == by_label["outer"]["unit_id"]
    assert by_label["outer.Nested.method"]["parent_unit_id"] == by_label["outer"]["unit_id"]
    assert any(u["label"].startswith("outer.lambda_") for u in index["units"])
    assert any(r["name"] == "helper" and r["resolved"] for r in index["relations"])
    plan = plan_repository(index, sources)
    assert plan["implementation_units"] == 3
    assert not plan["cache_dependency_uncertainty"]


def test_relative_submodule_and_stdlib_imports_have_distinct_cache_boundaries():
    from code_groove.repository import plan_repository

    sources = {
        "pkg/main.py": "from . import policy\nimport json\ndef run():\n    return policy.evaluate()\n",
        "pkg/policy.py": "def evaluate():\n    return 1\n",
        "other/module.py": "import missing_local\ndef other():\n    return 1\n",
    }
    index = build_index("snap_imports", sources, repository=True)
    assert any(r["name"] == "policy.evaluate" and r["resolved"] for r in index["relations"])
    plan = plan_repository(index, sources)
    safe = next(c for c in plan["chunks"] if c["label"] == "pkg")
    assert not safe["dependency_uncertainty"]
    assert "other/module.py" not in safe["dependency_paths"]
    unsafe = next(c for c in plan["chunks"] if c["label"] == "other")
    assert unsafe["dependency_uncertainty"]
    assert set(unsafe["dependency_paths"]) == set(sources)
