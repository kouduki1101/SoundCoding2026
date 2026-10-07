import type { CallRelationships, Span, StaticCallLink } from '../../../../packages/contracts/CallRelationships';
import type { ScoreBundle, ScorePlan, ScheduledNote } from '../../../../packages/contracts/ScoreBundle';
import type { ImplementationUnit, SemanticMap } from '../../../../packages/contracts/SemanticMap';
import { playbackPlan } from './playback';

export type DialoguePhaseId = 'quote' | 'answer' | 'receive' | 'together';

export type DialoguePhase = {
  id: DialoguePhaseId;
  label: string;
  startTick: number;
  endTick: number;
  activeSpan: Span;
  relatedSpan?: Span;
};

export type DialogueUnavailableReason =
  | 'snapshot_mismatch'
  | 'score_mismatch'
  | 'relationships_unavailable'
  | 'link_not_found'
  | 'target_unresolved'
  | 'unit_ambiguous'
  | 'self_call'
  | 'caller_unheard'
  | 'target_unheard'
  | 'score_unavailable';

export type RelationshipDialogue =
  | {
      status: 'ready';
      plan: ScorePlan;
      phases: DialoguePhase[];
      sourceNoteIds: string[];
      callerVoiceNoteId: string;
      repeatedMotif: boolean;
      limitations: string[];
    }
  | { status: 'unavailable'; reason: DialogueUnavailableReason; message: string };

const ticksPerBar = 1920;
const ticksPerBeat = 480;
const phaseNames: DialoguePhaseId[] = ['quote', 'answer', 'receive', 'together'];
const unavailableMessages: Record<DialogueUnavailableReason, string> = {
  snapshot_mismatch: '関係と解析結果の版が一致しないため、この接点は試聴できません。',
  score_mismatch: '譜面と解析結果の版が一致しないため、この接点は試聴できません。',
  relationships_unavailable: '静的な呼出関係を確認できないため、この接点は試聴できません。',
  link_not_found: '選んだ呼出箇所が現在の解析結果にありません。',
  target_unresolved: '呼出先の定義が未解決のため、相手の主題を補いません。',
  unit_ambiguous: '呼ぶ側と相手の関数を一意に対応できないため、試聴を控えます。',
  self_call: '再帰呼出しは二者の掛け合いとして演奏しません。',
  caller_unheard: '呼ぶ側に根拠付きの音がないため、その声を補いません。',
  target_unheard: '呼出先に根拠付きの音がないため、その主題を補いません。',
  score_unavailable: '保存済みのリポジトリ譜面がないため、試聴できません。',
};

function unavailable(reason: DialogueUnavailableReason): RelationshipDialogue {
  return { status: 'unavailable', reason, message: unavailableMessages[reason] };
}

function sameSpan(a: Span, b: Span) {
  return (
    a.file_id === b.file_id &&
    a.path === b.path &&
    a.start_line === b.start_line &&
    a.end_line === b.end_line
  );
}

function within(inner: Span, outer: Span) {
  return (
    inner.file_id === outer.file_id &&
    inner.path === outer.path &&
    outer.start_line <= inner.start_line &&
    inner.end_line <= outer.end_line
  );
}

function uniqueInspectedUnit(map: SemanticMap, span: Span): ImplementationUnit | undefined {
  const matches = map.units.filter((unit) => sameSpan(unit.primary_span, span));
  return matches.length === 1 && matches[0].review_state === 'inspected' ? matches[0] : undefined;
}

function groundedNotes(map: SemanticMap, plan: ScorePlan, unitId: string): ScheduledNote[] {
  const grounded = new Set(
    map.events
      .filter((event) => event.unit_id === unitId && event.state === 'grounded')
      .map((event) => event.event_id),
  );
  return plan.notes
    .filter(
      (note) =>
        note.kind === 'data' &&
        note.unit_id === unitId &&
        note.event_id != null &&
        grounded.has(note.event_id) &&
        note.midi != null,
    )
    .sort((a, b) => a.tick - b.tick || a.note_id.localeCompare(b.note_id));
}

function phasesFor(link: StaticCallLink): DialoguePhase[] {
  const target = link.callee_span!;
  const answer = link.return_spans.length === 1 ? link.return_spans[0] : target;
  const receive = link.use_spans.length === 1 ? link.use_spans[0] : link.call_span;
  return [
    { id: 'quote', label: '相手の主題を呼ぶ', startTick: 0, endTick: ticksPerBar, activeSpan: link.call_span, relatedSpan: target },
    { id: 'answer', label: '相手が応える', startTick: ticksPerBar, endTick: 2 * ticksPerBar, activeSpan: answer, relatedSpan: link.call_span },
    { id: 'receive', label: '呼ぶ側が受け取る', startTick: 2 * ticksPerBar, endTick: 3 * ticksPerBar, activeSpan: receive, relatedSpan: target },
    { id: 'together', label: '二つの声を重ねる', startTick: 3 * ticksPerBar, endTick: 4 * ticksPerBar, activeSpan: link.call_span, relatedSpan: target },
  ];
}

/** An audition of a confirmed static relationship, using only notes from grounded events. */
export function buildRelationshipDialogue(
  map: SemanticMap,
  score: ScoreBundle,
  relationships: CallRelationships,
  linkId: string,
): RelationshipDialogue {
  if (relationships.snapshot_id !== map.snapshot_id) return unavailable('snapshot_mismatch');
  if (score.analysis_id !== map.analysis_id) return unavailable('score_mismatch');
  if (relationships.status !== 'ready') return unavailable('relationships_unavailable');
  const link = relationships.links.find((item) => item.link_id === linkId);
  if (!link) return unavailable('link_not_found');
  if (link.resolution !== 'static_definition' || !link.callee_span)
    return unavailable('target_unresolved');
  const caller = uniqueInspectedUnit(map, relationships.unit_span);
  const callee = uniqueInspectedUnit(map, link.callee_span);
  if (!caller || !callee || !within(link.call_span, relationships.unit_span))
    return unavailable('unit_ambiguous');
  if (caller.unit_id === callee.unit_id) return unavailable('self_call');
  const original = playbackPlan(score, 'repo', 0, true);
  if (!original) return unavailable('score_unavailable');
  const callerNotes = groundedNotes(map, original, caller.unit_id);
  if (!callerNotes.length) return unavailable('caller_unheard');
  const targetNotes = groundedNotes(map, original, callee.unit_id);
  if (!targetNotes.length) return unavailable('target_unheard');

  const motif = Array.from({ length: 4 }, (_, index) => targetNotes[index % Math.min(4, targetNotes.length)]);
  const callerVoice = callerNotes[0];
  const calleeVoice = targetNotes[0];
  const dialogueId = link.link_id;
  const phases = phasesFor(link);
  const notes: ScheduledNote[] = [];
  function add(phase: DialoguePhaseId, role: 'caller' | 'callee', motifIndex: number, level = 1) {
    const phaseIndex = phaseNames.indexOf(phase);
    const source = motif[motifIndex];
    const voice = role === 'caller' ? callerVoice : calleeVoice;
    const tick = phaseIndex * ticksPerBar + motifIndex * ticksPerBeat;
    notes.push({
      note_id: `dialogue_${dialogueId}_${phase}_${role}_${motifIndex}`,
      kind: 'data',
      tick,
      duration_ms: Math.min(560, Math.max(120, source.duration_ms)),
      voice: voice.voice,
      midi: source.midi,
      variant: voice.variant,
      velocity: Math.min(1, source.velocity * level),
      pan: role === 'caller' ? -0.45 : 0.45,
      evidence_ids: [],
    });
  }
  for (let index = 0; index < 4; index++) {
    add('quote', 'caller', index);
    add('answer', 'callee', index);
    add('receive', 'caller', index, 0.92);
    add('together', 'caller', index, 0.55);
    add('together', 'callee', index, 0.55);
  }
  notes.sort((a, b) => a.tick - b.tick || a.note_id.localeCompare(b.note_id));
  const plan: ScorePlan = {
    ...original,
    scene_id: `relationship_dialogue_${link.link_id}`,
    total_bars: 4,
    phrases: phases.map((phase) => ({
      phrase_id: `dialogue_${link.link_id}_${phase.id}`,
      start_bar: phase.startTick / ticksPerBar,
      bar_count: 1,
      label: phase.label,
    })),
    notes,
  };
  const limitations = [
    '静的に解決した二関数を表す演奏です。実行順、選ばれたreturn、契約の正しさは示しません。',
    '保存済み意味イベントの音高を接点用の4拍へ並べ替えています。元の全体演奏と同じ時刻ではありません。',
    ...(targetNotes.length < 4 ? ['4音に足りない保存済み音は順に繰り返しています。'] : []),
    ...(link.return_spans.length !== 1 ? ['返却候補を一つに定めず、相手の関数全体を示します。'] : []),
    ...(link.use_spans.length !== 1 ? ['利用箇所を一つに定めず、呼出箇所を示します。'] : []),
  ];
  return {
    status: 'ready',
    plan,
    phases,
    sourceNoteIds: motif.map((note) => note.note_id),
    callerVoiceNoteId: callerVoice.note_id,
    repeatedMotif: targetNotes.length < 4,
    limitations,
  };
}
