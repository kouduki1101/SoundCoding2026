# 現行の変換ルールとAPI

対象は `StoryAnalyzer` の `ensemble-observations/2.0` と `StoryScore` の `story-score-2.1.0` です。音楽はコードの構造を読むための表現であり、実行トレース、型検証、品質点ではありません。

旧版の「boolean / { ok, … } を座標に置き、半音差で契約の不一致を鳴らす」方式は撤去しました。以下が現行仕様です。

## 1. 関数の声と、ブロックの奏法

関数IDはパスと宣言・束縛の名前に基づきます。そのIDから、5音の集合を使った4音の主題と、ピアノ・ピッツィカート・弦楽器の基本音色を決定します。主題は関数を識別するための目印です。型、作者、能力、業務上の役割を符号化していません。異なるIDに必ず異なる4音が割り当たるという保証もありません。

音色は構文の集計から推定した役割では変えません。関数のIDが同じなら、ループを書き加えても基礎主題と音色を保持します。比較時は、後述する一意な移動・改名の対応でも以前の声を引き継ぎます。

同じ録音楽器を使う声にも、IDに固定した `voiceToneRatio`（2 / 4 / 8 / 16）を持たせ、再生時のローパスフィルターで明るさを変えます。これは演奏する関数に従い、呼ぶ側・相手という立場や不具合判定で切り替えません。引用する旋律やリズムは変更しません。似た声が残る可能性と、実際に耳で識別できるかは別に検証します。

ブロックは関数本体直下の文です。空文を除き、式を本体とするarrow関数ではその式を一つのブロックとします。ネストしたすべての文が別パートになるわけではありません。各ブロックのASTと出現回数からIDを作り、ソース範囲を持たせます。

| 観察する構文 | ブロック内の奏法 |
| --- | --- |
| 通常の文 | 関数の4音を短い句として置く |
| reduce / reduceRight / map / filter / flatMap の呼出し | 間隔を変え、音を長めにつなぐ |
| for / while などの反復 | 主題の最初の2音を繰り返し、短く刻む |
| if / 条件式 / switch | 句の途中に間を置く |
| await | 最後の入口を遅らせる。実測した待ち時間ではない |

この分類は構文名の観察です。`reduce` というプロパティ呼出しの実装や、ループ回数・入力値まで確定するものではありません。同一ブロックに複数の構文がある場合は、生成器に記載した固定の順序で奏法を組み合わせます。

ASTの位置・コメント・raw表記は音の同一性から除外します。識別子やリテラル値などの構文内容は残します。同じブロックの音列を保つとは、相対的な発音時刻、音高、長さ、音色、音量係数を保つことです。別々に全曲を生成した際の絶対時刻まで、無関係な追加の前後で一定になるとは限りません。前後比較には共通の配置を使います。

## 2. 接点は、実際の相手の主題を引用する

静的に解決した呼出し一つにつき、二者の短い演奏を作ります。既定100 BPMで16拍、9.6秒です。

| 拍 | 演奏 | 根拠として示すコード |
| --- | --- | --- |
| 0–4 | 呼ぶ側の音色で、相手の4音を引用 | 呼出し式 |
| 4–8 | 相手が自分の音色で同じ4音に応答 | return候補が一つならその範囲。複数なら関数範囲 |
| 8–12 | 呼ぶ側が同じ4音を受け取る | 追跡できた利用箇所。なければ呼出し式 |
| 12–16 | 二者それぞれの主題を控えめに重ねる | 呼ぶ側と相手の範囲 |

相手を変えると、引用・応答・受取りの主題が変わります。相手自身の定義を変えていなければ、その関数の声は同じです。無関係な第三のパートは接点試聴に加えません。

この順番は音楽上の説明です。特定のreturnが実行された、期待する契約が合った、処理が成功したという意味ではありません。複数のreturn候補から、根拠なく一つの実行経路を選びません。

`expected`、`provided`、`projection` 等の観察データは、接点の音程をずらす判定には使いません。`if (result)` と `if (result.ok)` の違いだけでは、この引用・応答の音は変わりません。コードの変更をすべて聴き分けられるという主張はしません。

相手が範囲外なら `omittedConnections`、解析で相手を解決できなければモデルの診断に残します。存在しない相手の声、警告の半音、失敗を表す無応答を捏造しません。

## 3. 観察、意図、不明を分ける

解析はcompilerが取得したAcorn ASTを再利用します。上限は24ファイル、合計300,000文字、1ファイル150,000文字、18,000 ASTノード、400ブロックです。対応の中心は入力内のJavaScript ES modulesと名前を持つ関数です。内部の無名callbackを独立した声として追加しません。

入力内で解決できた直接呼出しに加え、`price = quote` のような既定引数の一部を扱います。後者は引数を省略した場合の候補であり、実際に別の関数を渡した実行は未確認と示します。

返却側は直接記述された正常なreturn候補について、booleanリテラル、プレーンなobject、booleanの `ok` プロパティ等を観察します。間接的な返却、object/nullの混在、暗黙のreturn、async/generatorのラッパーなどは未確定になり得ます。これは例外が起きないことや、全実行の返却値の証明ではありません。

利用側は、関数本体に直接宣言したローカル変数への代入と、その変数全体または直接のプロパティを使う限定した `if` を追います。再代入、shadowing、複数の異なる利用などでは、単一の意味へ決めつけません。

- `usageKind` は観察した使い方です。存在確認をboolean成功契約とは読み替えません。
- `expected: "unknown"`、`correctness: "unknown"`、`review: false` を保ちます。`{ ok, … }` 全体への真偽判定は確認する問いの候補であり、自動の不具合認定ではありません。
- `roleMetadata` は構文上の分類で、作者・業務役割・品質は付与しません。音色の決定にも使いません。

`investigate(model, connectionId)` は `facts`、`unknowns`、`question`、`nextSources` を返します。呼出し箇所、返却原文、追跡できた利用を集めるローカル処理です。外部のコードを自律的に探すAI、仕様の正しさの判定、テスト実行は含みません。

### コードの楽評

`src/code-critique.js` の `StoryCritique.review` が、選択した関数のAST、接点の観察、対応する前の版からコード批評を規則で組み立てます。シーンIDやfixture名による分岐はありません。外部送信やAI生成を行わず、楽譜も変更しません。

画面では見出し、書き方の読解、相手との関係や変更、確かめたい問い、音楽的な比喩の順に読みます。一文で呼出し結果を返す委譲、reduce、反復、条件分岐などを実コードから扱い、主題の音名や再生エンジンの説明を楽評の中心にはしません。「この読み取りの根拠」は原文の抜粋とコードへのリンクです。

呼出先が変わった場合は旧・新の相手と、直接記述されたreturnのリテラル値の差を扱います。値全体の真偽判定と `ok` の利用は、根拠を取れた範囲の言語上の振る舞いとして読みます。存在確認を不具合と決めつけず、業務上の意図は仕様やテストで確かめる問いへ残します。

「リフを重ねる」「レガートの続く句」「短い小品」は書きぶりの比喩です。ロック等のジャンルを自動判定・生成した、作者の能力を評価したという意味ではありません。`soundStatus` は、受取条件の差など現在の接点音に未反映の部分を明示します。批評で読めた違いを、既に不協和音として再生できているとは説明しません。

## 4. 前後比較と配置

`buildComparison` は単一版の楽譜を二つ無関係に作るのではなく、共通の配置と声を作ります。

1. 同じ関数IDを対応させる。
2. 未対応の関数は、名前以外の宣言ASTが両版全体で一意に一致する場合だけ移動・改名として対応させる。複製、本文変更、再帰呼出しの名前変更などは、自動で同一と決めない。
3. ブロックの構文と出現回数を用い、両版のソース順を保つ共通の枠を作る。追加・削除・移動では片方に空き枠ができる場合がある。空きはテスト失敗を示さない。
4. 接点は、呼出先だけを除いた呼出し箇所の構造が一意に一致すれば、相手が変わっても同じ比較枠へ置く。重複などで曖昧なら、その相手変更を確定した対応として扱わない。

ブロックは2拍ずつ、関数の紹介は主題を含め最低16拍、接点は16拍です。長いコードでは曲が長くなり、一定秒数へ押し込むためにテンポを変えません。旧版の `durationSec` による曲の圧縮は行いません。

比較では音量・テンポ・演奏範囲も同条件にします。対応できない側を、無関係な接点とのA/Bとして提示してはいけません。画面は対応する関数または接点を前→後の順に試聴します。変更・重複ブロックの局所対応を確定できない場合、関数単位の比較へ戻ります。

## 5. API

ブラウザでは `StoryAnalyzer`、`StoryScore`、`StoryCritique`、NodeではCommonJSとして利用できます。以下はリポジトリのルートからの例です。入力ソースは実行しません。

```js
const Analyzer = require('./src/story-analyzer.js');
const Score = require('./src/score-generator.js');
const parser = require('./src/vendor/acorn.js');
const compiler = require('./src/vendor/score-compiler.js');
const scene = require('./src/review-scenes.json').scenes[0];

const before = Analyzer.analyze(scene.before, { parser, compiler });
const after = Analyzer.analyze(scene.after, { parser, compiler });
const pair = Score.buildComparison(before, after, { bpm: 100 });
const shared = pair.relationPairs.find(p => p.beforeId && p.afterId);

const excerpt = Score.buildComparison(before, after, {
  bpm: 100,
  mode: 'relation',
  connectionId: shared.beforeId
});
```

主な入口と出力は以下です。

| API | 内容 |
| --- | --- |
| `Analyzer.analyze(files, { parser, compiler })` | `functions`、文単位の`blocks`、`connections`、`diagnostics`、`errors`、入力`files` |
| `Analyzer.investigate(model, connectionId)` | 根拠、未確認事項、一つの問い、次に読むソース範囲 |
| `StoryCritique.review(model, fnId, connectionId, options)` | `heading`、`prose`、`relationship`、`question`、`musicalMetaphor`、`soundStatus`、根拠の`sources`。比較には`previousModel`、`previousConnectionId`、`previousFunctionId`を渡す。 |
| `Score.buildScore(model, options)` | `events`、`sections`、`profiles`、`relations`、`omittedConnections`、`bpm`、`durationSec` |
| `Score.buildComparison(before, after, options)` | 両版のscoreと、`functionPairs` / `relationPairs` による対応 |
| `mode: 'relation', connectionId` | 選択した接点だけの演奏 |
| `mode: 'block', focusId` | 対象関数の節と関連する接点の節。UIの声単独ボタンとは範囲が異なる |

各イベントには `at`、`duration`、`midi`、`gain`、`part`、`instrument`、`voiceToneRatio`、`themeId`、`blockId`、`sectionId`、`source` を含みます。接点には `connectionId` と `phase` も含みます。`part` は演奏する関数、`themeId` は引用する主題の持ち主です。

`source.kind === 'block'` は根拠となる文範囲です。接点のsourceは `caller`、`callee`、`call`、`use`、`returns` と、当該局面の `active` を保持します。強調行は実行中の行ではありません。

録音音源を使う `ScorePlayer` には、イベントへ `notes: [event.midi]`、`velocity: event.gain` を付けて渡します。生成器自体は音源をロードしません。scoreの末尾には0.35秒の余白があり、9.6秒の接点だけを作ったscoreの `durationSec` は9.95秒です。UIの接点範囲は節の開始・終了を使います。

## 6. 検証の境界

テスト失敗を理由とする停止は、この生成器にはありません。UIで明示的に選んだ場合だけ、ソース版が一致する保存済みの失敗記録を示すために中断します。その中断時刻は実行時刻やクラッシュした行ではありません。

[楽譜の回帰テスト](../tests/score-generator.test.cjs)、[解析の回帰テスト](../tests/story-analyzer.test.cjs)、[独立fixtureのQA計画](../fixtures/review-cases/QA.md) を参照してください。自動テストによるイベント一致と、実際の耳での識別・楽しさ・有用性は別の評価です。現行方式の利用者による実聴評価は未実施です。
