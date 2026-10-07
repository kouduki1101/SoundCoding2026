from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Id = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")]
Text = Annotated[str, Field(min_length=1, max_length=160)]
Ids = Annotated[list[Id], Field(max_length=96)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SyntaxLocation(Contract):
    path: str
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    start_column: int = Field(ge=1)
    end_column: int = Field(ge=1)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(ge=0)


class SyntaxEvent(Contract):
    event_id: Id
    kind: Literal[
        "branch",
        "loop",
        "call",
        "declaration",
        "assignment",
        "return",
        "throw",
        "block",
        "function_boundary",
        "unsupported",
    ]
    order: int = Field(ge=0)
    parent_id: Id | None
    depth: int = Field(ge=0)
    context: str
    syntax: str
    shape: str
    location: SyntaxLocation
    call_key: str | None = None
    call_identity: Literal["static_target", "same_expression"] | None = None
    label: str


class SyntaxProjection(Contract):
    snapshot_id: Id
    source_hash: str
    unit_id: Id
    label: str
    location: SyntaxLocation
    signature: str
    extraction_version: Literal["ts-syntax-v1"] = "ts-syntax-v1"
    normalization_version: Literal["ast-trivia-only-v1"] = "ast-trivia-only-v1"
    status: Literal["ok", "empty", "unsupported", "parse_failed", "out_of_scope"]
    diagnostics: list[str]
    events: list[SyntaxEvent]


class StructureRow(Contract):
    row_id: Id
    a: Id | None
    b: Id | None
    status: Literal["equal", "different", "unknown", "absent", "unsupported"]


class StructureComparison(Contract):
    comparison_id: Id
    alignment_version: Literal["unique-monotone-v1"] = "unique-monotone-v1"
    a: SyntaxProjection
    b: SyntaxProjection
    rows: list[StructureRow]


class StructureTone(Contract):
    at_ms: int = Field(ge=0)
    duration_ms: int = Field(gt=0)
    midi: int = Field(ge=0, le=127)
    side: Literal["A", "B"]
    event_id: Id | None
    row_id: Id
    role: Literal["structure", "difference_marker", "absent", "unknown", "unsupported"]


class CallPhrase(Contract):
    key: str
    identity: Literal["static_target", "same_expression"]
    midi: list[int] = Field(min_length=2, max_length=2)


class StructureSegment(Contract):
    index: int
    start_row: int
    end_row: int
    duration_ms: int
    tones: list[StructureTone]


class StructurePlaybackPlan(Contract):
    encoding_version: Literal["structure-neutral-v1"] = "structure-neutral-v1"
    dictionary_version: Literal["sorted-call-pairs-v1"] = "sorted-call-pairs-v1"
    sound_version: Literal["sine-envelope-v1"] = "sine-envelope-v1"
    dictionary_limit: Literal[4] = 4
    dictionary: list[CallPhrase]
    markers: bool
    status: Literal["ready", "dictionary_overflow", "extraction_unavailable", "empty"]
    segments: list[StructureSegment]
    score_hash: str


class ComparisonInvestigationRequest(Contract):
    record_id: Id
    snapshot_id: Id
    comparison_id: Id
    unit_a: Id
    unit_b: Id
    source_hash_a: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_hash_b: str = Field(pattern=r"^[a-f0-9]{64}$")
    start_row: int = Field(ge=0, strict=True)
    end_row: int = Field(gt=0, strict=True)
    expectation: str = Field(max_length=1000)
    observation: str = Field(max_length=1000)
    question: str = Field(min_length=1, max_length=1000)


class ComparisonAnswerCandidate(Contract):
    interpretation: Literal["maintained", "revised", "inconclusive"]
    summary: str = Field(min_length=1, max_length=1000)
    reason: str = Field(min_length=1, max_length=1000)
    counter_explanation: str = Field(min_length=1, max_length=1000)
    unknowns: list[str] = Field(max_length=12)
    evidence_ids: Ids


class ComparisonInvestigationResult(ComparisonAnswerCandidate):
    kind: Literal["structure_comparison"] = "structure_comparison"
    investigation_id: Id
    base_analysis_id: Id
    origin: Literal["live", "fixture"]
    request: ComparisonInvestigationRequest
    evidence: list["Evidence"]
    model_id: str


class ComparisonHumanRecord(Contract):
    record_id: Id
    expectation: str
    observation: str
    question: str
    recognition: Literal["unrecorded", "recognized", "not_recognized"]
    reason_status: Literal["not_started", "unanswered", "deferred", "confirmed_with_evidence"]
    judgment: Literal["unrecorded", "intended_difference", "needs_review", "insufficient_context"]
    started_at: str
    updated_at: str
    ended_at: str | None
    reason_evidence: str
    answers: list[ComparisonInvestigationResult]
    operations: list[dict]


class ComparisonExport(Contract):
    export_version: Literal["code-groove-comparison-v1"] = "code-groove-comparison-v1"
    material_id: str
    code_revision: str
    comparison: StructureComparison
    playback: StructurePlaybackPlan
    agent_context: dict
    presentation: dict
    record: ComparisonHumanRecord
    exported_at: str


class Span(Contract):
    file_id: Id
    path: str = Field(min_length=1, max_length=240)
    start_line: int = Field(ge=1, strict=True)
    end_line: int = Field(ge=1, strict=True)


class Evidence(Contract):
    evidence_id: Id
    snapshot_id: Id
    span: Span
    projection_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_kind: Literal["code", "test", "document"]
    observation: Text
    created_by_tool_event_id: Id


class StaticCallLink(Contract):
    link_id: Id
    name: str = Field(max_length=160)
    call_span: Span
    callee_span: Span | None
    resolution: Literal["static_definition", "unresolved"]
    return_spans: list[Span] = Field(max_length=16)
    result_binding: str | None
    use_spans: list[Span] = Field(max_length=16)
    use_status: Literal["named_references", "immediate_expression", "unresolved"]
    truncated: bool
    limitations: list[str] = Field(max_length=8)


class CallRelationships(Contract):
    extraction_version: Literal["static-call-links-v1"] = "static-call-links-v1"
    snapshot_id: Id
    unit_span: Span
    status: Literal["ready", "unsupported"]
    links: list[StaticCallLink] = Field(max_length=24)
    truncated: bool
    limitations: list[str] = Field(max_length=12)


class Responsibility(Contract):
    responsibility_id: Id
    label: str = Field(min_length=1, max_length=24)
    definition: Text
    change_reason: str = Field(min_length=1, max_length=120)
    evidence_ids: Ids
    motif_id: Literal["M0", "M1", "M2", "M3", "M4", "M5"]
    display_order: int = Field(ge=0, strict=True)


class ImplementationUnit(Contract):
    unit_id: Id
    label: str = Field(min_length=1, max_length=80)
    primary_span: Span
    member_symbol_ids: Ids
    role: Literal["policy", "calculation", "adapter", "orchestrator", "other"]
    review_state: Literal["inspected", "unresolved", "excluded"]
    boundary_reason: Text
    evidence_ids: Ids


class MeaningEvent(Contract):
    event_id: Id
    concept_key: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=48)
    meaning: Text
    responsibility_id: Id
    unit_id: Id
    semantic_order: int = Field(ge=0, strict=True)
    kind: Literal["decision", "calculation", "update"]
    span: Span
    evidence_ids: Ids
    state: Literal["grounded", "unresolved"]


class Hypothesis(Contract):
    hypothesis_id: Id
    statement: Text
    counter_question: Text
    evidence_ids: Ids
    status: Literal["open", "supported", "rejected", "undetermined"]


class ExcludedPath(Contract):
    path: str
    reason: str


class Coverage(Contract):
    indexed_source_files: int = Field(ge=0)
    eligible_source_files: int = Field(ge=0)
    indexed_units: int = Field(ge=0)
    inspected_units: int = Field(ge=0)
    unresolved_unit_ids: Ids
    excluded_paths: list[ExcludedPath]
    inspected_line_ranges: list[Span]


class RepositoryProfile(Contract):
    title: str = Field(min_length=1, max_length=80)
    purpose: Text
    assumptions: list[Text] = Field(max_length=3)
    unknowns: list[Text] = Field(max_length=16)


class PatternException(Contract):
    unit_id: Id
    reason: Text
    evidence_ids: Ids


class DesignPattern(Contract):
    pattern_id: Id
    label: str = Field(min_length=1, max_length=48)
    kind: Literal[
        "domain_rule", "responsibility", "layer_boundary", "dependency_direction", "error_strategy", "naming"
    ]
    description: Text
    scope_note: Text
    peer_unit_ids: list[Id] = Field(min_length=2, max_length=12)
    evidence_ids: Ids
    exceptions: list[PatternException] = Field(default_factory=list, max_length=6)


class DesignComparison(Contract):
    pattern_id: Id
    reference_unit_id: Id
    reference_span: Span
    reference_evidence_ids: Ids
    observed_difference: Text


class ReviewSignal(Contract):
    signal_id: Id
    category: Literal[
        "policy_scattering",
        "responsibility_mixing",
        "change_coupling",
        "data_flow_opacity",
        "justified_boundary",
        "implementation_risk",
    ]
    review_axis: Literal["correctness", "quality", "coherence"] = "coherence"
    comparison: DesignComparison | None = None
    human_review_required: bool = False
    human_review_reason: str = Field(default="", max_length=160)
    verdict: Literal["concern", "justified", "inconclusive"]
    label: str = Field(min_length=1, max_length=48)
    explanation: Text
    alternative: Text
    counter_explanation: str = Field(default="", max_length=800)
    counter_status: Literal["not_checked", "supported", "rejected", "undetermined"] = "not_checked"
    change_scenario: str = Field(default="", max_length=800)
    alternative_evidence_ids: Ids = Field(default_factory=list)
    unit_ids: Ids
    event_ids: Ids
    evidence_ids: Ids


class AnalysisCandidate(Contract):
    profile: RepositoryProfile
    responsibilities: list[Responsibility] = Field(min_length=1, max_length=6)
    units: list[ImplementationUnit] = Field(min_length=1, max_length=32)
    events: list[MeaningEvent] = Field(max_length=96)
    hypotheses: list[Hypothesis] = Field(max_length=16)
    review_signals: list[ReviewSignal] = Field(default_factory=list, max_length=12)
    design_patterns: list[DesignPattern] = Field(default_factory=list, max_length=8)


class SemanticMap(AnalysisCandidate):
    schema_version: Literal["1.0"]
    analysis_id: Id
    project_id: Id
    snapshot_id: Id
    parent_analysis_id: Id | None = None
    integration_chunk_ids: list[Id] = Field(default_factory=list, max_length=4)
    analysis_depth: Literal["overview", "focused"] = "focused"
    origin: Literal["live", "recorded_live", "fixture"]
    evidence: list[Evidence]
    coverage: Coverage
    model_id: str
    prompt_version: str
    created_at: str


class ScheduledNote(Contract):
    note_id: Id
    kind: Literal["data", "pulse", "accompaniment", "cue"]
    event_id: Id | None = None
    responsibility_id: Id | None = None
    unit_id: Id | None = None
    tick: int = Field(ge=0)
    duration_ms: int = Field(gt=0)
    voice: Literal["kick", "snare", "hat", "wood", "bass", "piano", "vibes"]
    midi: int | None = Field(default=None, ge=24, le=96)
    signal_id: Id | None = None
    variant: int = Field(ge=0, le=5)
    velocity: float = Field(ge=0, le=1)
    pan: float = Field(ge=-1, le=1)
    evidence_ids: Ids


class Phrase(Contract):
    phrase_id: Id
    start_bar: int = Field(ge=0)
    bar_count: int = Field(ge=1)
    label: str
    unit_id: Id | None = None
    responsibility_id: Id | None = None


class ScorePlan(Contract):
    mode: Literal["theme", "repo"]
    scene_id: Id
    grammar_version: Literal[
        "groove-v1",
        "groove-jazz-v2",
        "groove-rhythm-v3",
        "groove-arrangement-v4",
        "groove-chamber-v5",
        "groove-chamber-v6",
        "groove-chamber-v7",
        "groove-chamber-v8",
        "groove-chamber-v9",
        "groove-chamber-v10",
    ]
    kit_id: Literal["paper-studio-v1", "midnight-jazz-v2", "midnight-jazz-v3", "midnight-jazz-v4"]
    kit_hash: str
    bpm: Literal[96]
    beats_per_bar: Literal[4]
    steps_per_bar: Literal[16]
    ppq: Literal[480]
    total_bars: int = Field(ge=1, le=32)
    phrases: list[Phrase]
    notes: list[ScheduledNote]


class ScoreScene(Contract):
    scene_id: Id
    unit_ids: Ids
    theme: ScorePlan
    repo: ScorePlan


class ScoreBundle(Contract):
    analysis_id: Id
    score_hash: str
    scenes: list[ScoreScene]


class Finding(Contract):
    finding_id: Id
    verdict: Literal["concern", "justified_difference", "inconclusive", "no_specific_concern"]
    summary: str = Field(min_length=1, max_length=180)
    evidence_ids: Ids
    justification: Text
    limitation: Text | None = None
    discussion_question: Text | None = None
    review_axis: Literal["correctness", "quality", "coherence"] = "coherence"


class Reclassification(Contract):
    event_id: Id
    from_responsibility_id: Id
    to_responsibility_id: Id
    evidence_ids: Ids
    reason: Text


class InvestigationCandidate(Contract):
    replaced_signal_ids: Ids = Field(default_factory=list, max_length=12)
    review_signals: list[ReviewSignal] = Field(default_factory=list, max_length=6)
    findings: list[Finding] = Field(min_length=1, max_length=3)
    hypotheses: list[Hypothesis] = Field(max_length=16)
    suggested_reclassification: list[Reclassification] = Field(default_factory=list, max_length=96)
    new_responsibilities: list[Responsibility] = Field(default_factory=list, max_length=6)
    design_patterns: list[DesignPattern] = Field(default_factory=list, max_length=4)


class InvestigationResult(InvestigationCandidate):
    investigation_id: Id
    base_analysis_id: Id
    selected_unit_ids: Ids
    selected_event_ids: Ids
    evidence: list[Evidence]


class SourceEdit(Contract):
    path: str = Field(min_length=1, max_length=240)
    before: str = Field(max_length=12000)
    after: str = Field(min_length=1, max_length=16000)


class ImprovementCandidate(Contract):
    title: str = Field(min_length=1, max_length=80)
    rationale: Text
    tradeoffs: Text
    verification: Text
    signal_ids: Ids
    evidence_ids: Ids
    edits: list[SourceEdit] = Field(min_length=1, max_length=6)


class ImprovementProposal(ImprovementCandidate):
    proposal_id: Id
    base_analysis_id: Id
    base_snapshot_id: Id
    source_hash: str
    evidence: list[Evidence]
    diff: str = Field(max_length=64000)
    status: Literal["draft", "accepted", "rejected"] = "draft"
