# SÉANCE — Requirements (Kiroween 2026 · Resurrection)

## One line
An agent-native gateway that resurrects dead internet protocols — Gopher, Usenet (NNTP) and Finger — and makes them queryable by AI agents over MCP and by humans through a haunted browser interface.

## Why now (impact)
- In 2024 Google Groups cut off Usenet, orphaning ~40 years of public discussion only reachable through raw NNTP servers that carry a rolling window of recent articles.
- Gopher never died: servers like gopher.floodgap.com and quux.org still serve real content over port 70, but nothing modern speaks the protocol.
- AI agents are being pointed at the web and drowning in JavaScript, paywalls and bot walls. Gopher and NNTP are the opposite: plain text, no JS, no tracking, kilobytes per page — ideal machine-readable sources.
- The result: an archive nobody can browse, a protocol nobody can speak, and agents that need exactly what those protocols provide.

## Users
1. AI agent developers wiring data sources into tools (primary).
2. Researchers and archivists who need the old discussion record.
3. Retro-computing hobbyists who want a modern client.

## Core capabilities (v1)
- **R1 Protocol clients.** Speak Gopher (item types 0/1/7/i), NNTP (LIST, GROUP, ARTICLE, OVER/XOVER, DATE) and Finger (RFC 1288) from a single transport layer with per-connection timeouts and explicit error types.
- **R2 Séance sessions.** A session binds one protocol + one host + a menu/group state; each response is a normalised record `{kind, selector, label, host, port, mime, bytes}` so the UI and agents consume the same shape.
- **R3 Agent bridge (MCP).** Expose `seance.list_sources`, `seance.browse`, `seance.read`, `seance.search_usenet`, `seance.finger` as MCP tools so any agent runtime can call them.
- **R4 Browsing UI.** A haunted-client interface that renders Gopher menus, article headers and finger output as readable text, with a breadcrumb of the selector path and a raw-view toggle.
- **R5 Safety.** Every outbound connection is allow-listed to a curated source registry, capped in bytes and seconds, and never proxies arbitrary hosts supplied by an LLM without an explicit operator flag.
- **R6 Archive cache.** Responses are cached with ttl + content hash so repeated agent calls are cheap and the demo works when a remote server is slow.

## Non-goals
- No uploading, posting or authenticated NNTP actions.
- No circumvention of paywalls or bot protection.
- No binary/media rendering beyond MIME labelling.

## Acceptance
- A judge can open the public URL, browse gopher.floodgap.com, open a Usenet group and run a finger query, and see the same records returned by the MCP tools.
- `npm test` runs property-based tests asserting: menu record parsing is total (never throws) for arbitrary input; every record round-trips through the normaliser; byte caps always terminate.