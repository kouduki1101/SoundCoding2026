export type Title = string;
export type Rationale = string;
export type Tradeoffs = string;
export type Verification = string;
/**
 * @maxItems 96
 */
export type SignalIds = string[];
/**
 * @maxItems 96
 */
export type EvidenceIds = string[];
/**
 * @minItems 1
 * @maxItems 6
 */
export type Edits =
  | [SourceEdit]
  | [SourceEdit, SourceEdit]
  | [SourceEdit, SourceEdit, SourceEdit]
  | [SourceEdit, SourceEdit, SourceEdit, SourceEdit]
  | [SourceEdit, SourceEdit, SourceEdit, SourceEdit, SourceEdit]
  | [SourceEdit, SourceEdit, SourceEdit, SourceEdit, SourceEdit, SourceEdit];
export type Path = string;
export type Before = string;
export type After = string;
export type ProposalId = string;
export type BaseAnalysisId = string;
export type BaseSnapshotId = string;
export type SourceHash = string;
export type EvidenceId = string;
export type SnapshotId = string;
export type FileId = string;
export type Path1 = string;
export type StartLine = number;
export type EndLine = number;
export type ProjectionSha256 = string;
export type SourceKind = "code" | "test" | "document";
export type Observation = string;
export type CreatedByToolEventId = string;
export type Evidence = Evidence1[];
export type Diff = string;
export type Status = "draft" | "accepted" | "rejected";

export interface ImprovementProposal {
  title: Title;
  rationale: Rationale;
  tradeoffs: Tradeoffs;
  verification: Verification;
  signal_ids: SignalIds;
  evidence_ids: EvidenceIds;
  edits: Edits;
  proposal_id: ProposalId;
  base_analysis_id: BaseAnalysisId;
  base_snapshot_id: BaseSnapshotId;
  source_hash: SourceHash;
  evidence: Evidence;
  diff: Diff;
  status?: Status;
}
export interface SourceEdit {
  path: Path;
  before: Before;
  after: After;
}
export interface Evidence1 {
  evidence_id: EvidenceId;
  snapshot_id: SnapshotId;
  span: Span;
  projection_sha256: ProjectionSha256;
  source_kind: SourceKind;
  observation: Observation;
  created_by_tool_event_id: CreatedByToolEventId;
}
export interface Span {
  file_id: FileId;
  path: Path1;
  start_line: StartLine;
  end_line: EndLine;
}
