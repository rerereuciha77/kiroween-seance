import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadRegistry } from './registry'
import { createSession, seanceNavigate } from './session'
import { ForbiddenHostError } from './errors'
import { Protocol } from '@/types'

const TOOL_TIMEOUT_MS = 30_000

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

function fail(code: string, message: string): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }], isError: true }
}

function toErrorResult(err: unknown): ToolResult {
  if (err instanceof ForbiddenHostError) return fail('FORBIDDEN_HOST', err.message)
  const e = err as { name?: string; message?: string }
  return fail(e?.name ?? 'ERROR', e?.message ?? 'unknown error')
}

/**
 * Run one tool body with a hard 30s cap and uniform error mapping.
 * Never throws: timeouts become TIMEOUT, domain errors keep their own code.
 */
async function guarded(label: string, fn: () => Promise<ToolResult>): Promise<ToolResult> {
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<ToolResult>((resolve) => {
      timer = setTimeout(() => resolve(fail('TIMEOUT', `${label} exceeded ${TOOL_TIMEOUT_MS}ms`)), TOOL_TIMEOUT_MS)
    })
    return await Promise.race([fn(), timeout])
  } catch (err) {
    return toErrorResult(err)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function defaultPort(protocol: Protocol): number {
  return protocol === 'gopher' ? 70 : protocol === 'nntp' ? 119 : 79
}

/**
 * Build the SÉANCE MCP server with its five tools.
 * A fresh instance is created per HTTP request (stateless transport).
 */
export function createSeanceServer(): McpServer {
  const server = new McpServer(
    { name: 'seance', version: '0.1.0' },
    {
      instructions:
        'SÉANCE exposes the machine-readable internet that predates the web: Gopher menus, Usenet news and ' +
        'Finger. Call seance_list_sources first to see which hosts are allow-listed, then seance_browse to walk ' +
        'a menu or group, and seance_read to fetch a single document.',
    }
  )

  server.registerTool(
    'seance_list_sources',
    {
      title: 'List allow-listed sources',
      description: 'Return every source in sources.json with its protocol, host, port and description.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => guarded('seance_list_sources', async () => ok(loadRegistry()))
  )

  server.registerTool(
    'seance_browse',
    {
      title: 'Browse a Gopher menu, Usenet group or Finger host',
      description:
        'Navigate one selector. Gopher: "/" or "/world". NNTP: "*" for the group list, or a group name such as ' +
        '"comp.lang.forth". Finger: a user name, or "" for the default listing.',
      inputSchema: {
        protocol: z.enum(['gopher', 'nntp', 'finger']).describe('Which legacy protocol to speak'),
        host: z.string().min(1).describe('Allow-listed host name'),
        port: z.number().int().min(1).max(65535).optional().describe('Defaults to 70 / 119 / 79'),
        selector: z.string().optional().describe('Protocol-native selector, "" for the root'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ protocol, host, port, selector }) =>
      guarded('seance_browse', async () => {
        const session = createSession(protocol, host, port ?? defaultPort(protocol))
        const nav = await seanceNavigate(session, selector ?? '')
        return ok({
          protocol,
          host,
          port: session.port,
          selector: selector ?? '',
          cached: nav.cached,
          count: nav.records.length,
          records: nav.records,
          raw: nav.raw.slice(0, 4000),
        })
      })
  )

  server.registerTool(
    'seance_read',
    {
      title: 'Read one document or article',
      description:
        'Fetch the body of a single item: a Gopher text selector, a Usenet message-id in angle brackets, or a ' +
        'Finger user name.',
      inputSchema: {
        protocol: z.enum(['gopher', 'nntp', 'finger']).describe('Protocol of the target item'),
        host: z.string().min(1),
        port: z.number().int().min(1).max(65535).optional(),
        selector: z.string().min(1).describe('Gopher selector, <message-id>, or finger user'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ protocol, host, port, selector }) =>
      guarded('seance_read', async () => {
        const session = createSession(protocol, host, port ?? defaultPort(protocol))
        const nav = await seanceNavigate(session, selector)
        return ok({
          protocol,
          host,
          selector,
          mime: nav.records[0]?.mime ?? 'text/plain',
          bytes: Buffer.byteLength(nav.raw, 'utf8'),
          body: nav.raw.slice(0, 20000),
        })
      })
  )

  server.registerTool(
    'seance_search_usenet',
    {
      title: 'Search recent Usenet articles',
      description:
        'Pull the most recent articles of a group and filter them by a case-insensitive substring over subject ' +
        'and author. Returns matching records with their message-ids.',
      inputSchema: {
        group: z.string().min(1).describe('Group name, e.g. comp.lang.forth'),
        query: z.string().min(1).describe('Substring to match against subject or author'),
        host: z.string().optional().describe('Defaults to the first nntp source in sources.json'),
        port: z.number().int().min(1).max(65535).optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Max matches, default 10'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ group, query, host, port, limit }) =>
      guarded('seance_search_usenet', async () => {
        const nntpSource = loadRegistry().find(s => s.protocol === 'nntp')
        const targetHost = host ?? nntpSource?.host
        if (!targetHost) throw new Error('no nntp source configured')
        const session = createSession('nntp', targetHost, port ?? nntpSource?.port ?? 119)
        const nav = await seanceNavigate(session, group)
        const needle = query.toLowerCase()
        const matches = nav.records
          .filter(r => r.label.toLowerCase().includes(needle))
          .slice(0, limit ?? 10)
        return ok({ group, query, host: targetHost, scanned: nav.records.length, matches })
      })
  )

  server.registerTool(
    'seance_finger',
    {
      title: 'Finger a user',
      description: 'Query a Finger server (RFC 1288) and return the plain-text body.',
      inputSchema: {
        user: z.string().optional().describe('User name; omit for the default listing'),
        host: z.string().optional().describe('Defaults to the first finger source in sources.json'),
        port: z.number().int().min(1).max(65535).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ user, host, port }) =>
      guarded('seance_finger', async () => {
        const fingerSource = loadRegistry().find(s => s.protocol === 'finger')
        const targetHost = host ?? fingerSource?.host
        if (!targetHost) throw new Error('no finger source configured')
        const session = createSession('finger', targetHost, port ?? fingerSource?.port ?? 79)
        const nav = await seanceNavigate(session, user ?? '')
        return ok({ host: targetHost, user: user ?? null, body: nav.raw.slice(0, 8000) })
      })
  )

  return server
}

export { defaultPort }