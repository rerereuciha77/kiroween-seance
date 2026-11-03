---
title: "Calling back the dead internet: building SÉANCE with Kiro"
published: true
description: "Gopher, Usenet and Finger still answer. A spec-driven build of an MCP gateway to the machine-readable internet that never died — for Kiroween 2026."
tags: ai, typescript, webdev, opensource
cover_image: ""
---

*This post is part of the [Kiroween 2026](https://kiroween.devpost.com) hackathon. It documents how I built SÉANCE — an agent-native gateway to Gopher, Usenet and Finger — and what spec-driven development with Kiro actually changed about the way I ship software.*

---

## The internet that never died

In 2024, Google Groups stopped carrying Usenet. Two decades of technical conversation, argument, and accidental documentation disappeared from the searchable web in a single product decision. Not deleted — Usenet still exists on independent servers — but amputated from the way most people reach information.

Gopher was declared dead in 1995. Finger was declared dead before that. Both still answer.

I checked, last week, from a $5 VPS with a shell:

```
gopher.floodgap.com:70       93 menu items, 637ms
news.neodome.net:119         45,793 groups
graph.no:79                  1,293 bytes of ASCII weather forecast
```

Three protocols, three surviving communities, one thing in common: they are **trivial to parse**, they **cost almost nothing to serve**, and they are **machine-readable by construction**. Gopher menus are tab-delimited. NNTP is line-oriented. Finger sends whatever it wants, in plain text.

That makes them an unusually good substrate for language-model agents — real, non-synthetic, human-authored data with a small token footprint. The problem is that no agent framework speaks them. There is no MCP server for Gopher. There is no normalised record for a Usenet article. Every agent that wants this data has to write a socket client first.

So I built **SÉANCE**: a gateway that gives agents one tool surface over all three protocols, and gives humans a small haunted reading room to watch them work.

## What SÉANCE is

Two surfaces over one library:

**A stateless MCP endpoint** at `POST /api/mcp`, exposing five tools:

| Tool | What it does |
| --- | --- |
| `seance_list_sources` | returns the allow-list |
| `seance_browse` | walks a Gopher menu, a Usenet group, or a Finger host |
| `seance_read` | fetches one document, article, or finger body |
| `seance_search_usenet` | filters recent articles by substring |
| `seance_finger` | queries a Finger server directly |

**A Next.js browsing UI** where every selector is a URL, every page has a breadcrumb, and there is a `RAW` button that shows the bytes the server actually sent next to the rendered records. That toggle is not decoration — it is how you prove to yourself that the normaliser is not lying.

Under both surfaces sits one shape:

```ts
interface NormalisedRecord {
  kind: string      // menu | text | info | group | article | finger
  selector: string  // gopher selector, message-id, or finger user
  label: string
  host: string
  port: number
  mime: string
  bytes: number
  author?: string   // Usenet From
  date?: string     // Usenet Date, RFC 5322
}
```

An agent never needs a per-protocol parser. It asks for a selector, gets records, and can render or reason over them.

## How Kiro changed the build

I used Kiro's CLI in headless mode, spec first. The workflow was:

1. Write `REQUIREMENTS.md` by hand — 32 lines, six requirements in EARS form.
2. Ask Kiro to turn that into a spec: `requirements.md` (94 lines, R1–R6), `design.md` (375 lines: TypeScript 5 strict, Node 20, Next 15, Vitest, fast-check), and `tasks.md` (96 lines, 48 tasks across 9 phases).
3. Implement phase by phase, committing after each verified checkpoint.

That order matters more than it sounds. Normally I open an editor and start typing, and the architecture emerges from whatever I happen to write first. Kiro's spec forces the shape of the system to exist as a document **before** any code does — and because the tasks are numbered and each one cites a requirement ID, every commit can say which requirement it closes.

Model choice was economic, not aesthetic. Kiro prices by rate multiplier: `qwen3-coder-next` at 0.05×, `minimax-m2.1` at 0.15×, `deepseek-3.2` at 0.25×, `claude-sonnet-4.5` at 1.3×. Spec generation — the part where you want a strong model, because a bad spec poisons everything downstream — ran on the expensive model. Mechanical implementation phases ran on the 0.05× model. I got roughly 26 hours of the expensive model's budget out of the same credits.

### The part where spec-driven development humbled me

Here is what I did not expect: **the generated code passed its own tests and was still wrong.**

The first implementation of the Gopher parser split each menu line on tabs and took `parts[0]` as the item type and `parts[1]` as the label. Perfectly reasonable code. The tests passed. But RFC 1436 puts the type character **glued to the display string**, so a real line looks like:

```
1World\t/world\tgopher.floodgap.com\t70
```

Not `1\tWorld\t…`. The parser was reading the label as the selector, and the selector as the host. Because the unit tests were written by the same pass that wrote the parser, they encoded the same misunderstanding — the tests tested the code against itself.

I only found it by pointing the client at a real server and reading the output. That is the lesson I would put on a wall: **a property test proves your parser is total, not that it is correct; only a live peer can do that.**

The same class of bug appeared in the NNTP client, twice:

- The group parser didn't strip the leading `211` status code, so `count`, `first`, `last` and `group` were all shifted by one field. A group with 211 articles reported 211 as its count only by coincidence.
- `OVER` fails with `412 Not in a newsgroup` unless you have already sent `GROUP` **on the same connection**. My first implementation opened a fresh connection for the article listing, spent an afternoon debugging a protocol error that was really a session error, and then rewrote the transport to send both commands in one call.

Both fixes are three lines. Finding them required a live server, not a better prompt.

## The cache that isn't a database

SÉANCE has no database. Gopher and Usenet move slowly enough that a file cache with a TTL is sufficient, and a cache you can inspect with `ls` is a cache you can debug at 2am.

- key: `sha256(protocol:host:port:selector)`
- hit requires: TTL not expired **and** sha256 of the stored body matching the recorded hash — a truncated or tampered body is treated as a miss, not served
- writes: `.tmp` file then `rename()`, so a crash mid-write never leaves a half-body that looks valid
- eviction: sort by `createdAt`, delete oldest bodies until the directory is under its byte budget (8 MB default)

The second hit on `gopher.floodgap.com` root came back in **6ms**, versus 637ms from the network. That ratio is the entire argument for the cache existing.

## Allow-list as the security boundary

Gopher and NNTP are plaintext, unauthenticated, and will happily proxy you anywhere. The only defensible boundary is an explicit allow-list in `sources.json`, checked **before a socket is opened**:

```ts
if (!isAllowed(host, port)) {
  throw new ForbiddenHostError(host, port)
}
```

MCP maps that to a `FORBIDDEN_HOST` error code rather than a generic failure, so an agent can distinguish "I'm not allowed" from "the server is down" and react sensibly. `SEANCE_ALLOW_ARBITRARY_HOSTS=true` exists for local experimentation and logs a warning on every check — a footgun with a label on it.

## Numbers

- **37 tests** across 6 files, including property-based tests (`fast-check`) that throw arbitrary bytes at both parsers and assert they never throw, plus byte-cap tests that fire a 512 KB + 1 byte response at the client and require a `toobig` error.
- **45,793** groups listed over one NNTP connection.
- **30** most recent articles per group, fetched with `OVER` inside a `GROUP` session.
- **93** records from the Floodgap Gopher root.
- Cold browse: 600–1,400ms. Warm: 6ms.
- `tsc --noEmit` clean, `next build` clean.

## What I'd tell the next person

**Write the spec before the code, but don't trust the tests the spec generates.** The spec was genuinely useful — it caught design ambiguities early and made every commit traceable to a requirement. The tests, generated alongside the implementation, gave false confidence for half a day.

**Pin the protocol version of your dependencies.** `@modelcontextprotocol/sdk` 0.5.0 and 1.32.2 are different libraries with the same name. The transport I needed (`WebStandardStreamableHTTPServerTransport`) simply does not exist in the old line.

**Endpoint verification is nobody's favourite task and it's always the blocker.** Vercel's phone verification refused my number twice, so the public deployment runs on a Cloudflare quick tunnel instead — an ephemeral URL and an honest note in the README. The submission ships either way.

**Cheap models are fine for mechanical work, but only if you verify mechanically.** The 0.05× model wrote the boring 80% correctly on the first pass. The 20% that touched the wire format needed a live server and a human reading output.

## Try it

- Source: `github.com/rerereuciha77/kiroween-seance` (MIT, spec in `.kiro/specs/seance/`)
- MCP: `POST /api/mcp` — point any MCP client at it, no key needed
- UI: pick a source, press `RAW`, compare bytes against what the model claims

Gopher is not a museum piece. Usenet is not a graveyard. They are the parts of the internet that were designed to be read by machines, thirty years before anything else was — and a model with five honest tools can still talk to them.

*Built for [Kiroween 2026](https://kiroween.devpost.com). Spec-driven, Kiro CLI, TypeScript, zero database.*