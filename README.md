# Google Books MCP Server

Google Books APIを使って書籍を自然言語で検索し、ISBN付きの書籍リストを返すMCPサーバです。

## 機能

- 自然言語のキーワードで書籍を全文検索（日本語・英語対応）
- タイトル・著者・出版社・ISBN-13/ISBN-10 を一覧表示
- 取得件数を 1〜40 件の範囲で指定可能

## 必要環境

- Node.js 18 以上（組み込み `fetch` を使用）
- Google Books API キー

## セットアップ

### 1. Google Books API キーの取得

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「APIとサービス」→「ライブラリ」で **Books API** を有効化
3. 「APIとサービス」→「認証情報」で **APIキー** を作成

> 料金：無料（1日1,000リクエストまで）

### 2. 依存パッケージのインストールとビルド

```bash
cd /Users/makiuchi/Documents/mcpsample
npm install
npm run build
```

`build/index.js` が生成されます。

## ツール仕様

### `search_books`

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `query` | string | ✓ | — | 自然言語の検索クエリ（例：「Pythonの入門書」） |
| `maxResults` | number | — | 10 | 取得件数（1〜40） |

**出力例:**

```
1. 「入門 Python 3」
   著者: Bill Lubanovic
   出版社: オライリー・ジャパン
   ISBN-13: 9784873117386
   ISBN-10: 4873117380

2. 「Pythonチュートリアル」
   著者: Guido van Rossum
   出版社: Python Software Foundation
   ISBN情報なし
```

## 動作確認

### MCP Inspector で単体テスト（Claude Desktop不要）

```bash
GOOGLE_BOOKS_API_KEY=your_api_key npx @modelcontextprotocol/inspector node build/index.js
```

ブラウザで Inspector が開くので、`search_books` ツールを選んでクエリを入力してテストできます。

### テストケース

| クエリ | 期待される結果 |
|---|---|
| `Python 入門` | 書籍リストとISBNが返る |
| `machine learning` | 英語書籍も検索できる |
| `zzzzzznotexist99999` | 「見つかりませんでした」メッセージ |
| （APIキー未設定） | 明確なエラーメッセージ |

## AWS App Runner へのデプロイ

HTTPエンドポイント（`/mcp`）として公開し、AWS App Runner で稼働させる手順です。

### 前提条件

- AWS CLI が設定済みであること（`aws configure` または `--profile` 指定）
- Docker がインストール済みであること
- 対象リージョン: `ap-northeast-1`（変更する場合は以下のコマンド内を置き換え）

以降の例では `<ACCOUNT_ID>` を実際の AWS アカウント ID に読み替えてください。

---

### 1. ECR リポジトリ作成

```bash
aws ecr create-repository --repository-name mcp-booksearch --region ap-northeast-1
```

### 2. IAM ロール作成

**App Runner → ECR アクセス用ロール**（イメージ取得に使用）

```bash
aws iam create-role \
  --role-name AppRunnerECRAccessRole \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"build.apprunner.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy \
  --role-name AppRunnerECRAccessRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

**App Runner インスタンスロール**（Secrets Manager アクセスに使用）

```bash
aws iam create-role \
  --role-name AppRunnerInstanceRole \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"tasks.apprunner.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'

aws iam put-role-policy \
  --role-name AppRunnerInstanceRole \
  --policy-name SecretsManagerAccess \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":"secretsmanager:GetSecretValue",
      "Resource":"arn:aws:secretsmanager:ap-northeast-1:<ACCOUNT_ID>:secret:mcp-booksearch/*"
    }]
  }'
```

### 3. Secrets Manager に API キーを登録

> **注意:** シークレットはプレーンな文字列（キーの値のみ）で保存してください。JSON形式にすると環境変数にJSON文字列がそのまま注入されてしまいます。

```bash
aws secretsmanager create-secret \
  --name mcp-booksearch/google-books-api-key \
  --secret-string 'YOUR_GOOGLE_BOOKS_API_KEY' \
  --region ap-northeast-1
```

作成後に表示される ARN（`arn:aws:secretsmanager:...:secret:mcp-booksearch/google-books-api-key-XXXXXX`）を手順5で使います。

### 4. Docker イメージをビルドして ECR にプッシュ

Apple Silicon (M1/M2/M3) の場合は `--platform linux/amd64` が必須です。

```bash
# ECR にログイン
aws ecr get-login-password --region ap-northeast-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com

# ビルド・タグ・プッシュ
docker build --platform linux/amd64 -t mcp-booksearch .
docker tag mcp-booksearch:latest <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/mcp-booksearch:latest
docker push <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/mcp-booksearch:latest
```

### 5. App Runner サービス作成

```bash
aws apprunner create-service \
  --service-name mcp-booksearch \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "<ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/mcp-booksearch:latest",
      "ImageConfiguration": {
        "Port": "8080",
        "RuntimeEnvironmentSecrets": {
          "GOOGLE_BOOKS_API_KEY": "<SECRET_ARN>"
        }
      },
      "ImageRepositoryType": "ECR"
    },
    "AuthenticationConfiguration": {
      "AccessRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/AppRunnerECRAccessRole"
    }
  }' \
  --instance-configuration '{
    "Cpu": "0.25 vCPU",
    "Memory": "0.5 GB",
    "InstanceRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/AppRunnerInstanceRole"
  }' \
  --health-check-configuration '{
    "Protocol": "HTTP",
    "Path": "/health",
    "Interval": 10,
    "Timeout": 5,
    "HealthyThreshold": 1,
    "UnhealthyThreshold": 5
  }' \
  --region ap-northeast-1
```

デプロイ完了（`RUNNING` になるまで約5〜8分）を確認:

```bash
aws apprunner describe-service \
  --service-arn <SERVICE_ARN> \
  --region ap-northeast-1 \
  --query 'Service.Status' --output text
```

### 6. 動作確認

```bash
# ヘルスチェック
curl https://<SERVICE_URL>/health
# → {"status":"ok"}

# MCP initialize
curl -X POST https://<SERVICE_URL>/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# 書籍検索
curl -X POST https://<SERVICE_URL>/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_books","arguments":{"query":"Pythonの入門書","maxResults":3}}}'
```

### 7. MCP クライアントへの登録

```json
{
  "mcpServers": {
    "google-books": {
      "url": "https://<SERVICE_URL>/mcp"
    }
  }
}
```

### イメージ更新・再デプロイ

コードを変更した場合は手順4を再実行後、以下で再デプロイします:

```bash
aws apprunner start-deployment \
  --service-arn <SERVICE_ARN> \
  --region ap-northeast-1
```

### API キーの更新

```bash
aws secretsmanager update-secret \
  --secret-id mcp-booksearch/google-books-api-key \
  --secret-string 'NEW_API_KEY' \
  --region ap-northeast-1
```

更新後は再デプロイが必要です。

---

## Claude Desktop への登録

`~/Library/Application Support/Claude/claude_desktop_config.json` に追記します。

```json
{
  "mcpServers": {
    "google-books": {
      "command": "node",
      "args": ["/Users/makiuchi/Documents/mcpsample/build/index.js"],
      "env": {
        "GOOGLE_BOOKS_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

設定後は Claude Desktop を完全に再起動してください。

登録後は「Pythonの入門書を探して」などと質問するだけで書籍を検索できます。

## ファイル構成

```
mcpsample/
├── src/
│   └── index.ts        # MCPサーバ本体
├── build/              # コンパイル後（git除外）
├── package.json
├── tsconfig.json
└── .gitignore
```

## 開発

TypeScriptのウォッチモード（ファイル変更を検知して自動コンパイル）:

```bash
npm run dev
```
