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
export type Kind = "structure_comparison";
export type InvestigationId = string;
export type BaseAnalysisId = string;
export type Origin = "live" | "fixture";
export type RecordId = string;
export type SnapshotId = string;
export type ComparisonId = string;
export type UnitA = string;
export type UnitB = string;
export type SourceHashA = string;
export type SourceHashB = string;
export type StartRow = number;
export type EndRow = number;
export type Expectation = string;
export type Observation = string;
export type Question = string;
export type EvidenceId = string;
export type SnapshotId1 = string;
export type FileId = string;
export type Path = string;
export type StartLine = number;
export type EndLine = number;
export type ProjectionSha256 = string;
export type SourceKind = "code" | "test" | "document";
export type Observation1 = string;
export type CreatedByToolEventId = string;
export type Evidence = Evidence1[];
export type ModelId = string;

export interface ComparisonInvestigationResult {
  interpretation: Interpretation;
  summary: Summary;
  reason: Reason;
  counter_explanation: CounterExplanation;
  unknowns: Unknowns;
  evidence_ids: EvidenceIds;
  kind?: Kind;
  investigation_id: InvestigationId;
  base_analysis_id: BaseAnalysisId;
  origin: Origin;
  request: ComparisonInvestigationRequest;
  evidence: Evidence;
  model_id: ModelId;
}
export interface ComparisonInvestigationRequest {
  record_id: RecordId;
  snapshot_id: SnapshotId;
  comparison_id: ComparisonId;
  unit_a: UnitA;
  unit_b: UnitB;
  source_hash_a: SourceHashA;
  source_hash_b: SourceHashB;
  start_row: StartRow;
  end_row: EndRow;
  expectation: Expectation;
  observation: Observation;
  question: Question;
}
export interface Evidence1 {
  evidence_id: EvidenceId;
  snapshot_id: SnapshotId1;
  span: Span;
  projection_sha256: ProjectionSha256;
  source_kind: SourceKind;
  observation: Observation1;
  created_by_tool_event_id: CreatedByToolEventId;
}
export interface Span {
  file_id: FileId;
  path: Path;
  start_line: StartLine;
  end_line: EndLine;
}
