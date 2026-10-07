export type AnalysisId = string;
export type ScoreHash = string;
export type SceneId = string;
/**
 * @maxItems 96
 */
export type UnitIds = string[];
export type Mode = "theme" | "repo";
export type SceneId1 = string;
export type GrammarVersion =
  | "groove-v1"
  | "groove-jazz-v2"
  | "groove-rhythm-v3"
  | "groove-arrangement-v4"
  | "groove-chamber-v5"
  | "groove-chamber-v6"
  | "groove-chamber-v7"
  | "groove-chamber-v8"
  | "groove-chamber-v9"
  | "groove-chamber-v10";
export type KitId = "paper-studio-v1" | "midnight-jazz-v2" | "midnight-jazz-v3" | "midnight-jazz-v4";
export type KitHash = string;
export type Bpm = 96;
export type BeatsPerBar = 4;
export type StepsPerBar = 16;
export type Ppq = 480;
export type TotalBars = number;
export type PhraseId = string;
export type StartBar = number;
export type BarCount = number;
export type Label = string;
export type UnitId = string | null;
export type ResponsibilityId = string | null;
export type Phrases = Phrase[];
export type NoteId = string;
export type Kind = "data" | "pulse" | "accompaniment" | "cue";
export type EventId = string | null;
export type ResponsibilityId1 = string | null;
export type UnitId1 = string | null;
export type Tick = number;
export type DurationMs = number;
export type Voice = "kick" | "snare" | "hat" | "wood" | "bass" | "piano" | "vibes";
export type Midi = number | null;
export type SignalId = string | null;
export type Variant = number;
export type Velocity = number;
export type Pan = number;
/**
 * @maxItems 96
 */
export type EvidenceIds = string[];
export type Notes = ScheduledNote[];
export type Scenes = ScoreScene[];

export interface ScoreBundle {
  analysis_id: AnalysisId;
  score_hash: ScoreHash;
  scenes: Scenes;
}
export interface ScoreScene {
  scene_id: SceneId;
  unit_ids: UnitIds;
  theme: ScorePlan;
  repo: ScorePlan;
}
export interface ScorePlan {
  mode: Mode;
  scene_id: SceneId1;
  grammar_version: GrammarVersion;
  kit_id: KitId;
  kit_hash: KitHash;
  bpm: Bpm;
  beats_per_bar: BeatsPerBar;
  steps_per_bar: StepsPerBar;
  ppq: Ppq;
  total_bars: TotalBars;
  phrases: Phrases;
  notes: Notes;
}
export interface Phrase {
  phrase_id: PhraseId;
  start_bar: StartBar;
  bar_count: BarCount;
  label: Label;
  unit_id?: UnitId;
  responsibility_id?: ResponsibilityId;
}
export interface ScheduledNote {
  note_id: NoteId;
  kind: Kind;
  event_id?: EventId;
  responsibility_id?: ResponsibilityId1;
  unit_id?: UnitId1;
  tick: Tick;
  duration_ms: DurationMs;
  voice: Voice;
  midi?: Midi;
  signal_id?: SignalId;
  variant: Variant;
  velocity: Velocity;
  pan: Pan;
  evidence_ids: EvidenceIds;
}
