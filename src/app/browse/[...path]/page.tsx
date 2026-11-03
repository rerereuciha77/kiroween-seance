import { notFound } from 'next/navigation'
import Breadcrumb from '@/components/Breadcrumb'
import RawToggle from '@/components/RawToggle'
import GopherMenu from '@/components/GopherMenu'
import ArticleList from '@/components/ArticleList'
import FingerOutput from '@/components/FingerOutput'
import { createSession, seanceNavigate } from '@/lib/session'
import { Protocol } from '@/types'

export const dynamic = 'force-dynamic'

const DEFAULT_PORT: Record<Protocol, number> = { gopher: 70, nntp: 119, finger: 79 }

interface PageProps {
  params: Promise<{ path: string[] }>
  searchParams: Promise<{ s?: string; port?: string }>
}

function isProtocol(value: string): value is Protocol {
  return value === 'gopher' || value === 'nntp' || value === 'finger'
}

export default async function BrowsePage({ params, searchParams }: PageProps) {
  const { path } = await params
  const query = await searchParams

  const [rawProtocol, host] = path
  if (!rawProtocol || !host || !isProtocol(rawProtocol)) notFound()

  const protocol: Protocol = rawProtocol
  const parsedPort = query.port ? Number.parseInt(query.port, 10) : NaN
  const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_PORT[protocol]
  const selector = query.s ?? ''

  const session = createSession(protocol, host, port)

  let navigation: Awaited<ReturnType<typeof seanceNavigate>> | null = null
  let error: { name: string; message: string } | null = null

  try {
    navigation = await seanceNavigate(session, selector)
  } catch (err) {
    const e = err as { name?: string; message?: string }
    error = { name: e?.name ?? 'Error', message: e?.message ?? 'unknown failure' }
  }

  const crumbs = selector ? [{ label: selector, selector }] : []
  const records = navigation?.records ?? []

  const isSingleBody =
    protocol === 'finger' ||
    (protocol === 'gopher' && records.length === 1 && records[0]?.kind === 'text') ||
    (protocol === 'nntp' && (records.length === 1 && selector.trim().startsWith('<')))

  return (
    <main className="shell">
      <Breadcrumb protocol={protocol} host={host} port={port} crumbs={crumbs} />

      <header className="masthead" style={{ borderBottom: 'none', paddingBottom: 0 }}>
        <p className="wordmark">
          {protocol} · {host}:{port}
        </p>
        <h1 style={{ fontSize: 'clamp(24px, 4vw, 34px)' }}>{selector || '/'}</h1>
      </header>

      {error ? (
        <div className="error">
          {error.name}: {error.message}
          {error.name === 'ForbiddenHostError' ? (
            <p style={{ marginTop: 8 }}>
              Host not in <code>sources.json</code>. Add it there (or set{' '}
              <code>SEANCE_ALLOW_ARBITRARY_HOSTS=true</code>) to browse it.
            </p>
          ) : null}
        </div>
      ) : (
        <RawToggle raw={navigation?.raw ?? ''}>
          {protocol === 'nntp' && !isSingleBody ? (
            selector === '' || selector === '*' ? (
              <GopherMenu records={records} protocol={protocol} host={host} port={port} />
            ) : (
              <ArticleList records={records} protocol={protocol} host={host} port={port} />
            )
          ) : isSingleBody ? (
            <FingerOutput body={navigation?.raw ?? ''} />
          ) : (
            <GopherMenu records={records} protocol={protocol} host={host} port={port} />
          )}
        </RawToggle>
      )}

      <footer className="footer">
        <span>
          {navigation ? `${records.length} records · ${navigation.cached ? 'cache hit' : 'live fetch'}` : 'no data'}
        </span>
        <span>
          <a href="/api/mcp">MCP endpoint</a>
        </span>
      </footer>
    </main>
  )
}