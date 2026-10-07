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
