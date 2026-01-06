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
  console.error("\nPlease generate a token at: https://curaq.pages.dev/settings/mcp");
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
      "キーワードで記事を検索します。タイトル、要約、タグから部分一致で検索します。既読・未読の両方から検索します。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "検索キーワード",
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
    name: "mark_as_read",
    description: "記事を既読にマークします。",
    inputSchema: {
      type: "object",
      properties: {
        article_id: {
          type: "string",
          description: "既読にする記事のID（UUID形式）",
        },
      },
      required: ["article_id"],
    },
  },
  {
    name: "delete_article",
    description: "記事を削除します。この操作は元に戻せません。",
    inputSchema: {
      type: "object",
      properties: {
        article_id: {
          type: "string",
          description: "削除する記事のID（UUID形式）",
        },
      },
      required: ["article_id"],
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

        const articlesList = articles.map((article: Article) => {
          return `## ${article.title}

**URL**: ${article.url}
**ステータス**: ${article.status === "read" ? "既読" : "未読"}
**読了時間**: ${article.reading_time_minutes}分
**タグ**: ${article.tags.join(", ")}
**コンテンツタイプ**: ${article.content_type}
${article.priority !== undefined ? `**優先度**: ${article.priority.toFixed(3)}` : ""}
${article.created_at ? `**保存日**: ${article.created_at ? new Date(article.created_at).toLocaleDateString("ja-JP") : "不明"}` : ""}

**要約**:
${article.summary}

**記事ID**: ${article.id}
---`;
        });

        return {
          content: [
            {
              type: "text",
              text: `# 未読記事一覧（${articles.length}件）\n\n${articlesList.join("\n\n")}`,
            },
          ],
        };
      }

      case "search_articles": {
        const query = args?.query as string;
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

        const response = await fetch(
          `${CURAQ_API_URL}/api/v1/articles/search?q=${encodeURIComponent(query)}&limit=${limit}`,
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
        const searchResults = data.articles || [];

        if (searchResults.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `「${query}」に一致する記事が見つかりませんでした。`,
              },
            ],
          };
        }

        const resultsList = searchResults.map((article: Article) => {
          return `## ${article.title}

**URL**: ${article.url}
**ステータス**: ${article.status === "read" ? "既読" : "未読"}
**読了時間**: ${article.reading_time_minutes}分
**タグ**: ${article.tags.join(", ")}
**コンテンツタイプ**: ${article.content_type}
${article.date ? `**日付**: ${new Date(article.date).toLocaleDateString("ja-JP")}` : ""}

**要約**:
${article.summary}

**記事ID**: ${article.id}
---`;
        });

        return {
          content: [
            {
              type: "text",
              text: `# 検索結果：「${query}」（${searchResults.length}件）\n\n${resultsList.join("\n\n")}`,
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

      case "mark_as_read": {
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
          `${CURAQ_API_URL}/api/v1/articles/${articleId}/read`,
          {
            method: "POST",
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
          return {
            content: [
              {
                type: "text",
                text: `エラー (${response.status}): ${error}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `記事を既読にマークしました（ID: ${articleId}）`,
            },
          ],
        };
      }

      case "delete_article": {
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
            method: "DELETE",
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
          return {
            content: [
              {
                type: "text",
                text: `エラー (${response.status}): ${error}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `記事を削除しました（ID: ${articleId}）`,
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
