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
