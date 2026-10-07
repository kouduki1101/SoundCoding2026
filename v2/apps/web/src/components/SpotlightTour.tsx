import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Pause, Play, X } from 'lucide-react';
import { engine } from '../audio/engine';

const steps = [
  {
    target: 'album',
    title: '01 / 何の音かを確かめる',
    copy: '実在するTsugiaiの確定版を表示します。51ファイル・19,541行の参考コードと、Checkout Agentの9実装をGeminiが読んだ保存記録です。参考コードに未解析の音は付きません。',
  },
  {
    target: 'play',
    title: '02 / 音から実コードへ戻る',
    copy: '発音中のファイルと根拠行を、下のコード画面が追いかけます。同じ責務・意味キーに同じ音高を割り当てます。伴奏の心地よさは、コードの品質の判定ではありません。',
    action: '[data-tour="play"]',
  },
  {
    target: 'review-focus',
    title: '03 / 確認したい箇所を絞って聴く',
    action: '[data-tour="review-focus"] summary',
    copy: '「確認候補」で根拠行を選び、「伴奏なしで聴く」で判断の打点を聴きます。保存された懸念には反証未確認のものもあります。欠陥と断定せず、右の説明とコードで確かめてください。質問はログイン前から入力できます。',
  },
];

export function SpotlightTour({ close, ready = true }: { close: () => void; ready?: boolean }) {
  const [step, setStep] = useState(0),
    [automatic, setAutomatic] = useState(false);
  const [rect, setRect] = useState<DOMRect>(),
    [hide, setHide] = useState(false);
  const performed = useRef(new Set<number>());
  const current = steps[step];
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    let previous = '';
    document.querySelector(`[data-tour="${current.target}"]`)?.scrollIntoView({ block: 'nearest' });
    const update = () => {
      const target = document.querySelector(`[data-tour="${current.target}"]`);
      if (target) {
        let next = target.getBoundingClientRect();
        const content = target.matches('details[open]') ? target.querySelector('[data-tour-content]') : null;
        if (content) {
          const bounds = content.getBoundingClientRect();
          const left = Math.min(next.left, bounds.left),
            top = Math.min(next.top, bounds.top);
          next = new DOMRect(
            left,
            top,
            Math.max(next.right, bounds.right) - left,
            Math.max(next.bottom, bounds.bottom) - top,
          );
        }
        const position = `${next.left}:${next.top}:${next.width}:${next.height}`;
        if (position !== previous) {
          previous = position;
          setRect(next);
        }
      } else if (previous !== 'missing') {
        previous = 'missing';
        setRect(undefined);
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [step, ready, current.target]);
  useEffect(() => {
    if (!ready || performed.current.has(step)) return;
    performed.current.add(step);
    const action = current.action ? document.querySelector<HTMLButtonElement>(current.action) : null;
    if (
      action &&
      !(current.target === 'play' && engine.playing) &&
      !(current.target === 'review-focus' && action.closest('details')?.open)
    )
      action.click();
  }, [step, ready, current]);
  useEffect(() => {
    if (!automatic || !ready) return;
    const timer = setTimeout(
      () => {
        if (step < steps.length - 1) setStep(step + 1);
        else setAutomatic(false);
      },
      step === 1 || step === 4 ? 9000 : 7000,
    );
    return () => clearTimeout(timer);
  }, [automatic, step, ready]);
  function finish() {
    engine.pause();
    if (hide) localStorage.setItem('code-groove-hide-guide', 'true');
    close();
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  });
  return (
    <div className="spotlight-tour" role="region" aria-label="実画面の使い方デモ">
      {rect && (
        <div
          className="spotlight-window"
          style={{ left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16 }}
        />
      )}
      <div
        className={`tour-card ${step === steps.length - 1 ? 'tour-left' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-label={current.title}
      >
        <button className="tour-close" aria-label="デモを閉じる" onClick={finish}>
          <X size={17} />
        </button>
        <span className="eyebrow">
          SAVED ANALYSIS WALKTHROUGH · {step + 1} / {steps.length}
        </span>
        <h3>{current.title}</h3>
        <p>{current.copy}</p>
        <div className="tour-progress">
          {steps.map((_, i) => (
            <button
              key={i}
              aria-label={`デモの段階 ${i + 1}`}
              aria-pressed={i === step}
              onClick={() => setStep(i)}
            />
          ))}
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />
          今後このメッセージを表示しない
        </label>
        <div className="dialog-actions">
          <button onClick={() => setAutomatic(!automatic)}>
            {automatic ? <Pause size={14} /> : <Play size={14} />}
            {automatic ? '自動案内を停止' : '自動で見る'}
          </button>
          <button
            className="primary"
            disabled={!ready}
            onClick={() => (step < steps.length - 1 ? setStep(step + 1) : finish())}
          >
            {step === steps.length - 1 ? '自分で使ってみる' : '次へ'}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
