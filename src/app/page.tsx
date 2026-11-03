import Link from 'next/link'
import { loadRegistry } from '@/lib/registry'
import { Source } from '@/types'

export const dynamic = 'force-dynamic'

const START_SELECTOR: Record<Source['protocol'], string> = {
  gopher: '/',
  nntp: '*',
  finger: '',
}

function badgeClass(protocol: Source['protocol']): string {
  if (protocol === 'nntp') return 'badge badge-nntp'
  if (protocol === 'finger') return 'badge badge-finger'
  return 'badge'
}

export default function HomePage() {
  const sources: Source[] = loadRegistry()

  return (
    <main className="shell">
      <header className="masthead">
        <p className="wordmark">Gopher · Usenet · Finger</p>
        <h1>
          SÉANCE<span className="blink">_</span>
        </h1>
        <p>
          A gateway for agents into the machine-readable internet that never died. Three protocols, one
          normalised record, five MCP tools. No database — just a file cache and a phone line that still
          answers.
        </p>
      </header>

      <section className="section">
        <p className="section-label">allow-listed sources</p>
        <div className="sources">
          {sources.map(source => (
            <Link
              key={source.id}
              className="source"
              href={`/browse/${source.protocol}/${source.host}?port=${source.port}&s=${encodeURIComponent(
                START_SELECTOR[source.protocol]
              )}`}
            >
              <div className="source-top">
                <span className={badgeClass(source.protocol)}>{source.protocol}</span>
                <span className="source-host">{source.host}</span>
                <span className="source-port">:{source.port}</span>
              </div>
              <p className="source-desc">{source.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <p className="section-label">agent surface</p>
        <div className="mcp">
          <code>POST /api/mcp</code>
          <p>
            Streamable HTTP MCP endpoint (stateless, JSON responses). Tools: <code>seance_list_sources</code>,{' '}
            <code>seance_browse</code>, <code>seance_read</code>, <code>seance_search_usenet</code>,{' '}
            <code>seance_finger</code>. Point any MCP client at this URL — no key, no session, no handshake
            beyond the protocol itself.
          </p>
        </div>
      </section>

      <footer className="footer">
        <span>SÉANCE · selective archive of electronic news and archives</span>
        <span>MIT · built with Kiro</span>
      </footer>
    </main>
  )
}