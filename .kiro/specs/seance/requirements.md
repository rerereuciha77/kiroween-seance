# SÉANCE — Requirements Spec

## Overview
An agent-native gateway that resurrects dead internet protocols — Gopher (RFC 1436), Usenet/NNTP (RFC 3977), and Finger (RFC 1288) — and makes them queryable by AI agents over MCP and by humans through a haunted browser interface.

---

## R1 — Protocol Clients

### R1.1 Gopher client
- **WHEN** the system connects to a Gopher server, **IT SHALL** establish a TCP connection on port 70 (or a configured port) with a per-connection timeout of ≤10 seconds.
- **WHEN** the Gopher server returns a menu (item type `1`), **IT SHALL** parse each tab-delimited line into a record `{kind, label, selector, host, port}` without throwing on malformed lines.
- **WHEN** the Gopher server returns a text document (item type `0`), **IT SHALL** return the full body as UTF-8 text, capped at a configurable byte limit (default 512 KB).
- **WHEN** the Gopher server returns a search (item type `7`), **IT SHALL** send the query string appended to the selector after a TAB character.
- **WHERE** an informational line (item type `i`) is present, **IT SHALL** be included in parsed records with kind `"info"` and empty selector/host/port fields.
- **IF** the connection times out or the server closes without response, **THE SYSTEM SHALL** return a typed error `GopherError` with a reason field, not throw an uncaught exception.

### R1.2 NNTP client
- **WHEN** the system connects to an NNTP server, **IT SHALL** open a TCP connection (plain or STARTTLS) with a per-connection timeout of ≤15 seconds.
- **WHEN** the client issues `LIST ACTIVE`, **IT SHALL** parse each `<group> <high> <low> <status>` line into a `{name, high, low, status}` record.
- **WHEN** the client issues `GROUP <name>`, **IT SHALL** return `{name, count, low, high}`.
- **WHEN** the client issues `OVER <range>` or `XOVER <range>`, **IT SHALL** return an array of header records `{articleId, subject, from, date, messageId, references, bytes, lines}`.
- **WHEN** the client issues `ARTICLE <id>`, **IT SHALL** return `{headers: Map<string,string>, body: string}`, with body capped at 256 KB.
- **WHEN** the server returns a 4xx or 5xx response code, **IT SHALL** return a typed error `NNTPError` with the numeric code and text message.

### R1.3 Finger client
- **WHEN** the system sends a Finger request for `user@host`, **IT SHALL** connect to host on port 79, send `/W <user>\r\n`, and return the raw text response capped at 64 KB.
- **WHEN** the user field is empty, **IT SHALL** send `/W \r\n` to query the system user list.
- **IF** the connection is refused or times out (≤5 second timeout), **IT SHALL** return a typed error `FingerError`.

---

## R2 — Séance Sessions

- **WHEN** a session is created, **IT SHALL** bind exactly one protocol (`"gopher" | "nntp" | "finger"`), one host, and an optional initial selector/group.
- **WHEN** a session produces any response, **IT SHALL** normalise it to the shape `{kind: string, selector: string, label: string, host: string, port: number, mime: string, bytes: number}`.
- **WHEN** a session navigates to a new selector, **IT SHALL** append the selector to the session breadcrumb list, enabling backward navigation.
- **IF** the same session issues an identical request within the TTL window, **IT SHALL** return the cached record without making an outbound connection.

---

## R3 — Agent Bridge (MCP)

- **WHEN** an MCP client calls `seance.list_sources`, **IT SHALL** return the operator-configured allow-list of `{protocol, host, port, description}` entries.
- **WHEN** an MCP client calls `seance.browse` with `{protocol, host, selector}`, **IT SHALL** return an array of normalised records from R2.
- **WHEN** an MCP client calls `seance.read` with `{protocol, host, selector}`, **IT SHALL** return the full text body of the addressed document or article.
- **WHEN** an MCP client calls `seance.search_usenet` with `{host, group, query}`, **IT SHALL** issue an NNTP `XPAT` or header search and return matching article records.
- **WHEN** an MCP client calls `seance.finger` with `{host, user}`, **IT SHALL** return the finger response text.
- **IF** a caller supplies a `host` not in the allow-list AND the operator flag `SEANCE_ALLOW_ARBITRARY_HOSTS` is not set, **THE SYSTEM SHALL** reject the request with an MCP error code `FORBIDDEN_HOST` before making any outbound connection.
- **WHEN** any MCP tool call exceeds 30 seconds total wall time, **IT SHALL** return a timeout error rather than hang.

---

## R4 — Browsing UI

- **WHEN** a user navigates to the root UI page, **IT SHALL** display the list of sources from the allow-list with protocol badges.
- **WHEN** a user selects a Gopher menu source, **IT SHALL** render each parsed item as a clickable link (for navigable types) or plain text (for info items).
- **WHEN** a user selects a Gopher text document, **IT SHALL** display the body in a monospace pre-formatted block.
- **WHEN** a user opens a Usenet group, **IT SHALL** display a paginated list of article headers (subject, from, date) with a link to read the full article body.
- **WHEN** a user submits a Finger query, **IT SHALL** display the server response as pre-formatted text within 5 seconds.
- **WHEN** a user clicks "Raw", **IT SHALL** toggle between the rendered view and the unprocessed server response bytes displayed as text.
- **WHEN** a user is at any depth in a Gopher menu tree, **IT SHALL** show a breadcrumb trail of selectors navigated and allow clicking any ancestor to return to that level.

---

## R5 — Safety

- **WHEN** the server starts, **IT SHALL** load a source registry from a local JSON/YAML file containing the explicit allow-list of `{protocol, host, port}` entries.
- **WHEN** any outbound connection is initiated, **IT SHALL** verify the target `{host, port}` is in the allow-list, refusing if not (unless `SEANCE_ALLOW_ARBITRARY_HOSTS=true`).
- **WHEN** reading any response, **IT SHALL** enforce byte caps: 512 KB for Gopher, 256 KB for NNTP article bodies, 64 KB for Finger.
- **WHEN** any outbound connection is initiated, **IT SHALL** enforce per-connection second caps as defined in R1.
- **WHEN** an operator sets `SEANCE_ALLOW_ARBITRARY_HOSTS=true`, **IT SHALL** log a warning at startup that arbitrary proxying is enabled.

---

## R6 — Archive Cache

- **WHEN** a protocol response is successfully received, **IT SHALL** be stored in a file-based cache keyed by `sha256(protocol + host + selector)` with the response body and a TTL timestamp.
- **WHEN** a cached entry is requested before its TTL expires, **IT SHALL** be served from cache without an outbound connection.
- **WHEN** a cached entry's content hash differs from the stored hash, **IT SHALL** be treated as a cache miss and re-fetched.
- **WHEN** the cache directory exceeds a configurable size limit (default 256 MB), **IT SHALL** evict the least-recently-used entries until under the limit.
- Default TTLs: Gopher menus 5 minutes, Gopher documents 1 hour, NNTP group listing 10 minutes, NNTP article 24 hours, Finger 2 minutes.

---

## Acceptance Criteria (End-to-End)

1. A judge opens the public URL, selects `gopher.floodgap.com`, browses to a submenu item, and sees parsed records matching those returned by the MCP tool `seance.browse`.
2. A judge opens a Usenet group via the UI and via `seance.search_usenet`, and both return the same article records.
3. A judge runs `seance.finger` against an allow-listed host and sees the same output rendered in the UI Finger view.
4. `npm test` passes property-based tests asserting:
   - Menu record parsing is total (never throws) for arbitrary byte-array input.
   - Every record round-trips through the normaliser unchanged.
   - Byte caps always terminate reads before the cap is exceeded.
