# CuraQ MCP Server

CuraQに保存した記事をMCP対応ツール（Claude Desktop、Claude Code、Cursor、VSCodeなど）から検索・参照できるMCPサーバーです。

## インストール

```bash
npm install -g @curaq/mcp-server
```

または、npxで直接実行：

```bash
npx @curaq/mcp-server
```

## セットアップ

### 1. MCPトークンの取得

1. [CuraQ](https://curaq.pages.dev)にログイン
2. 設定 > 開発者向け > MCPトークン にアクセス
3. 新しいトークンを生成（例: "Claude Desktop"）
4. 生成されたトークンをコピー（一度だけ表示されます）

### 2. MCP対応ツールへの設定

#### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) または
`%APPDATA%\Claude\claude_desktop_config.json` (Windows) を編集：

```json
{
  "mcpServers": {
    "curaq": {
      "command": "npx",
      "args": ["-y", "@curaq/mcp-server"],
      "env": {
        "CURAQ_MCP_TOKEN": "your-token-here"
      }
    }
  }
}
```

#### Claude Code

Claude Codeの設定ファイルに同様の設定を追加します。

#### Cursor / VSCode

Cursor や VSCode の MCP 設定ファイルに以下を追加します（プラグインによって設定方法が異なります）。

---

## 機能

このMCPサーバーは、以下のツールを提供します：

### 1. `list_articles`
未読記事の一覧を優先度順に取得します。

**パラメータ:**
- `limit` (オプション): 取得する記事数の上限（デフォルト: 10、最大: 30）

**使用例:**
```
未読記事を10件リストアップして
```

### 2. `search_articles`
記事を検索します。キーワード検索またはAIセマンティック検索を選択できます。

**検索モード:**
- **semantic** (デフォルト): AI意味理解ベースの検索
  - 同義語や関連トピックも検出
  - 自然言語での質問にも対応
  - ベクトル類似度を使用
- **keyword**: 従来のキーワード検索
  - タイトル、要約、タグから部分一致検索
  - 完全一致や特定の用語を探す場合に有効

**パラメータ:**
- `query` (必須): 検索キーワードまたは検索クエリ
- `mode` (オプション): 検索モード (`semantic` または `keyword`、デフォルト: `semantic`)
- `limit` (オプション): 取得する記事数の上限（デフォルト: 10、最大: 30）

**使用例:**
```
「TypeScript」に関する記事を検索して
→ デフォルトでセマンティック検索が実行されます

「パフォーマンス最適化の方法」について関連する記事を探して
→ 意味を理解して関連記事を検索

「React」というキーワードを含む記事を正確に検索して
→ mode=keywordでキーワード検索も可能
```

### 3. `get_article`
記事IDを指定して特定の記事の詳細を取得します。

**パラメータ:**
- `article_id` (必須): 記事のID（UUID形式）

**使用例:**
```
記事ID「abc123...」の詳細を取得して
```

### 4. `update_article_status`
記事のステータスを更新します。既読マークまたは削除ができます。

**パラメータ:**
- `article_id` (必須): 記事のID（UUID形式）
- `action` (必須): 実行するアクション（`read`: 既読にする、`delete`: 削除する）

**使用例:**
```
記事ID「abc123...」を既読にして
```

### 5. `save_article`
新しい記事をCuraQに保存します。URLを指定すると、AIが自動的に記事を分析してタイトル、要約、タグを生成します。

**パラメータ:**
- `url` (必須): 保存する記事のURL
- `title` (オプション): 記事のタイトル（省略時はAIが自動生成）
- `markdown` (オプション): 記事のMarkdown本文（指定すると分析精度が向上）

**使用例:**
```
「https://example.com/article」を保存して
```

---

## 環境変数

| 変数名 | 説明 | 必須 | デフォルト |
|--------|------|------|-----------|
| `CURAQ_MCP_TOKEN` | CuraQで生成したMCPトークン | ✅ 必須 | - |
| `CURAQ_API_URL` | CuraQ APIのURL | オプション | `https://curaq.pages.dev` |

---

## 使い方

設定が完了すると、Claude DesktopやClaude Codeなどで以下のように質問できます：

### 記事の検索
デフォルトでAIセマンティック検索が使用され、意味を理解して関連記事を見つけます：

```
「React」に関する記事を検索して
→ セマンティック検索で関連記事を取得
```

```
「パフォーマンス最適化の方法」について関連する記事を探して
→ 自然言語の質問にも対応
```

```
「機械学習で何を読んだか教えて」
→ 同義語や関連トピックも検出
```

正確なキーワードマッチが必要な場合は、明示的に指定することもできます。

### 記事の管理
```
CuraQの未読記事をリストアップして
```

```
最近保存した記事の中で、読了時間が5分以内のものを教えて
```

```
「https://example.com/article」を保存して
```

---

## トラブルシューティング

### 認証エラーが発生する

- `CURAQ_MCP_TOKEN` が正しいか確認してください
- トークンが削除されていないか、[CuraQ設定ページ](https://curaq.pages.dev/settings/access-token)で確認してください

### 記事が取得できない

- CuraQに記事を保存しているか確認してください
- トークンが有効か確認してください

### MCPサーバーが起動しない

- Node.js 18以上がインストールされているか確認してください
- npxの場合、インターネット接続を確認してください

---

## 開発

### ビルド

```bash
pnpm install
pnpm run build
```

### Watch モード

```bash
pnpm run watch
```

### リリース

`main`ブランチにpushすると、GitHub Actionsが自動で以下を実行します：

1. `package.json`のバージョンを確認
2. 同じバージョンのリリースがなければ、GitHubリリースを作成
3. npmに公開（OIDC Trusted Publishing）

**リリース手順：**
1. `package.json`のバージョンを上げる
2. `main`にpush
3. 自動でリリース&npm公開

※ npmへの公開はOIDC Trusted Publishingを使用。npmjs.comでTrusted Publisherの設定が必要です。

---

## ライセンス

MIT

---

## リンク

- [CuraQ](https://curaq.pages.dev)
- [npm Package](https://www.npmjs.com/package/@curaq/mcp-server)

---
