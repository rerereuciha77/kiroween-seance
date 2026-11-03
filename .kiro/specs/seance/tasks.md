# SÉANCE — Implementation Tasks

Tasks are ordered so each builds on the previous. Complete them in sequence. Each task references the requirement(s) it satisfies.

---

## Phase 1 — Project Scaffold

- [x] **1.** Initialise the repo: `pnpm create next-app seance --ts --app --no-tailwind --no-eslint`, then pin Node 20 in `.nvmrc` and `package.json#engines`. _(no req — infrastructure)_
- [x] **2.** Add dev dependencies: `vitest`, `@vitest/ui`, `fast-check`, `@modelcontextprotocol/sdk`. Add `vitest.config.ts` with `testEnvironment: "node"`. _(no req — infrastructure)_
- [x] **3.** Configure TypeScript strict mode (`strict: true`, `noUncheckedIndexedAccess: true`) in `tsconfig.json`. _(no req — infrastructure)_
- [x] **4.** Create `src/types/index.ts` with `Protocol`, `NormalisedRecord`, `Source`, `CacheEntry`, and `SeanceSession` types exactly as specified in design.md. _(R2)_
- [x] **5.** Create `src/lib/errors.ts` with `GopherError`, `NNTPError`, `FingerError`, and `ForbiddenHostError`. _(R1, R5)_
- [x] **6.** Create `sources.json` at repo root with at least three allow-listed sources: `gopher.floodgap.com:70`, a public NNTP server, and a Finger host. _(R5)_

---

## Phase 2 — Source Registry

- [x] **7.** Implement `src/lib/registry.ts`: `loadRegistry(path?)` reads and validates `sources.json`, caches in module scope. _(R5)_
- [x] **8.** Implement `isAllowed(host, port)` in `registry.ts`: checks loaded list; if `SEANCE_ALLOW_ARBITRARY_HOSTS=true` returns `true` and logs a warning. _(R5)_
- [x] **9.** Write unit tests for `loadRegistry` (valid JSON, missing file, bad schema) and `isAllowed` (known host, unknown host, arbitrary-hosts flag). _(R5)_

---

## Phase 3 — Protocol Clients

- [x] **10.** Implement `src/lib/protocols/gopher.ts`: TCP connect via `net.createConnection`, send `<selector>\r\n`, read up to `maxBytes` (default 512 KB), detect item-type-1 menus vs plain text, return `GopherResult`. _(R1.1)_
- [x] **11.** Implement Gopher menu parser (within `gopher.ts`): split on `\r\n`, parse tab-delimited fields, handle malformed lines gracefully (produce `kind:"i"` fallback). _(R1.1)_
- [x] **12.** Implement `src/lib/protocols/nntp.ts`: open TCP (with optional STARTTLS via `tls.connect`), send commands sequentially, parse multi-line `.-terminated` responses, return `NNTPResult[]`. _(R1.2)_
- [x] **13.** Implement NNTP response parsers within `nntp.ts` for: `LIST ACTIVE`, `GROUP`, `OVER`/`XOVER`, `ARTICLE`, `DATE`. _(R1.2)_
- [x] **14.** Implement `src/lib/protocols/finger.ts`: TCP connect on port 79, send `/W <user>\r\n`, read up to 64 KB, return `FingerResult`. _(R1.3)_
- [x] **15.** Write property-based tests in `tests/gopher.property.test.ts`: use `fc.uint8Array()` to generate arbitrary server responses and assert the parser never throws, always returns a `GopherResult`. _(R1.1, acceptance criterion 4)_
- [x] **16.** Write property-based tests in `tests/nntp.property.test.ts`: arbitrary multi-line NNTP response text never causes the parser to throw. _(R1.2, acceptance criterion 4)_

---

## Phase 4 — Normaliser

- [x] **17.** Implement `src/lib/normaliser.ts`: `normaliseGopher`, `normaliseNNTP`, `normaliseFinger` — each returns `NormalisedRecord[]` and must not throw. _(R2)_
- [x] **18.** Write property-based tests in `tests/normaliser.property.test.ts`: for arbitrary `GopherItem[]` input, every output record has non-empty `kind` and `host`; records round-trip (normalise → same shape). _(R2, acceptance criterion 4)_

---

## Phase 5 — File-Based Cache

- [x] **19.** Implement `src/lib/cache.ts`: `cacheGet` reads `index.json`, checks TTL and content hash, reads `.body` file. Returns `null` on miss/expiry/corruption. _(R6)_
- [x] **20.** Implement `cachePut` in `cache.ts`: writes `.body` file, updates `index.json` using `.tmp` rename for atomicity. _(R6)_
- [x] **21.** Implement `cacheEvict` in `cache.ts`: sorts by `createdAt` ascending, deletes oldest `.body` files until total cache size is under `maxBytes`. _(R6)_
- [x] **22.** Write tests in `tests/cache.test.ts`: cache miss, cache hit within TTL, TTL expiry returns null, content-hash mismatch returns null, eviction removes oldest entries. _(R6, acceptance criterion 4)_

---

## Phase 6 — Session Layer

- [x] **23.** Implement `src/lib/session.ts`: `seanceNavigate` checks registry, checks cache, calls the correct protocol client, normalises, writes to cache, returns `{records, raw, updatedSession}`. _(R2)_
- [x] **24.** Ensure `seanceNavigate` appends the selector to `session.breadcrumb` in `updatedSession`. _(R2)_
- [x] **25.** Ensure `seanceNavigate` throws `ForbiddenHostError` (not a generic error) when the host is not in the allow-list. _(R5)_

---

## Phase 7 — MCP Tool Layer

- [x] **26.** Install and configure `@modelcontextprotocol/sdk`; create a singleton MCP server instance in `src/lib/mcp-tools.ts`. _(R3)_
- [x] **27.** Register `seance.list_sources` tool: calls `loadRegistry()`, returns `Source[]` as JSON. _(R3)_
- [x] **28.** Register `seance.browse` tool: validates input with Zod, calls `seanceNavigate`, returns `NormalisedRecord[]`. _(R3)_
- [x] **29.** Register `seance.read` tool: fetches a single document/article body, returns `{body, mime}`. _(R3)_
- [x] **30.** Register `seance.search_usenet` tool: issues `XPAT` or header search via NNTP client, returns matching `NormalisedRecord[]`. _(R3)_
- [x] **31.** Register `seance.finger` tool: calls `fingerFetch`, returns `{body}`. _(R3)_
- [x] **32.** Wrap all tool handlers with a 30-second `Promise.race` timeout; return MCP error code `TIMEOUT` on expiry. Return `FORBIDDEN_HOST` error on `ForbiddenHostError`. _(R3, R5)_
- [x] **33.** Implement `src/app/api/mcp/route.ts`: export `GET` and `POST` Next.js route handlers that delegate to the MCP SDK server instance. _(R3)_

---

## Phase 8 — Browsing UI

- [x] **34.** Implement `src/app/page.tsx` as a Next.js Server Component: call `loadRegistry()`, render a source list with protocol badges and links to `/browse/<protocol>/<host>`. _(R4)_
- [x] **35.** Implement `src/app/browse/[...path]/page.tsx` as a Server Component: parse URL segments into `{protocol, host, port, selector}`, call `seanceNavigate`, pass data to child components. _(R4)_
- [x] **36.** Implement `src/components/Breadcrumb.tsx`: render the breadcrumb array as `<Link>` elements pointing to the appropriate `/browse/…` URL for each ancestor. _(R4)_
- [x] **37.** Implement `src/components/RawToggle.tsx` as a Client Component (`"use client"`): toggle between rendered children and raw `<pre>` block. _(R4)_
- [x] **38.** Implement `src/components/GopherMenu.tsx`: map `NormalisedRecord[]` to navigable `<Link>` elements (kind `"menu"`, `"text"`, `"search"`) and plain `<span>` for kind `"info"`. _(R4)_
- [x] **39.** Implement `src/components/ArticleList.tsx`: render NNTP article records as a table with subject/from/date columns; each row links to the full-article URL. _(R4)_
- [x] **40.** Implement `src/components/FingerOutput.tsx`: render finger body in a `<pre className="font-mono">` block. _(R4)_
- [x] **41.** Implement `src/app/api/proxy/route.ts`: internal API route for client components; validates `{protocol, host, port, selector}` against the allow-list before calling `seanceNavigate`. _(R4, R5)_

---

## Phase 9 — Integration & Acceptance

- [x] **42.** Run `npm test` (all Vitest tests) and confirm all pass; fix any failures. _(acceptance criterion 4)_
- [x] **43.** Start the dev server (`pnpm dev`), open `http://localhost:3000`, browse `gopher.floodgap.com` to a submenu, and verify rendered records match those returned by `curl`-ing the MCP `seance.browse` tool. _(acceptance criterion 1)_
- [x] **44.** Via the UI, open a Usenet group and verify article records match those returned by `seance.search_usenet` via the MCP endpoint. _(acceptance criterion 2)_
- [x] **45.** Run a Finger query in the UI and confirm the output matches `seance.finger` MCP tool output. _(acceptance criterion 3)_
- [x] **46.** Verify byte caps by mocking a server that returns `512 KB + 1` byte; assert the client returns a `GopherError` with reason `"toobig"`. _(R1.1, acceptance criterion 4)_
- [x] **47.** Verify `SEANCE_ALLOW_ARBITRARY_HOSTS=true` logs a startup warning and allows a non-listed host; verify the default (flag absent) rejects it with `ForbiddenHostError`. _(R5)_
- [x] **48.** Document all environment variables and the `sources.json` schema in `README.md`. _(no req — polish)_
