#!/usr/bin/env node
/**
 * chatgpt-mcp
 * -----------
 * An MCP (Model Context Protocol) server that exposes ChatGPT / OpenAI as a set
 * of tools. When you add it to the Claude Desktop app (or the Claude mobile app
 * via a connector), Claude can hand a prompt off to ChatGPT. The actual text
 * generation then happens on OpenAI's servers and is billed against *your
 * OpenAI (ChatGPT) tokens* — not against Claude's output.
 *
 * Configuration is done entirely through environment variables:
 *   OPENAI_API_KEY   (required)  Your OpenAI API key (sk-...).
 *   OPENAI_MODEL     (optional)  Default model. Defaults to "gpt-4o-mini".
 *   OPENAI_BASE_URL  (optional)  API base. Defaults to "https://api.openai.com/v1".
 *                                Lets you point at a compatible gateway/proxy.
 *   OPENAI_ORG       (optional)  OpenAI organization id.
 *   OPENAI_PROJECT   (optional)  OpenAI project id.
 *   MCP_TRANSPORT    (optional)  "stdio" (default) or "http".
 *   PORT             (optional)  HTTP mode listen port (default 3000).
 *   MCP_AUTH_TOKEN   (optional)  If set, bearer token required in HTTP mode.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const ORG = process.env.OPENAI_ORG;
const PROJECT = process.env.OPENAI_PROJECT;

/**
 * In-memory conversation store so multi-turn chats keep their context across
 * tool calls. Keyed by conversation_id. This lives only for the lifetime of the
 * server process (i.e. while Claude Desktop keeps it running).
 *
 * @type {Map<string, {messages: Array<{role: string, content: string}>, model: string, updated: number}>}
 */
const conversations = new Map();

function authHeaders() {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };
  if (ORG) headers["OpenAI-Organization"] = ORG;
  if (PROJECT) headers["OpenAI-Project"] = PROJECT;
  return headers;
}

/**
 * Call OpenAI's Chat Completions endpoint.
 * @param {object} body request body
 * @returns {Promise<object>} parsed JSON response
 */
async function openaiChat(body) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI returned a non-JSON response (HTTP ${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json);
    throw new Error(`OpenAI API error (HTTP ${res.status}): ${msg}`);
  }
  return json;
}

/** Build a params object, only including fields the user set. */
function buildOptionalParams({ temperature, max_tokens, reasoning_effort }) {
  const params = {};
  if (typeof temperature === "number") params.temperature = temperature;
  if (typeof max_tokens === "number") params.max_completion_tokens = max_tokens;
  if (reasoning_effort) params.reasoning_effort = reasoning_effort;
  return params;
}

/** Format the usage block from a response into a short human string. */
function formatUsage(usage, model) {
  if (!usage) return `\n\n— (model: ${model}; token usage not reported)`;
  const prompt = usage.prompt_tokens ?? usage.input_tokens ?? "?";
  const completion = usage.completion_tokens ?? usage.output_tokens ?? "?";
  const total = usage.total_tokens ?? "?";
  return `\n\n— ChatGPT (${model}) • tokens: ${prompt} in + ${completion} out = ${total} total (billed to your OpenAI account)`;
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function errorResult(err) {
  return {
    isError: true,
    content: [{ type: "text", text: `chatgpt-mcp error: ${err?.message || String(err)}` }],
  };
}

// ---------------------------------------------------------------------------

function createServerInstance() {
  const server = new McpServer({
    name: "chatgpt-mcp",
    version: "1.0.0",
  });
  registerTools(server);
  return server;
}

function registerTools(server) {
  // --- Tool: chatgpt_ask (single-turn) -------------------------------------
  server.registerTool(
    "chatgpt_ask",
    {
      title: "Ask ChatGPT (single turn)",
      description:
        "Send a one-off prompt to ChatGPT (OpenAI) and get its answer. Generation runs on OpenAI and consumes YOUR OpenAI/ChatGPT tokens, not Claude's. Use this when you want ChatGPT to do the work for a self-contained question. No conversation history is kept.",
      inputSchema: {
        prompt: z.string().describe("The question or instruction to send to ChatGPT."),
        system: z
          .string()
          .optional()
          .describe("Optional system prompt to steer ChatGPT's behaviour/persona."),
        model: z
          .string()
          .optional()
          .describe(`OpenAI model to use. Defaults to "${DEFAULT_MODEL}". e.g. gpt-4o, gpt-4o-mini, o3-mini.`),
        temperature: z
          .number()
          .min(0)
          .max(2)
          .optional()
          .describe("Sampling temperature 0-2. Omit for the model default."),
        max_tokens: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of tokens to generate in the reply."),
        reasoning_effort: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("For reasoning models (o-series): how hard to think."),
      },
    },
    async ({ prompt, system, model, temperature, max_tokens, reasoning_effort }) => {
      try {
        const useModel = model || DEFAULT_MODEL;
        const messages = [];
        if (system) messages.push({ role: "system", content: system });
        messages.push({ role: "user", content: prompt });

        const json = await openaiChat({
          model: useModel,
          messages,
          ...buildOptionalParams({ temperature, max_tokens, reasoning_effort }),
        });

        const answer = json.choices?.[0]?.message?.content ?? "(no content returned)";
        return textResult(answer + formatUsage(json.usage, useModel));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- Tool: chatgpt_chat (multi-turn) -------------------------------------
  server.registerTool(
    "chatgpt_chat",
    {
      title: "Chat with ChatGPT (multi-turn)",
      description:
        "Continue a stateful conversation with ChatGPT (OpenAI). Pass a conversation_id to keep context across turns; reuse the same id to continue, or use a new id to start fresh. Generation runs on OpenAI and consumes YOUR OpenAI/ChatGPT tokens, not Claude's.",
      inputSchema: {
        message: z.string().describe("Your next message in the conversation."),
        conversation_id: z
          .string()
          .optional()
          .describe('Conversation identifier. Reuse to continue a thread; defaults to "default".'),
        system: z
          .string()
          .optional()
          .describe("System prompt. Only applied when the conversation is first created."),
        model: z
          .string()
          .optional()
          .describe(`OpenAI model to use. Defaults to "${DEFAULT_MODEL}".`),
        temperature: z.number().min(0).max(2).optional().describe("Sampling temperature 0-2."),
        max_tokens: z.number().int().positive().optional().describe("Max tokens to generate."),
        reasoning_effort: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("For reasoning models (o-series): how hard to think."),
      },
    },
    async ({ message, conversation_id, system, model, temperature, max_tokens, reasoning_effort }) => {
      try {
        const id = conversation_id || "default";
        const useModel = model || DEFAULT_MODEL;

        let convo = conversations.get(id);
        if (!convo) {
          convo = { messages: [], model: useModel, updated: Date.now() };
          if (system) convo.messages.push({ role: "system", content: system });
          conversations.set(id, convo);
        }
        convo.messages.push({ role: "user", content: message });

        const json = await openaiChat({
          model: useModel,
          messages: convo.messages,
          ...buildOptionalParams({ temperature, max_tokens, reasoning_effort }),
        });

        const answer = json.choices?.[0]?.message?.content ?? "(no content returned)";
        convo.messages.push({ role: "assistant", content: answer });
        convo.updated = Date.now();

        const turns = convo.messages.filter((m) => m.role !== "system").length;
        return textResult(
          answer +
            formatUsage(json.usage, useModel) +
            `\n— conversation "${id}" • ${turns} messages in context`,
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- Tool: chatgpt_reset -------------------------------------------------
  server.registerTool(
    "chatgpt_reset",
    {
      title: "Reset a ChatGPT conversation",
      description: "Clear the stored history for a chatgpt_chat conversation so the next message starts fresh.",
      inputSchema: {
        conversation_id: z
          .string()
          .optional()
          .describe('Conversation id to clear. Defaults to "default". Use "*" to clear all.'),
      },
    },
    async ({ conversation_id }) => {
      const id = conversation_id || "default";
      if (id === "*") {
        const n = conversations.size;
        conversations.clear();
        return textResult(`Cleared all ${n} conversation(s).`);
      }
      const existed = conversations.delete(id);
      return textResult(existed ? `Cleared conversation "${id}".` : `No conversation "${id}" was stored.`);
    },
  );

  // --- Tool: chatgpt_list_models -------------------------------------------
  server.registerTool(
    "chatgpt_list_models",
    {
      title: "List available OpenAI models",
      description: "List the models available to your OpenAI API key (so you know what to pass as `model`).",
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe('Optional case-insensitive substring filter, e.g. "gpt-4" or "o3".'),
      },
    },
    async ({ filter }) => {
      try {
        const res = await fetch(`${BASE_URL}/models`, { headers: authHeaders() });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.error?.message || `HTTP ${res.status}`);
        }
        let ids = (json.data || []).map((m) => m.id);
        if (filter) {
          const f = filter.toLowerCase();
          ids = ids.filter((x) => x.toLowerCase().includes(f));
        }
        ids.sort();
        return textResult(
          ids.length
            ? `Available models${filter ? ` matching "${filter}"` : ""} (default: ${DEFAULT_MODEL}):\n` +
                ids.map((x) => `• ${x}`).join("\n")
            : `No models found${filter ? ` matching "${filter}"` : ""}.`,
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Transports
//
//  • stdio  → for the Claude *Desktop* app, which spawns this script locally.
//  • http   → a remote Streamable-HTTP server you can host (e.g. on a small
//             VPS / Render / Fly) and add to the Claude *web & mobile* apps as
//             a custom connector. Enable with MCP_TRANSPORT=http (or --http).
// ---------------------------------------------------------------------------

async function runStdio() {
  const server = createServerInstance();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[chatgpt-mcp] ready (stdio) • default model: ${DEFAULT_MODEL} • base: ${BASE_URL}\n`,
  );
}

async function runHttp() {
  const port = Number(process.env.PORT || 3000);
  // Optional shared-secret auth for the hosted server. If MCP_AUTH_TOKEN is set,
  // clients must send "Authorization: Bearer <token>".
  const authToken = process.env.MCP_AUTH_TOKEN;

  // One transport (and server) per session id, so concurrent clients are isolated.
  const sessions = new Map(); // sessionId -> { server, transport }

  const httpServer = createServer(async (req, res) => {
    try {
      if (req.url !== "/mcp") {
        if (req.url === "/" || req.url === "/health") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("chatgpt-mcp ok");
          return;
        }
        res.writeHead(404).end();
        return;
      }

      if (authToken) {
        const header = req.headers["authorization"] || "";
        if (header !== `Bearer ${authToken}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }),
          );
          return;
        }
      }

      const sessionId = req.headers["mcp-session-id"];
      let entry = sessionId ? sessions.get(sessionId) : undefined;

      if (!entry) {
        // New session: create a fresh server + transport.
        entry = {};
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, entry);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        const server = createServerInstance();
        await server.connect(transport);
        entry.server = server;
        entry.transport = transport;
      }

      await entry.transport.handleRequest(req, res);
    } catch (err) {
      process.stderr.write(`[chatgpt-mcp] http error: ${err?.stack || err}\n`);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });

  httpServer.listen(port, () => {
    process.stderr.write(
      `[chatgpt-mcp] ready (http) • listening on :${port}/mcp • default model: ${DEFAULT_MODEL}` +
        (authToken ? " • bearer auth ON" : " • bearer auth OFF") +
        "\n",
    );
  });
}

async function main() {
  if (!API_KEY) {
    process.stderr.write(
      "[chatgpt-mcp] FATAL: OPENAI_API_KEY is not set. " +
        "Set it in your MCP server config (env) before starting.\n",
    );
    process.exit(1);
  }
  const httpMode = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";
  if (httpMode) {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  process.stderr.write(`[chatgpt-mcp] fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
