# SÉANCE — Design Spec

## Technology Constraints

| Concern | Choice |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5.x (strict mode) |
| Framework | Next.js 15 (App Router) |
| Package manager | pnpm |
| Test runner | Vitest + fast-check (property-based) |
| Persistence | File-based only — no database |
| Cache store | Local filesystem (`~/.seance/cache/` or `SEANCE_CACHE_DIR`) |
| Source registry | `sources.json` at repo root |
| MCP transport | HTTP/SSE via `@modelcontextprotocol/sdk` |

---

## Repository Layout

```
seance/
├── sources.json                  # operator allow-list
├── next.config.ts
├── tsconfig.json
├── package.json
├── src/
│   ├── app/                      # Next.js App Router pages
│   │   ├── layout.tsx
│   │   ├── page.tsx              # source picker home
│   │   ├── browse/
│   │   │   └── [...path]/
│   │   │       └── page.tsx      # gopher/nntp/finger viewer
│   │   └── api/
│   │       ├── mcp/
│   │       │   └── route.ts      # MCP HTTP+SSE endpoint
│   │       └── proxy/
│   │           └── route.ts      # internal fetch relay for UI
│   ├── lib/
│   │   ├── protocols/
│   │   │   ├── gopher.ts         # Gopher TCP client
│   │   │   ├── nntp.ts           # NNTP TCP client
│   │   │   └── finger.ts         # Finger TCP client
│   │   ├── session.ts            # SeanceSession class
│   │   ├── normaliser.ts         # → NormalisedRecord
│   │   ├── cache.ts              # file-based cache
│   │   ├── registry.ts           # sources.json loader + allow-list check
│   │   ├── mcp-tools.ts          # MCP tool definitions (seance.*)
│   │   └── errors.ts             # GopherError, NNTPError, FingerError
│   ├── components/
│   │   ├── GopherMenu.tsx
│   │   ├── ArticleList.tsx
│   │   ├── FingerOutput.tsx
│   │   ├── Breadcrumb.tsx
│   │   └── RawToggle.tsx
│   └── types/
│       └── index.ts              # shared TypeScript types
└── tests/
    ├── gopher.property.test.ts
    ├── nntp.property.test.ts
    ├── normaliser.property.test.ts
    └── cache.test.ts
```

---

## Core Types (`src/types/index.ts`)

```typescript
export type Protocol = "gopher" | "nntp" | "finger";

export interface NormalisedRecord {
  kind: string;        // "menu" | "text" | "search" | "info" | "article" | "finger"
  selector: string;    // protocol-native address (gopher selector, NNTP message-id, finger user)
  label: string;       // human display string
  host: string;
  port: number;
  mime: string;        // "text/plain" | "text/html" | "message/rfc822" | etc.
  bytes: number;       // 0 if unknown
}

export interface Source {
  id: string;
  protocol: Protocol;
  host: string;
  port: number;
  description: string;
}

export interface CacheEntry {
  key: string;         // sha256 hex
  protocol: Protocol;
  host: string;
  selector: string;
  createdAt: number;   // Unix ms
  ttlMs: number;
  contentHash: string; // sha256 of body
  bodyPath: string;    // path to .body file on disk
  records?: NormalisedRecord[];
}

export interface SeanceSession {
  id: string;
  protocol: Protocol;
  host: string;
  port: number;
  breadcrumb: string[];  // selector stack
}
```

---

## Protocol Clients (`src/lib/protocols/`)

Each client is a pure async function — no classes, no hidden state. They open a TCP socket via Node's `net` or `tls` module, exchange bytes, close the socket, and return typed results. They never touch the cache or registry; those concerns live in `session.ts`.

### Gopher (`gopher.ts`)

```typescript
export async function gopherFetch(
  host: string,
  port: number,
  selector: string,
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<GopherResult>

export type GopherResult =
  | { ok: true;  type: "menu";   items: GopherItem[] }
  | { ok: true;  type: "text";   body: string }
  | { ok: false; error: GopherError }

export interface GopherItem {
  kind: string;   // raw item-type char: "0" "1" "7" "i" …
  label: string;
  selector: string;
  host: string;
  port: number;
}
```

The selector is sent as `<selector>\r\n`. For item type `7` (search), callers append `\t<query>` before passing to this function.

### NNTP (`nntp.ts`)

```typescript
export async function nntpCommand(
  host: string,
  port: number,
  commands: NNTPCommand[],
  opts?: { timeoutMs?: number; tls?: boolean }
): Promise<NNTPResult[]>

export type NNTPCommand =
  | { cmd: "LIST_ACTIVE" }
  | { cmd: "GROUP"; group: string }
  | { cmd: "OVER"; range: string }
  | { cmd: "ARTICLE"; id: string }
  | { cmd: "DATE" }

export type NNTPResult =
  | { ok: true;  cmd: NNTPCommand["cmd"]; data: unknown }
  | { ok: false; cmd: NNTPCommand["cmd"]; error: NNTPError }
```

A single TCP connection is opened per call; the commands array allows pipelining within one session. STARTTLS is initiated before any auth if `tls: true`.

### Finger (`finger.ts`)

```typescript
export async function fingerFetch(
  host: string,
  port: number,
  user: string,
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<FingerResult>

export type FingerResult =
  | { ok: true;  body: string }
  | { ok: false; error: FingerError }
```

---

## Error Types (`src/lib/errors.ts`)

```typescript
export class GopherError extends Error {
  constructor(public reason: "timeout" | "refused" | "parse" | "toobig", message: string) { super(message) }
}

export class NNTPError extends Error {
  constructor(public code: number, message: string) { super(message) }
}

export class FingerError extends Error {
  constructor(public reason: "timeout" | "refused" | "toobig", message: string) { super(message) }
}

export class ForbiddenHostError extends Error {
  constructor(host: string, port: number) {
    super(`Host ${host}:${port} is not in the allow-list`)
  }
}
```

---

## Normaliser (`src/lib/normaliser.ts`)

The normaliser converts a raw protocol result into `NormalisedRecord[]`. It must be total — no input should cause it to throw. Parsing errors produce a record with `kind: "error"`.

```typescript
export function normaliseGopher(items: GopherItem[], host: string, port: number): NormalisedRecord[]
export function normaliseNNTP(result: unknown, host: string): NormalisedRecord[]
export function normaliseFinger(body: string, host: string, user: string): NormalisedRecord[]
```

---

## Session Layer (`src/lib/session.ts`)

`SeanceSession` wraps the protocol clients and the cache. It is instantiated per-request (stateless across HTTP boundaries); the breadcrumb is passed in and out via serialised URL state.

```typescript
export async function seanceNavigate(
  session: SeanceSession,
  selector: string
): Promise<{ records: NormalisedRecord[]; raw: string; updatedSession: SeanceSession }>
```

The function:
1. Checks the registry (`registry.ts`) — throws `ForbiddenHostError` if host is not allowed.
2. Checks the cache — returns immediately on hit.
3. Calls the appropriate protocol client.
4. Normalises the result.
5. Writes to the cache.
6. Returns records + raw bytes + updated session (with breadcrumb appended).

---

## File-Based Cache (`src/lib/cache.ts`)

Cache root: `process.env.SEANCE_CACHE_DIR ?? path.join(os.homedir(), ".seance", "cache")`.

Layout:
```
<cache_root>/
  index.json       # array of CacheEntry (metadata only)
  bodies/
    <sha256>.body  # raw response bytes
```

```typescript
export async function cacheGet(key: string): Promise<{ body: string; records?: NormalisedRecord[] } | null>
export async function cachePut(key: string, entry: Omit<CacheEntry, "key">, body: string, records: NormalisedRecord[]): Promise<void>
export async function cacheEvict(maxBytes: number): Promise<void>
```

`cacheGet` reads `index.json`, finds the entry by key, checks `createdAt + ttlMs > Date.now()` and that `sha256(body) === contentHash`, then reads the `.body` file. Returns `null` on any miss or integrity failure.

`cacheEvict` sorts entries by `createdAt` ascending (oldest first) and deletes body files + removes from index until total size is under `maxBytes`.

Index writes use `fs.promises.writeFile` with a `.tmp` rename to avoid torn writes.

---

## Source Registry (`src/lib/registry.ts`)

```typescript
export interface Source { id: string; protocol: Protocol; host: string; port: number; description: string }

export function loadRegistry(path?: string): Source[]
export function isAllowed(host: string, port: number): boolean
```

`loadRegistry` reads `sources.json` synchronously at startup and caches in module scope. `isAllowed` checks against the loaded list. If `SEANCE_ALLOW_ARBITRARY_HOSTS=true`, `isAllowed` always returns true but logs a warning via `console.warn`.

---

## MCP Tool Layer (`src/lib/mcp-tools.ts` + `src/app/api/mcp/route.ts`)

Uses `@modelcontextprotocol/sdk` server in HTTP+SSE mode.

Tools registered:

| Tool name | Input schema | Returns |
|---|---|---|
| `seance.list_sources` | `{}` | `Source[]` |
| `seance.browse` | `{protocol, host, port?, selector?}` | `NormalisedRecord[]` |
| `seance.read` | `{protocol, host, port?, selector}` | `{body: string, mime: string}` |
| `seance.search_usenet` | `{host, port?, group, query}` | `NormalisedRecord[]` |
| `seance.finger` | `{host, port?, user}` | `{body: string}` |

Each tool calls `seanceNavigate` and returns the result, or returns an MCP error on `ForbiddenHostError` (code `FORBIDDEN_HOST`) or timeout (code `TIMEOUT`).

The route handler in `src/app/api/mcp/route.ts` exports `GET` and `POST` Next.js route handlers that delegate to the MCP SDK server instance.

---

## Browsing UI

### Pages

- **`/`** (`src/app/page.tsx`) — lists all sources from `loadRegistry()` in a Server Component. Each source is a link to `/browse/<protocol>/<host>[/<selector...>]`.
- **`/browse/[...path]`** (`src/app/browse/[...path]/page.tsx`) — Server Component that:
  1. Parses `protocol`, `host`, `port`, `selector` from the URL path segments.
  2. Calls `seanceNavigate` server-side.
  3. Passes `records`, `raw`, and `breadcrumb` to the appropriate Client Component.

### Client Components

- **`GopherMenu`** — renders `NormalisedRecord[]` as a list; navigable items are `<Link>` elements, info items are `<span>`.
- **`ArticleList`** — renders NNTP `OVER` result as a table of subject/from/date; each row links to `/browse/nntp/<host>/<group>/<messageId>`.
- **`FingerOutput`** — renders finger body in `<pre>`.
- **`Breadcrumb`** — renders the selector stack as clickable links.
- **`RawToggle`** — client-side toggle between rendered view and raw text in `<pre>`.

### Internal proxy API

`src/app/api/proxy/route.ts` is used only by the UI's client components if they need to fetch additional data without a full page reload. It validates against the allow-list before forwarding.

---

## Data Flow (end-to-end example: Gopher browse)

```
Browser GET /browse/gopher/gopher.floodgap.com/
  → Next.js Server Component
    → seanceNavigate({ protocol:"gopher", host:"gopher.floodgap.com", port:70 }, "/")
      → registry.isAllowed("gopher.floodgap.com", 70) ✓
      → cacheGet(sha256("gophergoopher.floodgap.com/")) → miss
      → gopherFetch("gopher.floodgap.com", 70, "/")
        → TCP connect, send "\r\n", read up to 512KB, parse lines
        → returns { ok:true, type:"menu", items:[…] }
      → normaliseGopher(items, …) → NormalisedRecord[]
      → cachePut(key, entry, raw, records)
      → returns { records, raw, updatedSession }
  → Server Component renders <GopherMenu records={records} />
     + <Breadcrumb path={["/"]} />
     + <RawToggle raw={raw} />
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `SEANCE_CACHE_DIR` | `~/.seance/cache` | Cache root directory |
| `SEANCE_CACHE_MAX_MB` | `256` | Max cache size before eviction |
| `SEANCE_REGISTRY_PATH` | `./sources.json` | Allow-list JSON path |
| `SEANCE_ALLOW_ARBITRARY_HOSTS` | `false` | Disable host allow-list (dangerous) |
| `SEANCE_GOPHER_TIMEOUT_MS` | `10000` | Gopher per-connection timeout |
| `SEANCE_NNTP_TIMEOUT_MS` | `15000` | NNTP per-connection timeout |
| `SEANCE_FINGER_TIMEOUT_MS` | `5000` | Finger per-connection timeout |
| `PORT` | `3000` | Next.js listen port |

---

## Testing Strategy

All tests run with `vitest`. Property-based tests use `fast-check`.

| File | What it tests |
|---|---|
| `tests/gopher.property.test.ts` | `gopherFetch` parser is total for `fc.uint8Array()` input |
| `tests/nntp.property.test.ts` | NNTP response parser handles arbitrary multi-line input |
| `tests/normaliser.property.test.ts` | Every record round-trips through normaliser; `kind` is always a non-empty string |
| `tests/cache.test.ts` | Cache miss/hit, TTL expiry, content-hash mismatch, eviction ordering |

Property invariants:
- `normaliseGopher(parseGopherMenu(arbitraryBytes), host, port)` never throws.
- For any `NormalisedRecord r`, `r.host.length > 0 && r.kind.length > 0`.
- After `cachePut` + `cacheGet` within TTL, returned body equals stored body.
- Byte cap: a response body of exactly `maxBytes + 1` bytes returns an error, not a truncated result.
