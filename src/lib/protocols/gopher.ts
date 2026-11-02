import { createConnection } from 'net'
import { GopherError } from '../errors'
import { Protocol } from '@/types'

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
 * Parse a Gopher menu response into GopherItem[]
 * Handles malformed lines gracefully with kind:"i" fallback
 */
export function parseGopherMenu(data: string, host: string, port: number): GopherItem[] {
  const lines = data.split('\r\n')
  const items: GopherItem[] = []
  
  for (const line of lines) {
    if (line.length === 0) continue
    
    // Try to parse as tab-delimited
    const parts = line.split('\t')
    
    if (parts.length >= 3) {
      const kind = parts[0].charAt(0)
      const label = parts[1] || ''
      const selector = parts[2] || ''
      const hostPart = parts[3] || host
      const portPart = parts[4] ? parseInt(parts[4], 10) : port
      
      items.push({
        kind,
        label,
        selector,
        host: hostPart,
        port: portPart || port,
      })
    } else {
      // Malformed line - treat as info item
      items.push({
        kind: 'i',
        label: line,
        selector: '',
        host,
        port,
      })
    }
  }
  
  return items
}

/**
 * Fetch data from a Gopher server
 * - TCP connect via net.createConnection
 * - Send <selector>\r\n
 * - Read up to maxBytes (default 512 KB)
 * - Detect item-type-1 menus vs plain text
 * - Return GopherResult
 */
export async function gopherFetch(
  host: string,
  port: number,
  selector: string,
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<GopherResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES
  
  return new Promise((resolve) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (conn) {
        conn.destroy()
      }
      resolve({
        ok: false,
        error: new GopherError('timeout', `Gopher request to ${host}:${port} timed out after ${timeoutMs}ms`)
      })
    }, timeoutMs)
    
    let conn: any | null = null
    let buffer = Buffer.alloc(0)
    
    conn = createConnection({ host, port }, () => {
      // Send selector with \r\n
      conn?.write(selector + '\r\n')
    })
    
    conn.on('data', (chunk: Buffer) => {
      if (timedOut) return
      
      const newLength = buffer.length + chunk.length
      if (newLength > maxBytes) {
        clearTimeout(timer)
        conn?.destroy()
        resolve({
          ok: false,
          error: new GopherError('toobig', `Response exceeds maximum size of ${maxBytes} bytes`)
        })
        return
      }
      
      buffer = Buffer.concat([buffer, chunk])
      
      // Check if we have a complete response (ends with \r\n)
      if (buffer.length >= 2) {
        const lastTwo = buffer.slice(-2)
        if (lastTwo[0] === 0x0d && lastTwo[1] === 0x0a) {
          // Complete response received
          clearTimeout(timer)
          conn?.end()
        }
      }
    })
    
    conn.on('end', () => {
      if (timedOut) return
      clearTimeout(timer)
      
      const data = buffer.toString('utf8')
      
      // Detect if this is a menu (type 1) or plain text
      // Menu starts with first item type, text files don't have item type prefix
      const firstNonEmptyLine = data.split('\r\n').find(line => line.length > 0)
      
      if (firstNonEmptyLine && firstNonEmptyLine.length > 0) {
        const firstChar = firstNonEmptyLine.charAt(0)
        if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'g', 'I', 'T'].includes(firstChar)) {
          // This looks like a Gopher menu
          const items = parseGopherMenu(data, host, port)
          resolve({ ok: true, type: 'menu', items })
        } else {
          // Plain text file
          resolve({ ok: true, type: 'text', body: data })
        }
      } else {
        resolve({ ok: true, type: 'text', body: data })
      }
    })
    
    conn.on('error', (err: NodeJS.ErrnoException) => {
      if (timedOut) return
      clearTimeout(timer)
      
      if (err.code === 'ECONNREFUSED') {
        resolve({
          ok: false,
          error: new GopherError('refused', `Connection refused to ${host}:${port}`)
        })
      } else {
        resolve({
          ok: false,
          error: new GopherError('parse', `Connection error: ${err.message}`)
        })
      }
    })
  })
}
