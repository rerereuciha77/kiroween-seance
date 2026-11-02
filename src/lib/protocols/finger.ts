import { createConnection } from 'net'
import { FingerError } from '../errors'

export type FingerResult =
  | { ok: true;  body: string }
  | { ok: false; error: FingerError }

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MAX_BYTES = 64 * 1024 // 64 KB

/**
 * Fetch finger data from a finger server
 * - TCP connect on port 79
 * - Send /W <user>\r\n
 * - Read up to maxBytes (default 64 KB)
 * - Return FingerResult
 */
export async function fingerFetch(
  host: string,
  port: number,
  user: string,
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<FingerResult> {
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
        error: new FingerError('timeout', `Finger request to ${host}:${port} timed out after ${timeoutMs}ms`)
      })
    }, timeoutMs)
    
    let conn: any = null
    let buffer = Buffer.alloc(0)
    
    conn = createConnection({ host, port }, () => {
      // Send /W <user>\r\n
      conn.write(`/W ${user}\r\n`)
    })
    
    conn.on('data', (chunk: Buffer) => {
      if (timedOut) return
      
      const newLength = buffer.length + chunk.length
      if (newLength > maxBytes) {
        clearTimeout(timer)
        conn.destroy()
        resolve({
          ok: false,
          error: new FingerError('toobig', `Response exceeds maximum size of ${maxBytes} bytes`)
        })
        return
      }
      
      buffer = Buffer.concat([buffer, chunk])
      
      // Check if we have a complete response
      if (buffer.length >= 2) {
        const lastTwo = buffer.slice(-2)
        if (lastTwo[0] === 0x0d && lastTwo[1] === 0x0a) {
          // Complete response received
          clearTimeout(timer)
          conn.end()
        }
      }
    })
    
    conn.on('end', () => {
      if (timedOut) return
      clearTimeout(timer)
      
      const data = buffer.toString('utf8')
      resolve({ ok: true, body: data })
    })
    
    conn.on('error', (err) => {
      if (timedOut) return
      clearTimeout(timer)
      
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        resolve({
          ok: false,
          error: new FingerError('refused', `Connection refused to ${host}:${port}`)
        })
      } else {
        resolve({
          ok: false,
          error: new FingerError('toobig', `Connection error: ${(err as Error).message}`)
        })
      }
    })
  })
}
