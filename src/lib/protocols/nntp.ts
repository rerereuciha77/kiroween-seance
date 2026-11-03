import { createConnection, Socket } from 'net'
import { connect as tlsConnect } from 'tls'
import { NNTPError } from '../errors'

export type NNTPCommand =
  | { cmd: "LIST_ACTIVE" }
  | { cmd: "GROUP"; group: string }
  | { cmd: "OVER"; range: string }
  | { cmd: "ARTICLE"; id: string }
  | { cmd: "DATE" }

export type NNTPResult =
  | { ok: true;  cmd: NNTPCommand["cmd"]; data: unknown }
  | { ok: false; cmd: NNTPCommand["cmd"]; error: NNTPError }

const DEFAULT_TIMEOUT_MS = 15000

/**
 * Parse NNTP response line
 * Returns [code, continuation, message]
 */
function parseResponseLine(line: string): [number, boolean, string] {
  const parts = line.split(' ', 3)
  const code = parseInt(parts[0], 10)
  const continuation = line.length > parts[0].length + 1 && line.charAt(parts[0].length + 1) === '-'
  const message = parts.slice(1).join(' ')
  
  return [code, continuation, message]
}

/**
 * Parse multi-line NNTP response
 * Handles .-terminated responses (RFC 3977)
 */
function parseMultiLineResponse(lines: string[]): { code: number; data: string[] } {
  // Remove the final "." line
  const dataLines = lines.slice(0, -1)
  const firstLine = lines[0]
  const [code] = parseResponseLine(firstLine)
  
  return { code, data: dataLines }
}

/**
 * Parse LIST ACTIVE response
 * Format: group high low flags
 */
export function parseListActive(data: string[]): Array<{ group: string; high: number; low: number; flags: string }> {
  const result: Array<{ group: string; high: number; low: number; flags: string }> = []
  
  for (const line of data) {
    const parts = line.split(' ')
    if (parts.length >= 4) {
      result.push({
        group: parts[0],
        high: parseInt(parts[1], 10),
        low: parseInt(parts[2], 10),
        flags: parts[3],
      })
    }
  }
  
  return result
}

/**
 * Parse GROUP response
 * Format: count first last group
 */
export function parseGroup(data: string[]): { count: number; first: number; last: number; group: string } | null {
  if (data.length === 0) return null

  // A raw GROUP status line is "211 <count> <first> <last> <group>"; callers
  // sometimes pass the payload without the 3-digit code, so drop it first.
  let line = data[0]
  if (/^\d{3} /.test(line)) line = line.slice(4)
  const parts = line.trim().split(/\s+/)
  if (parts.length >= 4) {
    return {
      count: parseInt(parts[0], 10),
      first: parseInt(parts[1], 10),
      last: parseInt(parts[2], 10),
      group: parts[3],
    }
  }
  return null
}

/**
 * Parse OVER response
 * Format: num <tab> subject <tab> from <tab> date <tab> id <tab> ref... [optional fields]
 */
export function parseOver(data: string[]): Array<{
  number: number;
  subject: string;
  from: string;
  date: string;
  messageId: string;
  references: string;
  bytes: number;
  lines: number;
  extra?: Record<string, string>;
}> {
  const result: Array<{ number: number; subject: string; from: string; date: string; messageId: string; references: string; bytes: number; lines: number; extra?: Record<string, string> }> = []
  
  for (const line of data) {
    const parts = line.split('\t')
    if (parts.length >= 8) {
      result.push({
        number: parseInt(parts[0], 10),
        subject: parts[1],
        from: parts[2],
        date: parts[3],
        messageId: parts[4],
        references: parts[5],
        bytes: parseInt(parts[6], 10),
        lines: parseInt(parts[7], 10),
        extra: parts.slice(8).reduce((acc, val, i) => ({ ...acc, [`field${i}`]: val }), {}),
      })
    }
  }
  
  return result
}

/**
 * Parse ARTICLE response
 */
export function parseArticle(data: string[]): { header: string; body: string } {
  // Find the blank line separating header from body
  let blankLineIndex = -1
  for (let i = 0; i < data.length; i++) {
    if (data[i].trim() === '') {
      blankLineIndex = i
      break
    }
  }
  
  if (blankLineIndex === -1) {
    return { header: data.join('\n'), body: '' }
  }
  
  const header = data.slice(0, blankLineIndex).join('\n')
  const body = data.slice(blankLineIndex + 1).join('\n')
  
  return { header, body }
}

/**
 * Parse DATE response
 * Format: yymmddhhmmss
 */
export function parseDate(data: string[]): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  if (data.length === 0) return null
  
  const dateStr = data[0]
  if (dateStr.length >= 14) {
    const year = parseInt(dateStr.substring(0, 4), 10)
    const month = parseInt(dateStr.substring(4, 6), 10)
    const day = parseInt(dateStr.substring(6, 8), 10)
    const hour = parseInt(dateStr.substring(8, 10), 10)
    const minute = parseInt(dateStr.substring(10, 12), 10)
    const second = parseInt(dateStr.substring(12, 14), 10)
    
    return { year, month, day, hour, minute, second }
  }
  return null
}

/**
 * Execute NNTP commands on a server, sequentially, over one connection.
 * Returns one NNTPResult per command; never throws — transport failures are
 * reported as ok:false so callers can still render partial results.
 */

/** Buffered line reader over a socket (NNTP is strictly line oriented). */
class LineReader {
  private buffer = ''
  private queue: string[] = []
  private waiters: Array<{ resolve: (line: string) => void; reject: (err: Error) => void }> = []
  private failure: Error | null = null

  constructor(sock: Socket) {
    sock.setEncoding('latin1')
    sock.on('data', (chunk: string) => {
      this.buffer += chunk
      let idx: number
      while ((idx = this.buffer.indexOf('\r\n')) !== -1) {
        const line = this.buffer.slice(0, idx)
        this.buffer = this.buffer.slice(idx + 2)
        const waiter = this.waiters.shift()
        if (waiter) waiter.resolve(line)
        else this.queue.push(line)
      }
    })
    sock.on('error', (err: Error) => this.fail(err))
    sock.on('close', () => this.fail(new NNTPError(0, 'connection closed by server')))
  }

  private fail(err: Error) {
    if (this.failure) return
    this.failure = err
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      waiter.reject(err)
    }
  }

  readLine(deadlineMs: number): Promise<string> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift()!)
    if (this.failure) return Promise.reject(this.failure)

    return new Promise<string>((resolve, reject) => {
      const wrappedResolve = (line: string) => {
        clearTimeout(timer)
        resolve(line)
      }
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex(w => w.resolve === wrappedResolve)
        if (idx >= 0) this.waiters.splice(idx, 1)
        reject(new NNTPError(0, 'read timed out'))
      }, deadlineMs)

      this.waiters.push({
        resolve: wrappedResolve,
        reject: (e: Error) => { clearTimeout(timer); reject(e) },
      })
    })
  }
}

/** Read a dot-terminated block, undoing RFC 3977 dot-stuffing. */
async function readDotBlock(reader: LineReader, deadlineMs: number): Promise<string[]> {
  const lines: string[] = []
  for (;;) {
    const line = await reader.readLine(deadlineMs)
    if (line === '.') return lines
    lines.push(line.startsWith('..') ? line.slice(1) : line)
  }
}

function wireCommand(cmd: NNTPCommand): string {
  switch (cmd.cmd) {
    case 'LIST_ACTIVE': return 'LIST ACTIVE'
    case 'GROUP': return `GROUP ${cmd.group}`
    case 'OVER': return `OVER ${cmd.range}`
    case 'ARTICLE': return `ARTICLE ${cmd.id}`
    case 'DATE': return 'DATE'
  }
}

function isMultiline(cmd: NNTPCommand, code: number): boolean {
  if (cmd.cmd === 'LIST_ACTIVE' && code === 215) return true
  if (cmd.cmd === 'OVER' && code === 224) return true
  if (cmd.cmd === 'ARTICLE' && (code === 220 || code === 221 || code === 222)) return true
  return false
}

function parsePayload(cmd: NNTPCommand, lines: string[]): unknown {
  switch (cmd.cmd) {
    case 'LIST_ACTIVE': return parseListActive(lines)
    case 'GROUP': return parseGroup(lines)
    case 'OVER': return parseOver(lines)
    case 'ARTICLE': return parseArticle(lines)
    case 'DATE': return parseDate(lines)
  }
}

export async function nntpCommand(
  host: string,
  port: number,
  commands: NNTPCommand[],
  opts?: { timeoutMs?: number; tls?: boolean }
): Promise<NNTPResult[]> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const useTls = opts?.tls ?? false
  const results: NNTPResult[] = []
  let sock: Socket | null = null

  try {
    sock = await new Promise<Socket>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new NNTPError(0, `connect to ${host}:${port} timed out`)),
        timeoutMs
      )
      let s: Socket
      const onConnect = () => { clearTimeout(timer); resolve(s) }
      s = useTls
        ? tlsConnect({ host, port, rejectUnauthorized: false, servername: host }, onConnect)
        : createConnection({ host, port }, onConnect)
      s.once('error', (err: Error) => {
        clearTimeout(timer)
        reject(new NNTPError(0, `connect failed: ${err.message}`))
      })
    })

    const reader = new LineReader(sock)

    // Greeting: 200 = posting allowed, 201 = no posting. Either means ready.
    const greeting = await reader.readLine(timeoutMs)
    const greetingCode = parseInt(greeting.slice(0, 3), 10)
    if (greetingCode !== 200 && greetingCode !== 201) {
      throw new NNTPError(greetingCode, `unexpected greeting: ${greeting}`)
    }

    for (const cmd of commands) {
      sock.write(`${wireCommand(cmd)}\r\n`)
      const status = await reader.readLine(timeoutMs)
      const code = parseInt(status.slice(0, 3), 10)

      if (Number.isNaN(code)) {
        results.push({ ok: false, cmd: cmd.cmd, error: new NNTPError(0, `malformed status line: ${status}`) })
        continue
      }
      if (code >= 400) {
        results.push({ ok: false, cmd: cmd.cmd, error: new NNTPError(code, status.slice(4)) })
        continue
      }

      if (isMultiline(cmd, code)) {
        const lines = await readDotBlock(reader, timeoutMs)
        results.push({ ok: true, cmd: cmd.cmd, data: parsePayload(cmd, lines) })
      } else {
        results.push({ ok: true, cmd: cmd.cmd, data: parsePayload(cmd, [status]) })
      }
    }

    return results
  } catch (err) {
    const error = err instanceof NNTPError ? err : new NNTPError(0, (err as Error).message)
    for (const cmd of commands.slice(results.length)) {
      results.push({ ok: false, cmd: cmd.cmd, error })
    }
    return results
  } finally {
    if (sock) sock.destroy()
  }
}