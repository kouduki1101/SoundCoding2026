/**
 * @maxItems 96
 */
export type ReplacedSignalIds = string[];
/**
 * @maxItems 6
 */
export type ReviewSignals =
  | []
  | [ReviewSignal]
  | [ReviewSignal, ReviewSignal]
  | [ReviewSignal, ReviewSignal, ReviewSignal]
  | [ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal]
  | [ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal]
  | [ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal, ReviewSignal];
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
export type FileId = string;
export type Path = string;
export type StartLine = number;
export type EndLine = number;
/**
 * @maxItems 96
 */
export type ReferenceEvidenceIds = string[];
export type ObservedDifference = string;
export type HumanReviewRequired = boolean;
export type HumanReviewReason = string;
export type Verdict = "concern" | "justified" | "inconclusive";
export type Label = string;
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
export type EvidenceIds = string[];
/**
 * @minItems 1
 * @maxItems 3
 */
export type Findings = [Finding] | [Finding, Finding] | [Finding, Finding, Finding];
export type FindingId = string;
export type Verdict1 = "concern" | "justified_difference" | "inconclusive" | "no_specific_concern";
export type Summary = string;
/**
 * @maxItems 96
 */
export type EvidenceIds1 = string[];
export type Justification = string;
export type Limitation = string | null;
export type DiscussionQuestion = string | null;
export type ReviewAxis1 = "correctness" | "quality" | "coherence";
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
export type EvidenceIds2 = string[];
export type Status = "open" | "supported" | "rejected" | "undetermined";
export type EventId = string;
export type FromResponsibilityId = string;
export type ToResponsibilityId = string;
/**
 * @maxItems 96
 */
export type EvidenceIds3 = string[];
export type Reason = string;
/**
 * @maxItems 96
 */
export type SuggestedReclassification = Reclassification[];
/**
 * @maxItems 6
 */
export type NewResponsibilities =
  | []
  | [Responsibility]
  | [Responsibility, Responsibility]
  | [Responsibility, Responsibility, Responsibility]
  | [Responsibility, Responsibility, Responsibility, Responsibility]
  | [Responsibility, Responsibility, Responsibility, Responsibility, Responsibility]
  | [Responsibility, Responsibility, Responsibility, Responsibility, Responsibility, Responsibility];
export type ResponsibilityId = string;
export type Label1 = string;
export type Definition = string;
export type ChangeReason = string;
/**
 * @maxItems 96
 */
export type EvidenceIds4 = string[];
export type MotifId = "M0" | "M1" | "M2" | "M3" | "M4" | "M5";
export type DisplayOrder = number;
/**
 * @maxItems 4
 */
export type DesignPatterns =
  | []
  | [DesignPattern]
  | [DesignPattern, DesignPattern]
  | [DesignPattern, DesignPattern, DesignPattern]
  | [DesignPattern, DesignPattern, DesignPattern, DesignPattern];
export type PatternId1 = string;
export type Label2 = string;
export type Kind =
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
export type UnitId = string;
export type Reason1 = string;
/**
 * @maxItems 96
 */
export type EvidenceIds6 = string[];
export type InvestigationId = string;
export type BaseAnalysisId = string;
/**
 * @maxItems 96
 */
export type SelectedUnitIds = string[];
/**
 * @maxItems 96
 */
export type SelectedEventIds = string[];
export type EvidenceId = string;
export type SnapshotId = string;
export type ProjectionSha256 = string;
export type SourceKind = "code" | "test" | "document";
export type Observation = string;
export type CreatedByToolEventId = string;
export type Evidence = Evidence1[];

export interface InvestigationResult {
  replaced_signal_ids?: ReplacedSignalIds;
  review_signals?: ReviewSignals;
  findings: Findings;
  hypotheses: Hypotheses;
  suggested_reclassification?: SuggestedReclassification;
  new_responsibilities?: NewResponsibilities;
  design_patterns?: DesignPatterns;
  investigation_id: InvestigationId;
  base_analysis_id: BaseAnalysisId;
  selected_unit_ids: SelectedUnitIds;
  selected_event_ids: SelectedEventIds;
  evidence: Evidence;
}
export interface ReviewSignal {
  signal_id: SignalId;
  category: Category;
  review_axis?: ReviewAxis;
  comparison?: DesignComparison | null;
  human_review_required?: HumanReviewRequired;
  human_review_reason?: HumanReviewReason;
  verdict: Verdict;
  label: Label;
  explanation: Explanation;
  alternative: Alternative;
  counter_explanation?: CounterExplanation;
  counter_status?: CounterStatus;
  change_scenario?: ChangeScenario;
  alternative_evidence_ids?: AlternativeEvidenceIds;
  unit_ids: UnitIds;
  event_ids: EventIds;
  evidence_ids: EvidenceIds;
}
export interface DesignComparison {
  pattern_id: PatternId;
  reference_unit_id: ReferenceUnitId;
  reference_span: Span;
  reference_evidence_ids: ReferenceEvidenceIds;
  observed_difference: ObservedDifference;
}
export interface Span {
  file_id: FileId;
  path: Path;
  start_line: StartLine;
  end_line: EndLine;
}
export interface Finding {
  finding_id: FindingId;
  verdict: Verdict1;
  summary: Summary;
  evidence_ids: EvidenceIds1;
  justification: Justification;
  limitation?: Limitation;
  discussion_question?: DiscussionQuestion;
  review_axis?: ReviewAxis1;
}
export interface Hypothesis {
  hypothesis_id: HypothesisId;
  statement: Statement;
  counter_question: CounterQuestion;
  evidence_ids: EvidenceIds2;
  status: Status;
}
export interface Reclassification {
  event_id: EventId;
  from_responsibility_id: FromResponsibilityId;
  to_responsibility_id: ToResponsibilityId;
  evidence_ids: EvidenceIds3;
  reason: Reason;
}
export interface Responsibility {
  responsibility_id: ResponsibilityId;
  label: Label1;
  definition: Definition;
  change_reason: ChangeReason;
  evidence_ids: EvidenceIds4;
  motif_id: MotifId;
  display_order: DisplayOrder;
}
export interface DesignPattern {
  pattern_id: PatternId1;
  label: Label2;
  kind: Kind;
  description: Description;
  scope_note: ScopeNote;
  peer_unit_ids: PeerUnitIds;
  evidence_ids: EvidenceIds5;
  exceptions?: Exceptions;
}
export interface PatternException {
  unit_id: UnitId;
  reason: Reason1;
  evidence_ids: EvidenceIds6;
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
