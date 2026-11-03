import { gopherFetch } from './protocols/gopher'
import { nntpCommand } from './protocols/nntp'
import { fingerFetch } from './protocols/finger'
import { isAllowed } from './registry'
import { normaliseGopher } from './normaliser'
import { cacheGet, cacheKey, cachePut } from './cache'
import { NormalisedRecord, SeanceSession } from '@/types'
import { ForbiddenHostError, GopherError, FingerError, NNTPError } from './errors'

export interface NavigateResult {
  records: NormalisedRecord[]
  raw: string
  updatedSession: SeanceSession
  cached: boolean
}

const MAX_OVER_ARTICLES = 30

/**
 * Navigate one selector inside a session.
 *
 * Selector grammar (protocol specific):
 *   gopher  any gopher selector, e.g. "/" or "/1/"
 *   nntp    "*" or "" → group list; "<group name>" → recent articles;
 *           "<message-id>" (angle brackets) → full article
 *   finger  a user name or "" for the default listing
 */
export async function seanceNavigate(
  session: SeanceSession,
  selector: string,
  opts: { ttlMs?: number } = {}
): Promise<NavigateResult> {
  const { protocol, host, port } = session
  const sel = selector ?? ''

  if (!isAllowed(host, port)) {
    throw new ForbiddenHostError(host, port)
  }

  const key = cacheKey(protocol, host, port, sel)
  const hit = await cacheGet(key)
  if (hit && hit.entry.records) {
    return {
      records: hit.entry.records,
      raw: hit.body,
      updatedSession: withBreadcrumb(session, sel),
      cached: true,
    }
  }

  let records: NormalisedRecord[] = []
  let raw = ''

  if (protocol === 'gopher') {
    const result = await gopherFetch(host, port, sel)
    if (!result.ok) throw result.error

    if (result.type === 'menu') {
      records = normaliseGopher(result.items, host, port)
      raw = result.items
        .map(i => `${i.kind}${i.label}\t${i.selector}\t${i.host}\t${i.port}\r\n`)
        .join('')
    } else {
      records = [
        {
          kind: 'text',
          selector: sel,
          label: `Text document ${sel || '/'}`,
          host,
          port,
          mime: 'text/plain',
          bytes: Buffer.byteLength(result.body, 'utf8'),
        },
      ]
      raw = result.body
    }
  } else if (protocol === 'finger') {
    const result = await fingerFetch(host, port, sel)
    if (!result.ok) throw result.error
    records = [
      {
        kind: 'finger',
        selector: sel,
        label: `Finger ${sel || '(default)'}@${host}`,
        host,
        port,
        mime: 'text/plain',
        bytes: Buffer.byteLength(result.body, 'utf8'),
      },
    ]
    raw = result.body
  } else {
    const nntp = await navigateNNTP(host, port, sel)
    records = nntp.records
    raw = nntp.raw
  }

  await cachePut({
    protocol,
    host,
    port,
    selector: sel,
    body: raw,
    records,
    ttlMs: opts.ttlMs,
  }).catch(() => undefined) // a cache write must never fail a browse

  return { records, raw, updatedSession: withBreadcrumb(session, sel), cached: false }
}

function withBreadcrumb(session: SeanceSession, selector: string): SeanceSession {
  return { ...session, breadcrumb: [...session.breadcrumb, selector] }
}

/** NNTP selectors: group list, recent articles in a group, or one article. */
async function navigateNNTP(
  host: string,
  port: number,
  selector: string
): Promise<{ records: NormalisedRecord[]; raw: string }> {
  const sel = selector.trim()

  // 1. Group listing
  if (sel === '' || sel === '*') {
    const [res] = await nntpCommand(host, port, [{ cmd: 'LIST_ACTIVE' }])
    if (!res || !res.ok) throw (res as { error: NNTPError }).error ?? new NNTPError(0, 'LIST ACTIVE failed')

    // LIST ACTIVE data is already parsed by the client.
    const groups = (res.data ?? []) as Array<{ group: string; high: number; low: number; flags: string }>
    const records: NormalisedRecord[] = groups.map(g => ({
      kind: 'group',
      selector: g.group,
      label: `${g.group} (${g.high - g.low + 1} articles)`,
      host,
      port,
      mime: 'message/rfc822',
      bytes: 0,
    }))
    return { records, raw: groups.map(g => `${g.group} ${g.high} ${g.low} ${g.flags}`).join('\r\n') }
  }

  // 2. Single article, message-id in angle brackets
  if (sel.startsWith('<')) {
    const [res] = await nntpCommand(host, port, [{ cmd: 'ARTICLE', id: sel }])
    if (!res || !res.ok) throw (res as { error: NNTPError }).error ?? new NNTPError(0, 'ARTICLE failed')

    const payload = res.data as { header: string; body: string }
    const raw = `${payload.header}\n\n${payload.body}`
    const subject = /^Subject:\s*(.*)$/im.exec(payload.header)?.[1]?.trim() ?? sel
    return {
      records: [
        {
          kind: 'article',
          selector: sel,
          label: subject,
          host,
          port,
          mime: 'message/rfc822',
          bytes: Buffer.byteLength(raw, 'utf8'),
        },
      ],
      raw,
    }
  }

  // 3. Recent articles in a group
  const results = await nntpCommand(host, port, [{ cmd: 'GROUP', group: sel }])
  const groupRes = results[0]
  if (!groupRes || !groupRes.ok) {
    throw (groupRes as { error: NNTPError }).error ?? new NNTPError(411, `No such group ${sel}`)
  }

  // GROUP data is already parsed by the client ({count, first, last, group}).
  const info = (groupRes.data ?? null) as { count: number; first: number; last: number; group: string } | null
  const last = info?.last ?? 0
  const count = Math.min(MAX_OVER_ARTICLES, info?.count ?? MAX_OVER_ARTICLES)
  const from = Math.max(info?.first ?? 1, last - count + 1)
  const range = `${from}-${last}`

  // OVER only works inside a selected group, so repeat GROUP on the same
  // connection right before the OVER request.
  const overResults = await nntpCommand(host, port, [
    { cmd: 'GROUP', group: sel },
    { cmd: 'OVER', range },
  ])
  const overRes = overResults[1]
  if (!overRes || !overRes.ok) {
    // An empty group is not an error — return an empty listing.
    const err = (overRes as { error?: NNTPError }).error
    if (err && (err.code === 423 || err.code === 420)) {
      return { records: [], raw: `no articles in ${sel} (${range})` }
    }
    throw err ?? new NNTPError(0, `OVER failed for ${sel}`)
  }

  // OVER data is already parsed by the client.
  const articles = (overRes.data ?? []) as Array<{ number: number; subject: string; from: string; date: string; messageId: string; references: string; bytes: number; lines: number }>
  const records: NormalisedRecord[] = articles
    .slice()
    .reverse()
    .map(a => ({
      kind: 'article',
      selector: a.messageId,
      label: `${a.subject || '(no subject)'} — ${a.from || 'unknown'}`,
      host,
      port,
      mime: 'message/rfc822',
      bytes: a.bytes || 0,
      author: a.from || undefined,
      date: a.date || undefined,
    }))

  return {
    records,
    raw: (overRes.data as string[]).join('\r\n'),
  }
}

/** Build a session for a protocol/host pair (used by UI and MCP tools). */
export function createSession(
  protocol: SeanceSession['protocol'],
  host: string,
  port: number,
  breadcrumb: string[] = []
): SeanceSession {
  return { id: `${protocol}:${host}:${port}`, protocol, host, port, breadcrumb }
}

export type { GopherError, FingerError }