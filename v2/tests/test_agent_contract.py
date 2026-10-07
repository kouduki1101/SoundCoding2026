import json

from code_groove.agent import declarations


def test_model_schema_conversion_preserves_business_title_and_refs():
    declaration = declarations(False)[-1]
    schema = declaration.parameters_json_schema
    profile = schema["properties"]["candidate"]["properties"]["profile"]
    assert "title" in profile["properties"] and "title" in profile["required"]
    assert "$ref" not in json.dumps(schema)
