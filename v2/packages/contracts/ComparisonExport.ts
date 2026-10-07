export type ExportVersion = "code-groove-comparison-v1";
export type MaterialId = string;
export type CodeRevision = string;
export type ComparisonId = string;
export type AlignmentVersion = "unique-monotone-v1";
export type SnapshotId = string;
export type SourceHash = string;
export type UnitId = string;
export type Label = string;
export type Path = string;
export type StartLine = number;
export type EndLine = number;
export type StartColumn = number;
export type EndColumn = number;
export type StartOffset = number;
export type EndOffset = number;
export type Signature = string;
export type ExtractionVersion = "ts-syntax-v1";
export type NormalizationVersion = "ast-trivia-only-v1";
export type Status = "ok" | "empty" | "unsupported" | "parse_failed" | "out_of_scope";
export type Diagnostics = string[];
export type EventId = string;
export type Kind =
  | "branch"
  | "loop"
  | "call"
  | "declaration"
  | "assignment"
  | "return"
  | "throw"
  | "block"
  | "function_boundary"
  | "unsupported";
export type Order = number;
export type ParentId = string | null;
export type Depth = number;
export type Context = string;
export type Syntax = string;
export type Shape = string;
export type CallKey = string | null;
export type CallIdentity = ("static_target" | "same_expression") | null;
export type Label1 = string;
export type Events = SyntaxEvent[];
export type RowId = string;
export type A = string | null;
export type B = string | null;
export type Status1 = "equal" | "different" | "unknown" | "absent" | "unsupported";
export type Rows = StructureRow[];
export type EncodingVersion = "structure-neutral-v1";
export type DictionaryVersion = "sorted-call-pairs-v1";
export type SoundVersion = "sine-envelope-v1";
export type DictionaryLimit = 4;
export type Key = string;
export type Identity = "static_target" | "same_expression";
/**
 * @minItems 2
 * @maxItems 2
 */
export type Midi = [number, number];
export type Dictionary = CallPhrase[];
export type Markers = boolean;
export type Status2 = "ready" | "dictionary_overflow" | "extraction_unavailable" | "empty";
export type Index = number;
export type StartRow = number;
export type EndRow = number;
export type DurationMs = number;
export type AtMs = number;
export type DurationMs1 = number;
export type Midi1 = number;
export type Side = "A" | "B";
export type EventId1 = string | null;
export type RowId1 = string;
export type Role = "structure" | "difference_marker" | "absent" | "unknown" | "unsupported";
export type Tones = StructureTone[];
export type Segments = StructureSegment[];
export type ScoreHash = string;
export type RecordId = string;
export type Expectation = string;
export type Observation = string;
export type Question = string;
export type Recognition = "unrecorded" | "recognized" | "not_recognized";
export type ReasonStatus = "not_started" | "unanswered" | "deferred" | "confirmed_with_evidence";
export type Judgment = "unrecorded" | "intended_difference" | "needs_review" | "insufficient_context";
export type StartedAt = string;
export type UpdatedAt = string;
export type EndedAt = string | null;
export type ReasonEvidence = string;
export type Interpretation = "maintained" | "revised" | "inconclusive";
export type Summary = string;
export type Reason = string;
export type CounterExplanation = string;
/**
 * @maxItems 12
 */
export type Unknowns =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string];
/**
 * @maxItems 96
 */
export type EvidenceIds = string[];
export type Kind1 = "structure_comparison";
export type InvestigationId = string;
export type BaseAnalysisId = string;
export type Origin = "live" | "fixture";
export type RecordId1 = string;
export type SnapshotId1 = string;
export type ComparisonId1 = string;
export type UnitA = string;
export type UnitB = string;
export type SourceHashA = string;
export type SourceHashB = string;
export type StartRow1 = number;
export type EndRow1 = number;
export type Expectation1 = string;
export type Observation1 = string;
export type Question1 = string;
export type EvidenceId = string;
export type SnapshotId2 = string;
export type FileId = string;
export type Path1 = string;
export type StartLine1 = number;
export type EndLine1 = number;
export type ProjectionSha256 = string;
export type SourceKind = "code" | "test" | "document";
export type Observation2 = string;
export type CreatedByToolEventId = string;
export type Evidence = Evidence1[];
export type ModelId = string;
export type Answers = ComparisonInvestigationResult[];
export type Operations = {
  [k: string]: unknown;
}[];
export type ExportedAt = string;

export interface ComparisonExport {
  export_version?: ExportVersion;
  material_id: MaterialId;
  code_revision: CodeRevision;
  comparison: StructureComparison;
  playback: StructurePlaybackPlan;
  agent_context: AgentContext;
  presentation: Presentation;
  record: ComparisonHumanRecord;
  exported_at: ExportedAt;
}
export interface StructureComparison {
  comparison_id: ComparisonId;
  alignment_version?: AlignmentVersion;
  a: SyntaxProjection;
  b: SyntaxProjection;
  rows: Rows;
}
export interface SyntaxProjection {
  snapshot_id: SnapshotId;
  source_hash: SourceHash;
  unit_id: UnitId;
  label: Label;
  location: SyntaxLocation;
  signature: Signature;
  extraction_version?: ExtractionVersion;
  normalization_version?: NormalizationVersion;
  status: Status;
  diagnostics: Diagnostics;
  events: Events;
}
export interface SyntaxLocation {
  path: Path;
  start_line: StartLine;
  end_line: EndLine;
  start_column: StartColumn;
  end_column: EndColumn;
  start_offset: StartOffset;
  end_offset: EndOffset;
}
export interface SyntaxEvent {
  event_id: EventId;
  kind: Kind;
  order: Order;
  parent_id: ParentId;
  depth: Depth;
  context: Context;
  syntax: Syntax;
  shape: Shape;
  location: SyntaxLocation;
  call_key?: CallKey;
  call_identity?: CallIdentity;
  label: Label1;
}
export interface StructureRow {
  row_id: RowId;
  a: A;
  b: B;
  status: Status1;
}
export interface StructurePlaybackPlan {
  encoding_version?: EncodingVersion;
  dictionary_version?: DictionaryVersion;
  sound_version?: SoundVersion;
  dictionary_limit?: DictionaryLimit;
  dictionary: Dictionary;
  markers: Markers;
  status: Status2;
  segments: Segments;
  score_hash: ScoreHash;
}
export interface CallPhrase {
  key: Key;
  identity: Identity;
  midi: Midi;
}
export interface StructureSegment {
  index: Index;
  start_row: StartRow;
  end_row: EndRow;
  duration_ms: DurationMs;
  tones: Tones;
}
export interface StructureTone {
  at_ms: AtMs;
  duration_ms: DurationMs1;
  midi: Midi1;
  side: Side;
  event_id: EventId1;
  row_id: RowId1;
  role: Role;
}
export interface AgentContext {
  [k: string]: unknown;
}
export interface Presentation {
  [k: string]: unknown;
}
export interface ComparisonHumanRecord {
  record_id: RecordId;
  expectation: Expectation;
  observation: Observation;
  question: Question;
  recognition: Recognition;
  reason_status: ReasonStatus;
  judgment: Judgment;
  started_at: StartedAt;
  updated_at: UpdatedAt;
  ended_at: EndedAt;
  reason_evidence: ReasonEvidence;
  answers: Answers;
  operations: Operations;
}
export interface ComparisonInvestigationResult {
  interpretation: Interpretation;
  summary: Summary;
  reason: Reason;
  counter_explanation: CounterExplanation;
  unknowns: Unknowns;
  evidence_ids: EvidenceIds;
  kind?: Kind1;
  investigation_id: InvestigationId;
  base_analysis_id: BaseAnalysisId;
  origin: Origin;
  request: ComparisonInvestigationRequest;
  evidence: Evidence;
  model_id: ModelId;
}
export interface ComparisonInvestigationRequest {
  record_id: RecordId1;
  snapshot_id: SnapshotId1;
  comparison_id: ComparisonId1;
  unit_a: UnitA;
  unit_b: UnitB;
  source_hash_a: SourceHashA;
  source_hash_b: SourceHashB;
  start_row: StartRow1;
  end_row: EndRow1;
  expectation: Expectation1;
  observation: Observation1;
  question: Question1;
}
export interface Evidence1 {
  evidence_id: EvidenceId;
  snapshot_id: SnapshotId2;
  span: Span;
  projection_sha256: ProjectionSha256;
  source_kind: SourceKind;
  observation: Observation2;
  created_by_tool_event_id: CreatedByToolEventId;
}
export interface Span {
  file_id: FileId;
  path: Path1;
  start_line: StartLine1;
  end_line: EndLine1;
}
