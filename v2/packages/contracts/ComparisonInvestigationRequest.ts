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
