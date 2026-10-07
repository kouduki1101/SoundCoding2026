# CI/CD

GitHub ActionsからCloud BuildとCloud Runへ配備します。

## PR

PRを作成・更新すると、変更箇所に応じたテスト、型検査、lint、ビルド、ブラウザE2Eと秘密情報検査を実行します。解析対象のコードを実行したり、有料モデルを呼び出したりしません。

## mainへのマージ

1. mainのcommitに対してテストと秘密情報検査を実行します。
2. 両方が成功した場合、Workload Identity FederationでGCPの短期認証を取得します。
3. Cloud Buildでコンテナを作り、commit SHAをタグとしてArtifact Registryへ保存します。
4. 同じイメージをCloud Runのwebとworkerへ配備します。
5. 両サービスのイメージ・revision・トラフィック、ヘルスチェック、アクセス制御、公開サンプルを確認します。

検査が失敗すると配備ジョブは実行されません。PRからは本番を配備しません。実行中の配備を新しいcommitで中断せず、配備を直列に処理します。

GCP側の認証条件は、このリポジトリのmainとproduction環境に限定します。サービスアカウントの秘密鍵は使いません。認証設定と私有データをビルド対象へ含めません。

## 再実行

GitHub Actionsの「CI and deploy」をmainで手動実行できます。その場合も検査を通してから配備します。同じcommitのイメージがすでにある場合は再利用します。

配備後の検証が失敗した場合は、ActionsとCloud Runの状態を確認し、[運用手順](runbook.md)に従って復旧します。
