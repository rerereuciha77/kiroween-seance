import { NormalisedRecord } from '@/types'
import { GopherItem } from './protocols/gopher'

/**
 * Normalise Gopher items into NormalisedRecord[]
 * Must be total — no input should cause it to throw
 */
export function normaliseGopher(
  items: GopherItem[],
  host: string,
  port: number
): NormalisedRecord[] {
  try {
    return items.map((item) => {
      // Map Gopher type to MIME type
      const mimeMap: Record<string, string> = {
        '0': 'text/plain',
        '1': 'text/plain',  // menu
        '2': 'text/plain',
        '3': 'text/html',
        '4': 'text/plain',  // CSO/Phonebook
        '5': 'text/plain',
        '6': 'text/plain',
        '7': 'text/plain',  // search
        '8': 'text/plain',
        '9': 'application/binary',
        'g': 'image/gif',
        'I': 'image/unknown',
        'T': 'text/tn3270',
      }
      
      const kind = item.kind
      const mime = mimeMap[kind] || 'text/plain'
      
      // Determine kind category for UI
      // RFC 1436: type 1 is a menu, type 7 is a search endpoint (also
      // navigable), type 0 and the binary/image types are documents,
      // type 'i' carries informational text only.
      let categoryKind = 'info'
      if (kind === '1' || kind === '7') {
        categoryKind = 'menu'
      } else if (kind === '0' || kind === '2' || kind === '3' || kind === '4' || kind === '5' || kind === '6' || kind === '8' || kind === '9' || kind === 'g' || kind === 'I' || kind === 'T' || kind === 'h') {
        categoryKind = 'text'
      }
      
      return {
        kind: categoryKind,
        selector: item.selector,
        label: item.label,
        host,
        port,
        mime,
        bytes: 0,
      }
    })
  } catch {
    // Fallback in case of any unexpected error
    return []
  }
}

/**
 * Normalise NNTP results into NormalisedRecord[]
 * Must be total — no input should cause it to throw
 */
export function normaliseNNTP(
  result: unknown,
  host: string
): NormalisedRecord[] {
  try {
    // Handle different NNTP response formats
    if (Array.isArray(result)) {
      // Could be OVER/XOVER results
      const records: NormalisedRecord[] = []
      for (const item of result as any[]) {
        if (item && typeof item === 'object') {
          const messageId = item.messageId || item.message_id || item['Message-ID'] || ''
          const subject = item.subject || item.Subject || ''
          const from = item.from || item.From || ''
          
          records.push({
            kind: 'article',
            selector: messageId,
            label: subject || 'No subject',
            host,
            port: 119,
            mime: 'message/rfc822',
            bytes: item.bytes || 0,
          })
        }
      }
      return records
    }
    
    // Fallback
    return []
  } catch {
    return []
  }
}

/**
 * Normalise finger output into NormalisedRecord[]
 * Must be total — no input should cause it to throw
 */
export function normaliseFinger(
  body: string,
  host: string,
  user: string
): NormalisedRecord[] {
  try {
    // Finger output is typically text, but we create a single record
    return [{
      kind: 'finger',
      selector: user,
      label: `Finger output for ${user}`,
      host,
      port: 79,
      mime: 'text/plain',
      bytes: body.length,
    }]
  } catch {
    return []
  }
}
