import { NextRequest, NextResponse } from 'next/server'
import { createSession, seanceNavigate } from '@/lib/session'
import { ForbiddenHostError } from '@/lib/errors'
import { Protocol } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_PORT: Record<Protocol, number> = { gopher: 70, nntp: 119, finger: 79 }

function isProtocol(value: unknown): value is Protocol {
  return value === 'gopher' || value === 'nntp' || value === 'finger'
}

/**
 * JSON proxy for client components.
 * Validates the request against the allow-list (via seanceNavigate, which
 * throws ForbiddenHostError) before any socket is opened.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams
  const protocol = sp.get('protocol')
  const host = sp.get('host')
  const selector = sp.get('selector') ?? ''
  const portParam = sp.get('port')

  if (!isProtocol(protocol) || !host) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'protocol must be gopher|nntp|finger and host is required' } },
      { status: 400 }
    )
  }

  const parsedPort = portParam ? Number.parseInt(portParam, 10) : NaN
  const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_PORT[protocol]

  try {
    const nav = await seanceNavigate(createSession(protocol, host, port), selector)
    return NextResponse.json({
      protocol,
      host,
      port,
      selector,
      cached: nav.cached,
      count: nav.records.length,
      records: nav.records,
      raw: nav.raw.slice(0, 10000),
    })
  } catch (err) {
    if (err instanceof ForbiddenHostError) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN_HOST', message: err.message } },
        { status: 403 }
      )
    }
    const e = err as { name?: string; message?: string }
    return NextResponse.json(
      { error: { code: e?.name ?? 'ERROR', message: e?.message ?? 'unknown failure' } },
      { status: 502 }
    )
  }
}