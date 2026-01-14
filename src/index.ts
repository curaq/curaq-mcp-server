#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Environment variables
const CURAQ_API_URL = process.env.CURAQ_API_URL || "https://curaq.app";
const CURAQ_MCP_TOKEN = process.env.CURAQ_MCP_TOKEN;

if (!CURAQ_MCP_TOKEN) {
  console.error("Error: Missing required environment variable");
  console.error("Required: CURAQ_MCP_TOKEN");
  console.error("\nPlease generate a token at: https://curaq.app/settings/access-token");
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
  {
    name: "get_discovery_queue",
    description:
      "現在のDiscovery候補キューを取得します。他のユーザーが保存している人気記事の中から、AIがあなたの興味に合わせて選んだ記事を確認できます。",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "generate_discovery",
    description:
      "新しいDiscovery候補を生成します。あなたの読書履歴に基づいてAIが他ユーザーの人気記事を選びます。週1回まで生成可能です。",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "dismiss_discovery_article",
    description:
      "Discovery候補から記事を「興味なし」として却下します。この記事は今後推薦されなくなります。",
    inputSchema: {
      type: "object",
      properties: {
        item_id: {
          type: "string",
          description: "Discovery キューアイテムのID（UUID形式）",
        },
      },
      required: ["item_id"],
    },
  },
  {
    name: "import_articles",
    description:
      "複数の記事をCuraQに一括でインポートします。URLリストを指定すると、各記事を順次保存します。既読/未読の選択、重複のスキップに対応しています。",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: {
            type: "string",
          },
          description: "インポートする記事のURLリスト",
        },
        mark_as_read: {
          type: "boolean",
          description: "インポート後に記事を既読としてマークするか（デフォルト: false）",
          default: false,
        },
        batch_size: {
          type: "number",
          description: "一度に処理するバッチサイズ（デフォルト: 10、最大: 20）",
          default: 10,
        },
      },
      required: ["urls"],
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

      case "get_discovery_queue": {
        const response = await fetch(
          `${CURAQ_API_URL}/api/v1/discovery`,
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

        const data = await response.json() as {
          queue: Array<{
            id: string;
            article_id: string;
            reason: string;
            created_at: string;
            articles: {
              url: string;
              title: string;
              summary: string;
              tags: string[];
              reading_time_minutes: number;
            };
          }>;
          canGenerate: boolean;
          nextGenerationAt: string | null;
          lastGeneratedAt: string | null;
          limits: {
            articleCount: number;
            candidateLimit: number;
          };
        };

        if (data.queue.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: data.canGenerate
                  ? "Discovery候補がありません。generate_discovery ツールで新しい候補を生成できます。"
                  : `Discovery候補がありません。次回生成は ${data.nextGenerationAt ? new Date(data.nextGenerationAt).toLocaleDateString("ja-JP") : "不明"} です。`,
              },
            ],
          };
        }

        const queueList = data.queue.map((item, index) => {
          return `[${index + 1}] ${item.articles.title} (${item.articles.reading_time_minutes}分)
    ${item.articles.url}
    理由: ${item.reason}
    タグ: ${item.articles.tags.join(", ")}
    ID: ${item.id}`;
        });

        let footer = "";
        if (data.nextGenerationAt) {
          const nextDate = new Date(data.nextGenerationAt);
          const daysUntil = Math.ceil((nextDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          footer = `\n\n次回生成可能: ${nextDate.toLocaleDateString("ja-JP")} (${daysUntil}日後)`;
        } else if (data.canGenerate) {
          footer = "\n\ngenerate_discovery ツールで新しい候補を生成できます。";
        }

        return {
          content: [
            {
              type: "text",
              text: `【Discovery候補】（${data.queue.length}件）\n\n${queueList.join("\n\n")}${footer}`,
            },
          ],
        };
      }

      case "generate_discovery": {
        const response = await fetch(
          `${CURAQ_API_URL}/api/v1/discovery/generate`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${CURAQ_MCP_TOKEN}`,
            },
          }
        );

        if (!response.ok) {
          const error = await response.text();

          // 週1回制限
          if (response.status === 429) {
            return {
              content: [
                {
                  type: "text",
                  text: `エラー: ${error}`,
                },
              ],
            };
          }

          // 候補なし
          if (response.status === 404) {
            return {
              content: [
                {
                  type: "text",
                  text: `エラー: ${error}`,
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

        const data = await response.json() as {
          generated: boolean;
          count: number;
          queue: Array<{
            id: string;
            article_id: string;
            reason: string;
            created_at: string;
            articles: {
              url: string;
              title: string;
              summary: string;
              tags: string[];
              reading_time_minutes: number;
            };
          }>;
        };

        const queueList = data.queue.map((item, index) => {
          return `[${index + 1}] ${item.articles.title} (${item.articles.reading_time_minutes}分)
    ${item.articles.url}
    理由: ${item.reason}
    タグ: ${item.articles.tags.join(", ")}
    ID: ${item.id}`;
        });

        return {
          content: [
            {
              type: "text",
              text: `【Discovery生成完了】（${data.count}件の候補を追加しました）\n\n${queueList.join("\n\n")}`,
            },
          ],
        };
      }

      case "dismiss_discovery_article": {
        const itemId = args?.item_id as string;

        if (!itemId) {
          return {
            content: [
              {
                type: "text",
                text: "エラー: item_idを指定してください",
              },
            ],
          };
        }

        const response = await fetch(
          `${CURAQ_API_URL}/api/v1/discovery/${itemId}/dismiss`,
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
                  text: "エラー: 指定されたDiscoveryアイテムが見つかりません",
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
              text: `記事を「興味なし」としてマークしました\n（ID: ${itemId}）`,
            },
          ],
        };
      }

      case "import_articles": {
        const urls = args?.urls as string[];
        const markAsRead = (args?.mark_as_read as boolean) ?? false;
        const batchSize = Math.min(Math.max((args?.batch_size as number) || 10, 1), 20);

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "エラー: URLリストを指定してください",
              },
            ],
          };
        }

        // Results tracking
        const results: {
          success: Array<{ url: string; articleId: string }>;
          skipped: Array<{ url: string; reason: string }>;
          failed: Array<{ url: string; error: string }>;
        } = {
          success: [],
          skipped: [],
          failed: [],
        };

        // Process URLs in batches
        for (let i = 0; i < urls.length; i += batchSize) {
          const batch = urls.slice(i, i + batchSize);
          const batchNumber = Math.floor(i / batchSize) + 1;
          const totalBatches = Math.ceil(urls.length / batchSize);

          console.error(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} URLs)...`);

          for (const url of batch) {
            try {
              // Step 1: Save article
              const saveResponse = await fetch(
                `${CURAQ_API_URL}/api/v1/articles`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${CURAQ_MCP_TOKEN}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ url }),
                }
              );

              if (!saveResponse.ok) {
                const errorData = await saveResponse.json().catch(() => ({ error: "unknown" })) as { error?: string; message?: string };

                // Handle "already-read" as skipped
                if (saveResponse.status === 400 && errorData.error === "already-read") {
                  results.skipped.push({
                    url,
                    reason: "既に読了済み",
                  });
                  continue;
                }

                // Other errors
                let errorMessage = "記事の保存に失敗しました";
                if (saveResponse.status === 400) {
                  if (errorData.error === "unread-limit") {
                    errorMessage = "未読記事が30件に達しています";
                  } else if (errorData.error === "limit-reached") {
                    errorMessage = "今月の記事保存上限に達しました";
                  } else if (errorData.error === "invalid-content") {
                    errorMessage = "このコンテンツは保存できません";
                  }
                }

                results.failed.push({
                  url,
                  error: errorMessage,
                });
                continue;
              }

              const saveData = await saveResponse.json() as { success: boolean; message: string; articleId: string; restored?: boolean };

              // If the article was already saved (not restored), treat as skipped
              if (saveData.message === "記事は既に保存されています" && !saveData.restored) {
                results.skipped.push({
                  url,
                  reason: "既に保存済み",
                });
                continue;
              }

              // Step 2: Mark as read if requested
              if (markAsRead) {
                const readResponse = await fetch(
                  `${CURAQ_API_URL}/api/v1/articles/${saveData.articleId}/read`,
                  {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${CURAQ_MCP_TOKEN}`,
                    },
                  }
                );

                if (!readResponse.ok) {
                  // If marking as read fails, still count as success but note the issue
                  results.success.push({
                    url,
                    articleId: saveData.articleId,
                  });
                  console.error(`Warning: Failed to mark article as read: ${url}`);
                  continue;
                }
              }

              results.success.push({
                url,
                articleId: saveData.articleId,
              });
            } catch (error) {
              results.failed.push({
                url,
                error: error instanceof Error ? error.message : "不明なエラー",
              });
            }
          }
        }

        // Format results summary
        const totalCount = urls.length;
        const successCount = results.success.length;
        const skippedCount = results.skipped.length;
        const failedCount = results.failed.length;

        let summary = `インポート完了: 全${totalCount}件中\n`;
        summary += `✓ 成功: ${successCount}件\n`;
        summary += `⊘ スキップ（重複）: ${skippedCount}件\n`;
        summary += `✗ 失敗: ${failedCount}件`;

        if (results.failed.length > 0) {
          summary += `\n\n【失敗した記事】\n`;
          summary += results.failed
            .map((item) => `- ${item.url}\n  理由: ${item.error}`)
            .join("\n");
        }

        if (results.skipped.length > 0 && results.skipped.length <= 10) {
          summary += `\n\n【スキップした記事】\n`;
          summary += results.skipped
            .map((item) => `- ${item.url}\n  理由: ${item.reason}`)
            .join("\n");
        }

        return {
          content: [
            {
              type: "text",
              text: summary,
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
