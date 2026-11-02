import { createConnection } from 'net'
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
  
  const parts = data[0].split(' ')
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
 * Execute NNTP commands on a server
 * - Open TCP (with optional STARTTLS via tls.connect)
 * - Send commands sequentially
 * - Parse multi-line .-terminated responses
 * - Return NNTPResult[]
 */
export async function nntpCommand(
  host: string,
  port: number,
  commands: NNTPCommand[],
  opts?: { timeoutMs?: number; tls?: boolean }
): Promise<NNTPResult[]> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const useTls = opts?.tls ?? false
  
  return new Promise((resolve) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (conn) {
        conn.destroy()
      }
      const results: NNTPResult[] = commands.map(cmd => ({
        ok: false as const,
        cmd: cmd.cmd,
        error: new NNTPError(400, `NNTP request to ${host}:${port} timed out after ${timeoutMs}ms`)
      }))
      resolve(results)
    }, timeoutMs)
    
    let conn: any | null = null
    let buffer = ''
    let pendingCommands = [...commands]
    let currentCommand: NNTPCommand | null = null
    let responseLines: string[] = []
    let multiLine = false
    const results: NNTPResult[] = []
    
    function connect() {
      if (useTls) {
        const tls = require('tls')
        conn = tls.connect({ host, port, rejectUnauthorized: false }, () => {
          // Check if server supports STARTTLS
          sendCommand('CAPABILITIES')
        })
      } else {
        conn = require('net').createConnection({ host, port }, () => {
          // Server connection established
          sendCommand('CAPABILITIES')
        })
      }
      
      conn.on('data', (chunk: Buffer) => {
        if (timedOut) return
        
        buffer += chunk.toString('utf8')
        processBuffer()
      })
      
      conn.on('end', () => {
        if (timedOut) return
        clearTimeout(timer)
        resolve(results)
      })
      
      conn.on('error', (err: NodeJS.ErrnoException) => {
        if (timedOut) return
        clearTimeout(timer)
        
        const errorResults: NNTPResult[] = commands.map(cmd => ({
          ok: false as const,
          cmd: cmd.cmd,
          error: new NNTPError(0, `Connection error: ${err.message}`)
        }))
        resolve(errorResults)
      })
    }
    
    function sendCommand(cmd: string) {
      if (conn && conn.writable) {
        conn.write(cmd + '\r\n')
      }
    }
    
    function processBuffer() {
      const lines = buffer.split('\r\n')
      buffer = lines.pop() || ''
      
      for (const line of lines) {
        if (line.length === 0) continue
        
        if (!multiLine) {
          // First line of response
          const [code, continuation, message] = parseResponseLine(line)
          
          if (code === 500) {
            // Command not recognized
            currentCommand = pendingCommands.shift() || { cmd: 'DATE' }
            results.push({
              ok: false as const,
              cmd: currentCommand.cmd,
              error: new NNTPError(code, `Unknown command: ${message}`)
            })
            processNextCommand()
            return
          }
          
          if (!currentCommand) {
            // Response to CAPABILITIES or greeting
            if (useTls && !conn!.secure && message.includes('STARTTLS')) {
              sendCommand('STARTTLS')
            }
            continue
          }
          
          if (!continuation) {
            // Single line response
            let parsedData: unknown = message
            
            switch (currentCommand.cmd) {
              case 'LIST_ACTIVE':
                parsedData = parseListActive([message])
                break
              case 'GROUP':
                parsedData = parseGroup([message])
                break
              case 'OVER':
                parsedData = parseOver([message])
                break
              case 'ARTICLE':
                parsedData = parseArticle([message])
                break
              case 'DATE':
                parsedData = parseDate([message])
                break
            }
            
            const isSuccess = code >= 200 && code < 400
            const resultEntry: NNTPResult = isSuccess
              ? { ok: true as const, cmd: currentCommand.cmd, data: parsedData }
              : { ok: false as const, cmd: currentCommand.cmd, error: new NNTPError(code, `NNTP error: ${message}`) }
            results.push(resultEntry)
            processNextCommand()
            return
          }
          
          // Multi-line response starting
          multiLine = true
          responseLines = [message]
          return
        }
        
        // Inside multi-line response
        if (line === '.') {
          // End of multi-line response
          multiLine = false
          
          let parsedData: unknown = responseLines
          
          switch (currentCommand?.cmd) {
            case 'LIST_ACTIVE':
              parsedData = parseListActive(responseLines)
              break
            case 'GROUP':
              parsedData = parseGroup(responseLines)
              break
            case 'OVER':
              parsedData = parseOver(responseLines)
              break
            case 'ARTICLE':
              parsedData = parseArticle(responseLines)
              break
            case 'DATE':
              parsedData = parseDate(responseLines)
              break
          }
          
          results.push({
            ok: true as const,
            cmd: currentCommand?.cmd as NNTPCommand["cmd"],
            data: parsedData,
          })
          processNextCommand()
          return
        }
        
        responseLines.push(line)
      }
    }
    
    function processNextCommand() {
      if (pendingCommands.length === 0) {
        return
      }
      
      currentCommand = pendingCommands.shift() || null
      if (!currentCommand) return
      
      let cmdString = ''
      switch (currentCommand.cmd) {
        case 'LIST_ACTIVE':
          cmdString = 'LIST ACTIVE'
          break
        case 'GROUP':
          cmdString = `GROUP ${currentCommand.group}`
          break
        case 'OVER':
          cmdString = `OVER ${currentCommand.range}`
          break
        case 'ARTICLE':
          cmdString = `ARTICLE ${currentCommand.id}`
          break
        case 'DATE':
          cmdString = 'DATE'
          break
      }
      
      sendCommand(cmdString)
    }
    
    connect()
  })
}
