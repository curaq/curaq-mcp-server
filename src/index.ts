#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Environment variables
const CURAQ_API_URL = process.env.CURAQ_API_URL || "https://curaq.pages.dev";
const CURAQ_MCP_TOKEN = process.env.CURAQ_MCP_TOKEN;

if (!CURAQ_MCP_TOKEN) {
  console.error("Error: Missing required environment variable");
  console.error("Required: CURAQ_MCP_TOKEN");
  console.error("\nPlease generate a token at: https://curaq.pages.dev/settings/access-token");
  process.exit(1);
}

// Article type definition
interface Article {
  id: string;
  url: string;
  title: string;
  summary: string;
  tags: string[];
  reading_time_minutes: number;
  content_type: string;
  priority?: number;
  created_at?: string;
  status?: string;
  date?: string;
}

// Define tools
const TOOLS: Tool[] = [
  {
    name: "list_articles",
    description:
      "未読記事の一覧を優先度順に取得します。記事のタイトル、要約、タグ、読了時間などの情報を返します。",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "取得する記事数の上限（デフォルト: 20、最大: 50）",
          default: 20,
        },
      },
    },
  },
  {
    name: "search_articles",
    description:
      "記事を検索します。キーワード検索またはAIセマンティック検索を選択できます。セマンティック検索は意味を理解して同義語や関連トピックも検出でき、自然言語の質問にも対応します。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "検索キーワードまたは検索クエリ（自然言語での質問も可）",
        },
        mode: {
          type: "string",
          enum: ["keyword", "semantic"],
          description: "検索モード（keyword: キーワード検索、semantic: AIセマンティック検索）",
          default: "semantic",
        },
        limit: {
          type: "number",
          description: "取得する記事数の上限（デフォルト: 10、最大: 30）",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_article",
    description: "記事IDを指定して特定の記事の詳細を取得します。",
    inputSchema: {
      type: "object",
      properties: {
        article_id: {
          type: "string",
          description: "記事のID（UUID形式）",
        },
      },
      required: ["article_id"],
    },
  },
  {
    name: "update_article_status",
    description: "記事のステータスを更新します。既読マークまたは削除ができます。",
    inputSchema: {
      type: "object",
      properties: {
        article_id: {
          type: "string",
          description: "記事のID（UUID形式）",
        },
        action: {
          type: "string",
          enum: ["read", "delete"],
          description: "実行するアクション（read: 既読にする、delete: 削除する）",
        },
      },
      required: ["article_id", "action"],
    },
  },
  {
    name: "save_article",
    description: "新しい記事をCuraQに保存します。URLを指定すると、AIが自動的に記事を分析してタイトル、要約、タグを生成します。",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "保存する記事のURL（必須）",
        },
        title: {
          type: "string",
          description: "記事のタイトル（オプション、省略時はAIが自動生成）",
        },
        markdown: {
          type: "string",
          description: "記事のMarkdown本文（オプション、指定すると分析精度が向上）",
        },
      },
      required: ["url"],
    },
  },
];

// Create MCP server
const server = new Server(
  {
    name: "curaq-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_articles": {
        const limit = Math.min((args?.limit as number) || 20, 50);

        const response = await fetch(
          `${CURAQ_API_URL}/api/v1/articles?limit=${limit}`,
          {
            headers: {
              Authorization: `Bearer ${CURAQ_MCP_TOKEN}`,
            },
          }
        );

        if (!response.ok) {
          const error = await response.text();
          return {
            content: [
              {
                type: "text",
                text: `エラー (${response.status}): ${error}`,
              },
            ],
          };
        }

        const data = await response.json() as { articles?: Article[] };
        const articles = data.articles || [];

        if (articles.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "未読記事がありません。",
              },
            ],
          };
        }

        const articlesList = articles.map((article: Article, index: number) => {
          return `[${index + 1}] ${article.title} (${article.reading_time_minutes}分)
    ${article.url}
    タグ: ${article.tags.join(", ")}
    ID: ${article.id}`;
        });

        return {
          content: [
            {
              type: "text",
              text: `未読記事一覧（${articles.length}件）\n詳細が必要な場合は get_article で記事IDを指定してください。\n\n${articlesList.join("\n\n")}`,
            },
          ],
        };
      }

      case "search_articles": {
        const query = args?.query as string;
        const mode = (args?.mode as string) || "semantic";
        const limit = Math.min((args?.limit as number) || 10, 30);

        if (!query) {
          return {
            content: [
              {
                type: "text",
                text: "エラー: 検索キーワードを指定してください",
              },
            ],
          };
        }

        // Select endpoint based on mode
        const endpoint = mode === "semantic"
          ? `${CURAQ_API_URL}/api/v1/articles/semantic-search`
          : `${CURAQ_API_URL}/api/v1/articles/search`;

        const response = await fetch(
          `${endpoint}?q=${encodeURIComponent(query)}&limit=${limit}`,
          {
            headers: {
              Authorization: `Bearer ${CURAQ_MCP_TOKEN}`,
            },
          }
        );

        if (!response.ok) {
          const error = await response.text();
          if (response.status === 503 && mode === "semantic") {
            return {
              content: [
                {
                  type: "text",
                  text: `セマンティック検索は現在利用できません。キーワード検索をお試しください。`,
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `エラー (${response.status}): ${error}`,
              },
            ],
          };
        }

        const data = await response.json() as { articles?: Article[] };
        const searchResults = data.articles || [];

        if (searchResults.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: mode === "semantic"
                  ? `「${query}」に関連する記事が見つかりませんでした。`
                  : `「${query}」に一致する記事が見つかりませんでした。`,
              },
            ],
          };
        }

        const resultsList = searchResults.map((article: Article, index: number) => {
          return `[${index + 1}] ${article.title} (${article.reading_time_minutes}分)
    ${article.url}
    タグ: ${article.tags.join(", ")}
    ID: ${article.id}`;
        });

        const modeLabel = mode === "semantic" ? "セマンティック検索" : "キーワード検索";

        return {
          content: [
            {
              type: "text",
              text: `${modeLabel}結果：「${query}」（${searchResults.length}件）\n詳細が必要な場合は get_article で記事IDを指定してください。\n\n${resultsList.join("\n\n")}`,
            },
          ],
        };
      }

      case "get_article": {
        const articleId = args?.article_id as string;

        if (!articleId) {
          return {
            content: [
              {
                type: "text",
                text: "エラー: 記事IDを指定してください",
              },
            ],
          };
        }

        const response = await fetch(
          `${CURAQ_API_URL}/api/v1/articles/${articleId}`,
          {
            headers: {
              Authorization: `Bearer ${CURAQ_MCP_TOKEN}`,
            },
          }
        );

        if (!response.ok) {
          const error = await response.text();
          if (response.status === 404) {
            return {
              content: [
                {
                  type: "text",
                  text: `記事が見つかりませんでした（ID: ${articleId}）`,
                },
              ],
            };
          }
          if (response.status === 403) {
            return {
              content: [
                {
                  type: "text",
                  text: "この記事へのアクセス権限がありません。",
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `エラー (${response.status}): ${error}`,
              },
            ],
          };
        }

        const data = await response.json() as { article: Article; events?: { action: string; created_at: string }[] };
        const article = data.article;
        const events = data.events || [];

        return {
          content: [
            {
              type: "text",
              text: `# ${article.title}

**URL**: ${article.url}
**ステータス**: ${article.status === "read" ? "既読" : article.status === "unread" ? "未読" : article.status === "deferred" ? "後回し" : "不明"}
**読了時間**: ${article.reading_time_minutes}分
**タグ**: ${article.tags.join(", ")}
**コンテンツタイプ**: ${article.content_type}
**保存日**: ${article.created_at ? new Date(article.created_at).toLocaleDateString("ja-JP") : "不明"}

**要約**:
${article.summary}

**記事ID**: ${article.id}

**イベント履歴**:
${events.map((e: any) => `- ${e.action} (${new Date(e.created_at).toLocaleString("ja-JP")})`).join("\n")}`,
            },
          ],
        };
      }

      case "update_article_status": {
        const articleId = args?.article_id as string;
        const action = args?.action as string;

        if (!articleId || !action) {
          return {
            content: [
              {
                type: "text",
                text: "エラー: 記事IDとアクションを指定してください",
              },
            ],
          };
        }

        if (action !== "read" && action !== "delete") {
          return {
            content: [
              {
                type: "text",
                text: "エラー: アクションは 'read' または 'delete' のいずれかを指定してください",
              },
            ],
          };
        }

        const url = action === "read"
          ? `${CURAQ_API_URL}/api/v1/articles/${articleId}/read`
          : `${CURAQ_API_URL}/api/v1/articles/${articleId}`;
        const method = action === "read" ? "POST" : "DELETE";

        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${CURAQ_MCP_TOKEN}`,
          },
        });

        if (!response.ok) {
          const error = await response.text();
          if (response.status === 404) {
            return {
              content: [
                {
                  type: "text",
                  text: `記事が見つかりませんでした（ID: ${articleId}）`,
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `エラー (${response.status}): ${error}`,
              },
            ],
          };
        }

        const message = action === "read"
          ? `記事を既読にマークしました`
          : `記事を削除しました`;

        return {
          content: [
            {
              type: "text",
              text: `${message}（ID: ${articleId}）`,
            },
          ],
        };
      }

      case "save_article": {
        const url = args?.url as string;
        const title = args?.title as string | undefined;
        const markdown = args?.markdown as string | undefined;

        if (!url) {
          return {
            content: [
              {
                type: "text",
                text: "エラー: URLを指定してください",
              },
            ],
          };
        }

        const requestBody: { url: string; title?: string; markdown?: string } = { url };
        if (title) requestBody.title = title;
        if (markdown) requestBody.markdown = markdown;

        const response = await fetch(
          `${CURAQ_API_URL}/api/v1/articles`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${CURAQ_MCP_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "unknown" })) as { error?: string; message?: string };

          if (response.status === 400) {
            if (errorData.error === "unread-limit") {
              return {
                content: [
                  {
                    type: "text",
                    text: "エラー: 未読記事が30件に達しています。既存の記事を読むか削除してから保存してください。",
                  },
                ],
              };
            }
            if (errorData.error === "limit-reached") {
              return {
                content: [
                  {
                    type: "text",
                    text: "エラー: 今月の記事保存上限に達しました。",
                  },
                ],
              };
            }
            if (errorData.error === "already-read") {
              return {
                content: [
                  {
                    type: "text",
                    text: "この記事は既に読了済みです。",
                  },
                ],
              };
            }
            if (errorData.error === "invalid-content") {
              return {
                content: [
                  {
                    type: "text",
                    text: "エラー: このコンテンツは保存できません。",
                  },
                ],
              };
            }
          }

          return {
            content: [
              {
                type: "text",
                text: `エラー (${response.status}): ${errorData.message || errorData.error || "記事の保存に失敗しました"}`,
              },
            ],
          };
        }

        const data = await response.json() as { success: boolean; message: string; articleId: string; restored?: boolean };
        const message = data.restored
          ? "記事を再登録しました"
          : data.message === "記事は既に保存されています"
          ? "記事は既に保存されています"
          : "記事を保存しました";

        return {
          content: [
            {
              type: "text",
              text: `${message}\n\nURL: ${url}\n記事ID: ${data.articleId}`,
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: `不明なツール: ${name}`,
            },
          ],
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CuraQ MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
