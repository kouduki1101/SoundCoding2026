export type Title = string;
export type Purpose = string;
/**
 * @maxItems 3
 */
export type Assumptions = [] | [string] | [string, string] | [string, string, string];
/**
 * @maxItems 16
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
  | [string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string
    ];
/**
 * @minItems 1
 * @maxItems 6
 */
export type Responsibilities =
  | [Responsibility]
  | [Responsibility, Responsibility]
  | [Responsibility, Responsibility, Responsibility]
  | [Responsibility, Responsibility, Responsibility, Responsibility]
  | [Responsibility, Responsibility, Responsibility, Responsibility, Responsibility]
  | [Responsibility, Responsibility, Responsibility, Responsibility, Responsibility, Responsibility];
export type ResponsibilityId = string;
export type Label = string;
export type Definition = string;
export type ChangeReason = string;
/**
 * @maxItems 96
 */
export type EvidenceIds = string[];
export type MotifId = "M0" | "M1" | "M2" | "M3" | "M4" | "M5";
export type DisplayOrder = number;
/**
 * @minItems 1
 * @maxItems 32
 */
export type Units = [ImplementationUnit, ...ImplementationUnit[]];
export type UnitId = string;
export type Label1 = string;
export type FileId = string;
export type Path = string;
export type StartLine = number;
export type EndLine = number;
/**
 * @maxItems 96
 */
export type MemberSymbolIds = string[];
export type Role = "policy" | "calculation" | "adapter" | "orchestrator" | "other";
export type ReviewState = "inspected" | "unresolved" | "excluded";
export type BoundaryReason = string;
/**
 * @maxItems 96
 */
export type EvidenceIds1 = string[];
export type EventId = string;
export type ConceptKey = string;
export type Label2 = string;
export type Meaning = string;
export type ResponsibilityId1 = string;
export type UnitId1 = string;
export type SemanticOrder = number;
export type Kind = "decision" | "calculation" | "update";
/**
 * @maxItems 96
 */
export type EvidenceIds2 = string[];
export type State = "grounded" | "unresolved";
/**
 * @maxItems 96
 */
export type Events = MeaningEvent[];
/**
 * @maxItems 16
 */
export type Hypotheses =
  | []
  | [Hypothesis]
  | [Hypothesis, Hypothesis]
  | [Hypothesis, Hypothesis, Hypothesis]
  | [Hypothesis, Hypothesis, Hypothesis, Hypothesis]
  | [Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis]
  | [Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis]
  | [Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis]
  | [Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis]
  | [Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis, Hypothesis]
  | [
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis
    ]
  | [
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis
    ]
  | [
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis
    ]
  | [
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis
    ]
  | [
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis
    ]
  | [
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis
    ]
  | [
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis,
      Hypothesis
    ];
export type HypothesisId = string;
export type Statement = string;
export type CounterQuestion = string;
/**
 * @maxItems 96
 */
export type EvidenceIds3 = string[];
export type Status = "open" | "supported" | "rejected" | "undetermined";
/**
 * @maxItems 12
 */
export type ReviewSignals =
  | []
  | [ReviewSignal]
  | [ReviewSignal, ReviewSignal]
  | [ReviewSignal, ReviewSignal, ReviewSignal]
  | [ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal]
  | [ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal]
  | [ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal]
  | [ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal]
  | [ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal]
  | [
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal
    ]
  | [
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal
    ]
  | [
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal
    ]
  | [
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal,
      ReviewSignal
    ];
export type SignalId = string;
export type Category =
  | "policy_scattering"
  | "responsibility_mixing"
  | "change_coupling"
  | "data_flow_opacity"
  | "justified_boundary"
  | "implementation_risk";
export type ReviewAxis = "correctness" | "quality" | "coherence";
export type PatternId = string;
export type ReferenceUnitId = string;
/**
 * @maxItems 96
 */
export type ReferenceEvidenceIds = string[];
export type ObservedDifference = string;
export type HumanReviewRequired = boolean;
export type HumanReviewReason = string;
export type Verdict = "concern" | "justified" | "inconclusive";
export type Label3 = string;
export type Explanation = string;
export type Alternative = string;
export type CounterExplanation = string;
export type CounterStatus = "not_checked" | "supported" | "rejected" | "undetermined";
export type ChangeScenario = string;
/**
 * @maxItems 96
 */
export type AlternativeEvidenceIds = string[];
/**
 * @maxItems 96
 */
export type UnitIds = string[];
/**
 * @maxItems 96
 */
export type EventIds = string[];
/**
 * @maxItems 96
 */
export type EvidenceIds4 = string[];
/**
 * @maxItems 8
 */
export type DesignPatterns =
  | []
  | [DesignPattern]
  | [DesignPattern, DesignPattern]
  | [DesignPattern, DesignPattern, DesignPattern]
  | [DesignPattern, DesignPattern, DesignPattern, DesignPattern]
  | [DesignPattern, DesignPattern, DesignPattern, DesignPattern, DesignPattern]
  | [DesignPattern, DesignPattern, DesignPattern, DesignPattern, DesignPattern, DesignPattern]
  | [DesignPattern, DesignPattern, DesignPattern, DesignPattern, DesignPattern, DesignPattern, DesignPattern]
  | [
      DesignPattern,
      DesignPattern,
      DesignPattern,
      DesignPattern,
      DesignPattern,
      DesignPattern,
      DesignPattern,
      DesignPattern
    ];
export type PatternId1 = string;
export type Label4 = string;
export type Kind1 =
  "domain_rule" | "responsibility" | "layer_boundary" | "dependency_direction" | "error_strategy" | "naming";
export type Description = string;
export type ScopeNote = string;
/**
 * @minItems 2
 * @maxItems 12
 */
export type PeerUnitIds =
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
export type EvidenceIds5 = string[];
/**
 * @maxItems 6
 */
export type Exceptions =
  | []
  | [PatternException]
  | [PatternException, PatternException]
  | [PatternException, PatternException, PatternException]
  | [PatternException, PatternException, PatternException, PatternException]
  | [PatternException, PatternException, PatternException, PatternException, PatternException]
  | [PatternException, PatternException, PatternException, PatternException, PatternException, PatternException];
export type UnitId2 = string;
export type Reason = string;
/**
 * @maxItems 96
 */
export type EvidenceIds6 = string[];
export type SchemaVersion = "1.0";
export type AnalysisId = string;
export type ProjectId = string;
export type SnapshotId = string;
export type ParentAnalysisId = string | null;
/**
 * @maxItems 4
 */
export type IntegrationChunkIds =
  [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
export type AnalysisDepth = "overview" | "focused";
export type Origin = "live" | "recorded_live" | "fixture";
export type EvidenceId = string;
export type SnapshotId1 = string;
export type ProjectionSha256 = string;
export type SourceKind = "code" | "test" | "document";
export type Observation = string;
export type CreatedByToolEventId = string;
export type Evidence = Evidence1[];
export type IndexedSourceFiles = number;
export type EligibleSourceFiles = number;
export type IndexedUnits = number;
export type InspectedUnits = number;
/**
 * @maxItems 96
 */
export type UnresolvedUnitIds = string[];
export type Path1 = string;
export type Reason1 = string;
export type ExcludedPaths = ExcludedPath[];
export type InspectedLineRanges = Span[];
export type ModelId = string;
export type PromptVersion = string;
export type CreatedAt = string;

export interface SemanticMap {
  profile: RepositoryProfile;
  responsibilities: Responsibilities;
  units: Units;
  events: Events;
  hypotheses: Hypotheses;
  review_signals?: ReviewSignals;
  design_patterns?: DesignPatterns;
  schema_version: SchemaVersion;
  analysis_id: AnalysisId;
  project_id: ProjectId;
  snapshot_id: SnapshotId;
  parent_analysis_id?: ParentAnalysisId;
  integration_chunk_ids?: IntegrationChunkIds;
  analysis_depth?: AnalysisDepth;
  origin: Origin;
  evidence: Evidence;
  coverage: Coverage;
  model_id: ModelId;
  prompt_version: PromptVersion;
  created_at: CreatedAt;
}
export interface RepositoryProfile {
  title: Title;
  purpose: Purpose;
  assumptions: Assumptions;
  unknowns: Unknowns;
}
export interface Responsibility {
  responsibility_id: ResponsibilityId;
  label: Label;
  definition: Definition;
  change_reason: ChangeReason;
  evidence_ids: EvidenceIds;
  motif_id: MotifId;
  display_order: DisplayOrder;
}
export interface ImplementationUnit {
  unit_id: UnitId;
  label: Label1;
  primary_span: Span;
  member_symbol_ids: MemberSymbolIds;
  role: Role;
  review_state: ReviewState;
  boundary_reason: BoundaryReason;
  evidence_ids: EvidenceIds1;
}
export interface Span {
  file_id: FileId;
  path: Path;
  start_line: StartLine;
  end_line: EndLine;
}
export interface MeaningEvent {
  event_id: EventId;
  concept_key: ConceptKey;
  label: Label2;
  meaning: Meaning;
  responsibility_id: ResponsibilityId1;
  unit_id: UnitId1;
  semantic_order: SemanticOrder;
  kind: Kind;
  span: Span;
  evidence_ids: EvidenceIds2;
  state: State;
}
export interface Hypothesis {
  hypothesis_id: HypothesisId;
  statement: Statement;
  counter_question: CounterQuestion;
  evidence_ids: EvidenceIds3;
  status: Status;
}
export interface ReviewSignal {
  signal_id: SignalId;
  category: Category;
  review_axis?: ReviewAxis;
  comparison?: DesignComparison | null;
  human_review_required?: HumanReviewRequired;
  human_review_reason?: HumanReviewReason;
  verdict: Verdict;
  label: Label3;
  explanation: Explanation;
  alternative: Alternative;
  counter_explanation?: CounterExplanation;
  counter_status?: CounterStatus;
  change_scenario?: ChangeScenario;
  alternative_evidence_ids?: AlternativeEvidenceIds;
  unit_ids: UnitIds;
  event_ids: EventIds;
  evidence_ids: EvidenceIds4;
}
export interface DesignComparison {
  pattern_id: PatternId;
  reference_unit_id: ReferenceUnitId;
  reference_span: Span;
  reference_evidence_ids: ReferenceEvidenceIds;
  observed_difference: ObservedDifference;
}
export interface DesignPattern {
  pattern_id: PatternId1;
  label: Label4;
  kind: Kind1;
  description: Description;
  scope_note: ScopeNote;
  peer_unit_ids: PeerUnitIds;
  evidence_ids: EvidenceIds5;
  exceptions?: Exceptions;
}
export interface PatternException {
  unit_id: UnitId2;
  reason: Reason;
  evidence_ids: EvidenceIds6;
}
export interface Evidence1 {
  evidence_id: EvidenceId;
  snapshot_id: SnapshotId1;
  span: Span;
  projection_sha256: ProjectionSha256;
  source_kind: SourceKind;
  observation: Observation;
  created_by_tool_event_id: CreatedByToolEventId;
}
export interface Coverage {
  indexed_source_files: IndexedSourceFiles;
  eligible_source_files: EligibleSourceFiles;
  indexed_units: IndexedUnits;
  inspected_units: InspectedUnits;
  unresolved_unit_ids: UnresolvedUnitIds;
  excluded_paths: ExcludedPaths;
  inspected_line_ranges: InspectedLineRanges;
}
export interface ExcludedPath {
  path: Path1;
  reason: Reason1;
}
