#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { z } from "zod";

const SearchBooksInputSchema = z.object({
  query: z.string().describe("自然言語の検索クエリ（例：「Pythonの入門書」）"),
  maxResults: z
    .number()
    .min(1)
    .max(40)
    .optional()
    .default(10)
    .describe("取得件数（1〜40、デフォルト10）"),
});

interface IndustryIdentifier {
  type: string;
  identifier: string;
}

interface VolumeInfo {
  title?: string;
  authors?: string[];
  publisher?: string;
  industryIdentifiers?: IndustryIdentifier[];
}

interface Volume {
  volumeInfo: VolumeInfo;
}

interface GoogleBooksResponse {
  totalItems: number;
  items?: Volume[];
}

async function searchBooks(query: string, maxResults: number): Promise<string> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (!apiKey) {
    return "エラー: GOOGLE_BOOKS_API_KEY 環境変数が設定されていません。Google Cloud ConsoleでAPIキーを取得し、環境変数に設定してください。";
  }

  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("key", apiKey);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch (err) {
    return `エラー: Google Books APIへの接続に失敗しました。ネットワーク接続を確認してください。(${err})`;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return `エラー: Google Books APIがエラーを返しました (HTTP ${response.status})。${errorText}`;
  }

  const data = (await response.json()) as GoogleBooksResponse;

  if (!data.items || data.items.length === 0) {
    return `「${query}」に一致する書籍は見つかりませんでした。`;
  }

  const lines: string[] = [];
  data.items.forEach((item, index) => {
    const info = item.volumeInfo;
    const title = info.title ?? "（タイトル不明）";
    const authors = info.authors?.join(", ") ?? "（著者不明）";
    const publisher = info.publisher ?? "（出版社不明）";

    const isbn13 = info.industryIdentifiers?.find(
      (id) => id.type === "ISBN_13"
    )?.identifier;
    const isbn10 = info.industryIdentifiers?.find(
      (id) => id.type === "ISBN_10"
    )?.identifier;

    lines.push(`${index + 1}. 「${title}」`);
    lines.push(`   著者: ${authors}`);
    lines.push(`   出版社: ${publisher}`);
    if (isbn13) {
      lines.push(`   ISBN-13: ${isbn13}`);
    }
    if (isbn10) {
      lines.push(`   ISBN-10: ${isbn10}`);
    }
    if (!isbn13 && !isbn10) {
      lines.push(`   ISBN情報なし`);
    }
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

function createServer(): Server {
  const server = new Server(
    { name: "google-books", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_books",
        description:
          "Google Books APIを使って書籍を検索します。ISBNを含む書籍リストを返します。",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "自然言語の検索クエリ（例：「Pythonの入門書」）",
            },
            maxResults: {
              type: "number",
              description: "取得件数（1〜40、デフォルト10）",
              minimum: 1,
              maximum: 40,
              default: 10,
            },
          },
          required: ["query"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "search_books") {
      return {
        content: [{ type: "text", text: `不明なツール: ${request.params.name}` }],
        isError: true,
      };
    }

    const parsed = SearchBooksInputSchema.safeParse(request.params.arguments);
    if (!parsed.success) {
      return {
        content: [{ type: "text", text: `入力エラー: ${parsed.error.message}` }],
        isError: true,
      };
    }

    const { query, maxResults } = parsed.data;
    const result = await searchBooks(query, maxResults);
    return { content: [{ type: "text", text: result }] };
  });

  return server;
}

async function main() {
  const app = express();
  app.use(express.json());
  const PORT = parseInt(process.env.PORT ?? "8080", 10);

  // App Runner ヘルスチェック用
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // MCPエンドポイント（ステートレスモード：リクエストごとに新インスタンス）
  app.all("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.error(`Google Books MCP server listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
