export type ExtractionVersion = "static-call-links-v1";
export type SnapshotId = string;
export type FileId = string;
export type Path = string;
export type StartLine = number;
export type EndLine = number;
export type Status = "ready" | "unsupported";
export type LinkId = string;
export type Name = string;
export type Resolution = "static_definition" | "unresolved";
/**
 * @maxItems 16
 */
export type ReturnSpans =
  | []
  | [Span]
  | [Span, Span]
  | [Span, Span, Span]
  | [Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span];
export type ResultBinding = string | null;
/**
 * @maxItems 16
 */
export type UseSpans =
  | []
  | [Span]
  | [Span, Span]
  | [Span, Span, Span]
  | [Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span]
  | [Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span, Span];
export type UseStatus = "named_references" | "immediate_expression" | "unresolved";
export type Truncated = boolean;
/**
 * @maxItems 8
 */
export type Limitations =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string];
/**
 * @maxItems 24
 */
export type Links = StaticCallLink[];
export type Truncated1 = boolean;
/**
 * @maxItems 12
 */
export type Limitations1 =
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

export interface CallRelationships {
  extraction_version?: ExtractionVersion;
  snapshot_id: SnapshotId;
  unit_span: Span;
  status: Status;
  links: Links;
  truncated: Truncated1;
  limitations: Limitations1;
}
export interface Span {
  file_id: FileId;
  path: Path;
  start_line: StartLine;
  end_line: EndLine;
}
export interface StaticCallLink {
  link_id: LinkId;
  name: Name;
  call_span: Span;
  callee_span: Span | null;
  resolution: Resolution;
  return_spans: ReturnSpans;
  result_binding: ResultBinding;
  use_spans: UseSpans;
  use_status: UseStatus;
  truncated: Truncated;
  limitations: Limitations;
}
