import type {
  CallRelationships,
  Span,
  StaticCallLink,
} from '../../../../packages/contracts/CallRelationships';
import type { ImplementationUnit } from '../../../../packages/contracts/SemanticMap';

export type RehearsalCaseId = 'web' | 'store';

export const rehearsalCases = {
  web: {
    id: 'web',
    label: 'Web返品',
    caller: 'submitWebReturn',
    beforeTarget: 'quoteWebReturn',
    afterTarget: 'evaluateReturnPolicy',
    questionHint: 'Web固有の条件が、共通の返品ルールへ移った後も保たれるか？',
  },
  store: {
    id: 'store',
    label: '店舗返品',
    caller: 'submitStoreReturn',
    beforeTarget: 'quoteStoreReturn',
    afterTarget: 'evaluateReturnPolicy',
    questionHint: '店舗固有の条件が、共通の返品ルールへ移った後も保たれるか？',
  },
} as const;

function sameSpan(a: Span, b: Span) {
  return (
    a.file_id === b.file_id && a.path === b.path && a.start_line === b.start_line && a.end_line === b.end_line
  );
}

export type RehearsalLinkSelection =
  { status: 'ready'; link: StaticCallLink } | { status: 'unavailable'; message: string };

export function selectRehearsalLink(
  relationships: CallRelationships,
  caller: ImplementationUnit,
  target: ImplementationUnit,
): RehearsalLinkSelection {
  if (relationships.status !== 'ready' || !sameSpan(relationships.unit_span, caller.primary_span)) {
    return { status: 'unavailable', message: 'この版の呼出関係を確認できません。' };
  }
  const matches = relationships.links.filter(
    (link) =>
      link.resolution === 'static_definition' &&
      link.name === target.label &&
      link.callee_span !== null &&
      sameSpan(link.callee_span, target.primary_span),
  );
  if (matches.length !== 1) {
    return {
      status: 'unavailable',
      message:
        matches.length > 1
          ? '同じ相手への呼出しが複数あり、この一場面を一意に選べません。'
          : '対象の呼出先を静的に確認できません。コードから確かめてください。',
    };
  }
  return { status: 'ready', link: matches[0] };
}

export function codeExcerpt(sources: Record<string, string>, span: Span | undefined, count = 5) {
  if (!span || typeof sources[span.path] !== 'string') return null;
  const lines = sources[span.path].split(/\r?\n/);
  const focus = Math.min(Math.max(span.start_line, 1), lines.length);
  const first = Math.max(1, Math.min(focus - Math.floor(count / 2), lines.length - count + 1));
  return {
    path: span.path,
    focus,
    lines: lines.slice(first - 1, first + count - 1).map((text, index) => ({ number: first + index, text })),
  };
}
