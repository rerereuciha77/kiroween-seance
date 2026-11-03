import { createConnection } from 'net'
import { GopherError } from '../errors'

export interface GopherItem {
  kind: string;   // raw item-type char: "0" "1" "7" "i" …
  label: string;
  selector: string;
  host: string;
  port: number;
}

export type GopherResult =
  | { ok: true;  type: "menu";   items: GopherItem[] }
  | { ok: true;  type: "text";   body: string }
  | { ok: false; error: GopherError }

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_MAX_BYTES = 512 * 1024 // 512 KB

/**
 * Parse a Gopher menu (RFC 1436 item lines) into GopherItem[].
 *
 * A line is `<type><display>\t<selector>\t<host>\t<port>`; because the type
 * char is glued to the display string, `parts[0].slice(1)` is the label.
 * Malformed lines degrade to an informational item instead of throwing.
 */
export function parseGopherMenu(data: string, host: string, port: number): GopherItem[] {
  const items: GopherItem[] = []

  for (const rawLine of data.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '')
    if (line.length === 0) continue

    const parts = line.split('\t')

    if (parts.length >= 2) {
      const head = parts[0] ?? ''
      const kind = head.charAt(0) || 'i'
      const label = head.slice(1)
      const selector = parts[1] ?? ''
      const itemHost = parts[2]?.trim() || host
      const parsedPort = parts[3] ? parseInt(parts[3], 10) : port

      items.push({
        kind,
        label: label || selector || '(untitled)',
        selector,
        host: itemHost,
        port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : port,
      })
    } else {
      items.push({ kind: 'i', label: line, selector: '', host, port })
    }
  }

  return items
}

/** A gopher menu line starts with a type char followed by a label and a tab. */
function looksLikeMenu(data: string): boolean {
  const firstLine = data.split(/\r?\n/).find(l => l.trim().length > 0)
  if (!firstLine) return false
  if (!firstLine.includes('\t')) return false
  const type = firstLine.charAt(0)
  return /[0-9+\-gIThis;]/.test(type)
}

/**
 * Fetch one Gopher selector.
 * - TCP connect, send `<selector>\r\n`, read until the server closes
 * - Cap the body at `maxBytes` (default 512 KB) with a `toobig` error
 * - Menus are parsed into items, everything else is returned as text
 */
export async function gopherFetch(
  host: string,
  port: number,
  selector: string,
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<GopherResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES

  return new Promise<GopherResult>((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const chunks: Buffer[] = []
    let received = 0

    const settle = (result: GopherResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      conn.destroy()
      resolve(result)
    }

    const conn = createConnection({ host, port }, () => {
      conn.write(`${selector}\r\n`)
    })

    timer = setTimeout(
      () => settle({ ok: false, error: new GopherError('timeout', `Gopher request to ${host}:${port} timed out after ${timeoutMs}ms`) }),
      timeoutMs
    )

    conn.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > maxBytes) {
        settle({ ok: false, error: new GopherError('toobig', `Response exceeds maximum size of ${maxBytes} bytes`) })
        return
      }
      chunks.push(chunk)
    })

    const finish = () => {
      const data = Buffer.concat(chunks).toString('utf8')
      if (looksLikeMenu(data)) {
        settle({ ok: true, type: 'menu', items: parseGopherMenu(data, host, port) })
      } else {
        settle({ ok: true, type: 'text', body: data })
      }
    }

    conn.on('end', finish)
    conn.on('close', finish)

    conn.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        settle({ ok: false, error: new GopherError('refused', `Connection refused to ${host}:${port}`) })
      } else {
        settle({ ok: false, error: new GopherError('parse', `Connection error: ${err.message}`) })
      }
    })
  })
}