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
export type Status = "ready" | "dictionary_overflow" | "extraction_unavailable" | "empty";
export type Index = number;
export type StartRow = number;
export type EndRow = number;
export type DurationMs = number;
export type AtMs = number;
export type DurationMs1 = number;
export type Midi1 = number;
export type Side = "A" | "B";
export type EventId = string | null;
export type RowId = string;
export type Role = "structure" | "difference_marker" | "absent" | "unknown" | "unsupported";
export type Tones = StructureTone[];
export type Segments = StructureSegment[];
export type ScoreHash = string;

export interface StructurePlaybackPlan {
  encoding_version?: EncodingVersion;
  dictionary_version?: DictionaryVersion;
  sound_version?: SoundVersion;
  dictionary_limit?: DictionaryLimit;
  dictionary: Dictionary;
  markers: Markers;
  status: Status;
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
  event_id: EventId;
  row_id: RowId;
  role: Role;
}
