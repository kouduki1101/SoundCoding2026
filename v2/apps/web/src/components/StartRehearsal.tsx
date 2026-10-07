import { ArrowRight, Code2, Headphones, MessageSquareText, Play } from 'lucide-react';
import '../styles/start-rehearsal.css';

export function StartRehearsal({
  start,
  openRepository,
  openAnalysis,
  staticDemo = false,
}: {
  start: () => void;
  openRepository: () => void;
  openAnalysis: () => void;
  staticDemo?: boolean;
}) {
  return (
    <main className="start-rehearsal">
      <div className="start-rehearsal-inner">
        <section className="start-rehearsal-hero">
          <span className="start-rehearsal-eyebrow"><span aria-hidden="true" /> CODE REVIEW, REHEARD</span>
          <h1>
            コードの変化を聴いて、
            <br />
            <em>レビューの問い</em>に変える。
          </h1>
          <p>
            差分の一行からは見えにくい、関数同士のやり取り。
            変更前後を短く聴き比べ、気になった音から根拠コードへ進めます。
          </p>
          <div className="start-rehearsal-actions">
            <button className="primary start-rehearsal-primary" onClick={start}>
              <Play size={18} fill="currentColor" />
              サンプルでレビューを始める
              <ArrowRight size={17} />
            </button>
            {!staticDemo && (
              <button className="start-rehearsal-secondary" onClick={openRepository}>
                公開PRのコードを調べる（ログイン）
              </button>
            )}
          </div>
          <small>
            {staticDemo
              ? 'この公開デモは保存済みのGemini解析を再生します。新しいPRの解析は利用できません。'
              : 'サンプルはログイン不要。保存済みのGemini解析を使い、新しいAI解析は始まりません。'}
          </small>
        </section>
        <div className="start-rehearsal-preview" aria-hidden="true">
          <div className="start-rehearsal-preview-head">
            <span><i /><i /><i /></span>
            <b>REVIEW SESSION / 01</b>
            <small>約20秒</small>
          </div>
          <div className="start-rehearsal-preview-body">
            <span className="start-rehearsal-preview-kicker">変更された接点</span>
            <strong>返品判断は、どの関数へ？</strong>
            <div className="start-rehearsal-preview-track">
              <span>変更前</span>
              <div className="start-rehearsal-preview-notes before"><i /><i /><i /><i /><i /><i /></div>
              <code>quoteWebReturn</code>
            </div>
            <div className="start-rehearsal-preview-track">
              <span>変更後</span>
              <div className="start-rehearsal-preview-notes after"><i /><i /><i /><i /><i /><i /></div>
              <code>evaluateReturnPolicy</code>
            </div>
            <div className="start-rehearsal-preview-question">
              <span>気づきから問いへ</span>
              <p>Webと店舗で、同じ返品条件を使う意図ですか？</p>
            </div>
          </div>
        </div>
      </div>
      <div className="start-rehearsal-bottom">
        <div className="start-rehearsal-step">
          <span><Headphones size={19} /></span>
          <div><b>01 · 聴き比べる</b><small>前→後を同じ長さで再生</small></div>
        </div>
        <div className="start-rehearsal-step">
          <span><Code2 size={19} /></span>
          <div><b>02 · コードで確かめる</b><small>音と呼出し・返却の根拠を同期</small></div>
        </div>
        <div className="start-rehearsal-step">
          <span><MessageSquareText size={19} /></span>
          <div><b>03 · 問いを残す</b><small>推測と確認した事実を分けて共有</small></div>
        </div>
        <button onClick={openAnalysis}>全体の譜面も探索する <ArrowRight size={14} /></button>
      </div>
    </main>
  );
}
