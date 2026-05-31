# chatgpt-mcp

An **MCP (Model Context Protocol) server that lets the Claude apps run ChatGPT
chats** — so the actual generation happens on OpenAI's servers and is billed
against **your OpenAI / ChatGPT tokens, not Claude's output tokens**.

You talk to Claude (Desktop or mobile). When you want ChatGPT to do the heavy
lifting, Claude calls one of this server's tools, the prompt is sent to the
OpenAI API, and the answer comes back. Claude only spends a few tokens
orchestrating; **the answer itself is generated and paid for on OpenAI's side.**

> You need your own OpenAI API key (`sk-...`). "ChatGPT tokens" here means
> OpenAI API usage billed to that key — this does not piggy-back on a ChatGPT
> Plus/Pro subscription, which has no programmatic API.

## Tools

| Tool | What it does |
| --- | --- |
| `chatgpt_ask` | One-off question to ChatGPT. No history kept. |
| `chatgpt_chat` | Multi-turn conversation. Pass a `conversation_id` to keep context across turns. |
| `chatgpt_reset` | Clear a stored conversation (or `*` for all). |
| `chatgpt_list_models` | List models your API key can use. |

Each reply includes a token-usage footer (`X in + Y out = Z total`) so you can
see exactly what was billed to your OpenAI account.

## Install

```bash
cd chatgpt-mcp
npm install
```

Requires Node.js 18+ (uses the built-in `fetch`).

> **Want Claude to install it for you?** Copy a ready-made prompt from
> [`INSTALL_PROMPT.md`](./INSTALL_PROMPT.md) and paste it into Claude Desktop /
> Claude Code — it will clone, `npm install`, and wire up the config for you.

---

## Use it in the Claude **Desktop** app (stdio)

The desktop app launches the server locally over stdio. Open
**Settings → Developer → Edit Config** (this opens
`claude_desktop_config.json`) and add:

```jsonc
{
  "mcpServers": {
    "chatgpt": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/chatgpt-mcp/src/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-your-openai-key",
        "OPENAI_MODEL": "gpt-4o-mini"
      }
    }
  }
}
```

Restart Claude Desktop. You should see the `chatgpt` tools appear. Try:

> *"Use chatgpt_ask to have GPT-4o write a haiku about the sea."*

---

## Use it in the Claude **web / mobile** app (remote HTTP connector)

A phone can't spawn a local process, so for mobile you **host this server**
somewhere reachable and add it as a *custom connector*. The same code runs as a
Streamable-HTTP server:

```bash
MCP_TRANSPORT=http \
PORT=3000 \
OPENAI_API_KEY=sk-your-openai-key \
MCP_AUTH_TOKEN=some-long-random-secret \
node src/index.js
```

The MCP endpoint is then `https://your-host/mcp`. Put it behind HTTPS (a
reverse proxy, Render, Fly.io, Railway, a VPS with Caddy/Nginx, etc.). **Always
set `MCP_AUTH_TOKEN`** when exposing it publicly — clients must then send
`Authorization: Bearer <that token>`.

Then in Claude (web at claude.ai, or the mobile app):
**Settings → Connectors → Add custom connector**, give it the URL
`https://your-host/mcp`, and add the bearer token. Remote connectors require a
Claude plan that supports custom connectors.

> Tip: for a quick test from your phone without a server, run HTTP mode on your
> computer and expose it with a tunnel (e.g. `cloudflared tunnel --url
> http://localhost:3000` or `ngrok http 3000`), then use the tunnel's HTTPS URL.

---

## Configuration (environment variables)

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | ✅ | — | Your OpenAI key; all usage billed here. |
| `OPENAI_MODEL` | | `gpt-4o-mini` | Default model when a call omits one. |
| `OPENAI_BASE_URL` | | `https://api.openai.com/v1` | Override for OpenAI-compatible gateways. |
| `OPENAI_ORG` | | — | OpenAI organization id. |
| `OPENAI_PROJECT` | | — | OpenAI project id. |
| `MCP_TRANSPORT` | | `stdio` | Set to `http` to run the remote server (or pass `--http`). |
| `PORT` | | `3000` | HTTP mode listen port. |
| `MCP_AUTH_TOKEN` | | — | If set, required bearer token for HTTP mode. |

## How "spends ChatGPT tokens, not Claude's" works

- Claude reads your request and decides to call `chatgpt_ask` / `chatgpt_chat`.
- This server forwards the prompt to OpenAI's `/chat/completions` endpoint.
- OpenAI generates the full answer → **those input+output tokens are billed to
  your OpenAI key.**
- The answer is returned to Claude as a short tool result. Claude's own token
  spend is limited to reading your message and relaying the result, instead of
  generating the long answer itself.

## License

MIT
