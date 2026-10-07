"""A public source reference is separate from immutable Gemini read receipts."""

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from code_groove.settings import ROOT


class RepositoryReference(BaseModel):
    origin: Literal["committed_source_reference"]
    revision: str = Field(pattern=r"^[0-9a-f]{40}$")
    repository_url: str
    license: str
    semantic_analysis: Literal["not_run"]
    source_lines: int = Field(ge=1)
    indexed_symbols: int = Field(ge=0)
    sources: dict[str, str]
    source_sha256: dict[str, str]

    @model_validator(mode="after")
    def verify_sources(self):
        if self.sources.keys() != self.source_sha256.keys() or not 1 <= len(self.sources) <= 400:
            raise ValueError("Invalid reference inventory")
        for path, source in self.sources.items():
            if path.startswith("/") or "\\" in path or any(p in ("", ".", "..") for p in path.split("/")):
                raise ValueError("Invalid reference path")
            if hashlib.sha256(source.encode()).hexdigest() != self.source_sha256[path]:
                raise ValueError("Reference source digest differs")
        return self


def tsugiai_reference() -> RepositoryReference:
    reference = RepositoryReference.model_validate_json(
        (ROOT / "fixtures/repository-reference/tsugiai.json").read_text(encoding="utf-8")
    )
    recording = json.loads((ROOT / "fixtures/recorded-live/tsugiai-agents.json").read_text(encoding="utf-8"))
    if reference.revision != recording["case_study"]["revision"] or any(
        reference.sources.get(path) != source for path, source in recording["sources"].items()
    ):
        raise ValueError("Reference and recording must share committed source")
    return reference
