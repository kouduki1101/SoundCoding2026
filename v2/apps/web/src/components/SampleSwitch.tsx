export function SampleSwitch({ openSample }: { openSample: (id: string) => void }) {
  return (
    <details className="sample-switch">
      <summary data-tour="album">サンプル</summary>
      <div className="sample-menu">
        <strong>主デモ / Tsugiaiの実在コード</strong>
        <p>
          51ファイル・19,541行を参照。Checkout Agentの9実装の保存済みGemini解析を聴きます。ログイン・新規AI費用なし。
        </p>
        <button
          onClick={(event) => {
            event.currentTarget.closest('.sample-switch')?.removeAttribute('open');
            openSample('recorded-tsugiai-agents');
          }}
        >
          実コードの主デモを開く
        </button>
        <small>9実装の保存記録と、全体の参考コードは別です。残りの範囲・動作・リポジトリ全体は未判定。</small>
        <strong>音の比較教材 / 店舗とWebの返品ルール</strong>
        <p>小さな教材で三つの判断の音と、双方の根拠行を比べます。</p>
        <button
          onClick={(event) => {
            event.currentTarget.closest('details')?.removeAttribute('open');
            openSample('recorded-returns-before');
          }}
        >
          音と意味の比較教材を開く
        </button>
        <small>
          教材の保存済み実解析 · 5実装 · 新規モデル呼び出しなし
        </small>
        <a
          href="https://github.com/kdoai/tsugiai/tree/35a951488d7b00518e7e73a329d46713cbeacbe8/agents/checkout_agent"
          target="_blank"
          rel="noreferrer"
        >
          元のコードを読む ↗
        </a>
        <details>
          <summary>小さな教材も試す / Checkout Lab</summary>
          <button
            onClick={(event) => {
              event.currentTarget.closest('.sample-switch')?.removeAttribute('open');
              openSample('recorded-checkout-flow');
            }}
          >
            教材サンプルを開く
          </button>
          <a href="/samples/checkout-lab.zip" download>
            動くプロジェクトをダウンロード
          </a>
          <small>ZIPを展開し、Node.js 22以上で起動</small>
          <code>
            npm ci
            <br />
            npm start
          </code>
          <a href="http://127.0.0.1:4174" target="_blank" rel="noreferrer">
            起動したローカルデモを開く ↗
          </a>
          <small>検査対象は src の13関数。画面・起動用サーバーは保存済み解析の対象外です。</small>
        </details>
      </div>
    </details>
  );
}
