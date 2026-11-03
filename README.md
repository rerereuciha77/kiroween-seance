# SÉANCE

**A gateway for agents into the machine-readable internet that never died.**

Gopher, Usenet and Finger still answer. SÉANCE puts one normalised record shape and one MCP tool
surface in front of all three, and serves a small haunted reading room on top of it.

- **Web UI** — browse a Gopher menu, a Usenet group or a Finger host in the browser, with a raw-bytes
  toggle so you can compare what was rendered against what the server actually sent.
- **MCP endpoint** — `POST /api/mcp`, a stateless Streamable HTTP MCP server with five tools. No key,
  no session, no handshake beyond the protocol itself.
- **No database** — a file cache with TTL and content hashes sits in `.seance-cache/`.
- **Allow-listed** — hosts must appear in `sources.json`; anything else is refused with
  `FORBIDDEN_HOST` before a socket is opened.

## Why

Usenet access was amputated for most people in 2024 when Google Groups stopped carrying it, taking
two decades of searchable human conversation with it. Gopher and Finger were declared dead in the
late 1990s. All three protocols still work, are trivially parseable, and cost almost nothing to
serve — which makes them an unusually good substrate for language-model agents that need real,
non-synthetic data with a small token footprint.

SÉANCE is the séance that calls them back and gives the living a way to talk to them.

## Quickstart

```bash
npm install
npm run dev            # http://localhost:3000
npm run build && npm start
npm test               # vitest, includes property-based tests
npm run typecheck
```

Node 20+.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `SEANCE_REGISTRY_PATH` | `./sources.json` | Where the source allow-list lives |
| `SEANCE_CACHE_DIR` | `./.seance-cache` | Cache index + body files |
| `SEANCE_ALLOW_ARBITRARY_HOSTS` | unset | `true` skips the allow-list (logs a warning; never enable in production) |

## `sources.json`

An array of sources. Every field is required and validated at load time — a bad file fails loudly
instead of silently serving an empty list.

```json
[
  {
    "id": "gopher-floodgap",
    "protocol": "gopher",
    "host": "gopher.floodgap.com",
    "port": 70,
    "description": "Floodgap's Gopherspace"
  }
]
```

`protocol` must be one of `gopher`, `nntp`, `finger`. `port` must be 1–65535. Default ports are
70 / 119 / 79 when a tool call omits `port`.

## MCP tools

Point any MCP client at `http://localhost:3000/api/mcp`:

```json
{
  "mcpServers": {
    "seance": { "type": "http", "url": "http://localhost:3000/api/mcp" }
  }
}
```

| Tool | Arguments | Returns |
| --- | --- | --- |
| `seance_list_sources` | — | the allow-list |
| `seance_browse` | `protocol`, `host`, `port?`, `selector?` | normalised records + first 4 KB of raw bytes |
| `seance_read` | `protocol`, `host`, `port?`, `selector` | `{ mime, bytes, body }` for one document |
| `seance_search_usenet` | `group`, `query`, `host?`, `port?`, `limit?` | recent articles filtered by substring |
| `seance_finger` | `user?`, `host?`, `port?` | the finger body |

Selector grammar is protocol-native:

- **gopher** — `/`, `/world`, any selector the server offers
- **nntp** — `*` for the group list, a group name for its 30 most recent articles, `<message-id>`
  for one article
- **finger** — a user name, or `""` for the default listing

Every tool call is capped at 30 seconds; a timeout returns MCP error code `TIMEOUT` and an
allow-list violation returns `FORBIDDEN_HOST`.

## HTTP surface

| Route | Purpose |
| --- | --- |
| `GET /` | source list |
| `GET /browse/<protocol>/<host>?port=&s=` | one selector, rendered + raw |
| `GET /api/proxy?protocol=&host=&port=&selector=` | JSON for client components, allow-list enforced |
| `POST /api/mcp` | MCP Streamable HTTP (stateless, JSON responses) |

## Normalised record

Both the UI and the MCP tools speak one shape, so an agent does not need per-protocol parsers:

```ts
interface NormalisedRecord {
  kind: string      // menu | text | info | group | article | finger
  selector: string  // gopher selector, message-id, or finger user
  label: string     // human display string
  host: string
  port: number
  mime: string
  bytes: number
  author?: string   // Usenet From header
  date?: string     // Usenet Date header, RFC 5322
}
```

## Cache

`cacheGet` checks TTL (default 10 minutes) and the sha256 of the body before returning a hit, so a
tampered or truncated body is treated as a miss. Writes go through a `.tmp` + rename swap, and
`cacheEvict` drops the oldest bodies until the directory fits its byte budget (default 8 MB).

## Limits, honestly

- The allow-list is the only security boundary. Gopher and NNTP are plaintext and unauthenticated;
  do not treat their content as trusted.
- Usenet article search is a substring filter over the most recent 30 articles of a group, not an
  `XPAT` scan of the whole group.
- No STARTTLS negotiation for NNTP yet — `nntpCommand` accepts `{ tls: true }` for implicit TLS
  servers, but opportunistic upgrade is not implemented.
- Finger output is whatever the server feels like sending. It is rendered as text, never as HTML.

## Built with Kiro

The spec in `.kiro/specs/seance/` (requirements → design → tasks) was written first and is what
drove the implementation. Every module traces back to a numbered task and a requirement ID.

MIT licensed.