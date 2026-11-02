import { gopherFetch, GopherResult } from './protocols/gopher'
import { nntpCommand, NNTPCommand, NNTPResult } from './protocols/nntp'
import { fingerFetch, FingerResult } from './protocols/finger'
import { isAllowed, loadRegistry } from './registry'
import { normaliseGopher } from './normaliser'
import { NormalisedRecord, SeanceSession, Protocol } from '@/types'
import { ForbiddenHostError } from './errors'

export async function seanceNavigate(
  session: SeanceSession,
  selector: string
): Promise<{ records: NormalisedRecord[]; raw: string; updatedSession: SeanceSession }> {
  const { protocol, host, port } = session
  
  // Check if host is allowed
  if (!isAllowed(host, port)) {
    throw new ForbiddenHostError(host, port)
  }
  
  // Generate cache key
  const crypto = require('crypto')
  const cacheKey = crypto.createHash('sha256').update(`${protocol}:${host}:${port}:${selector}`).digest('hex')
  
  // Check cache (for now, we'll return miss and fetch)
  // In a full implementation, cacheGet would be called here
  
  // Call the appropriate protocol client
  let result: GopherResult | NNTPResult[] | FingerResult
  
  switch (protocol) {
    case 'gopher':
      result = await gopherFetch(host, port, selector)
      break
    case 'nntp':
      // For NNTP, we need to construct a command
      const commands: NNTPCommand[] = [
        { cmd: 'ARTICLE', id: selector }
      ]
      result = await nntpCommand(host, port, commands)
      break
    case 'finger':
      result = await fingerFetch(host, port, selector)
      break
    default:
      throw new Error(`Unsupported protocol: ${protocol}`)
  }
  
  let records: NormalisedRecord[] = []
  let raw = ''
  
  if (protocol === 'gopher') {
    const gopherResult = result as GopherResult
    if (gopherResult.ok) {
      if (gopherResult.type === 'menu') {
        records = normaliseGopher(gopherResult.items, host, port)
      } else {
        // For text type, create a single record
        records = [{
          kind: 'text',
          selector,
          label: `Text: ${selector}`,
          host,
          port,
          mime: 'text/plain',
          bytes: gopherResult.body.length,
        }]
      }
      raw = gopherResult.type === 'menu' 
        ? gopherResult.items.map(item => `${item.kind}\t${item.label}\t${item.selector}\t${item.host}\t${item.port}`).join('\r\n') + '\r\n.\r\n'
        : gopherResult.body
    } else {
      throw gopherResult.error
    }
  } else if (protocol === 'finger') {
    const fingerResult = result as FingerResult
    if (fingerResult.ok) {
      records = [{
        kind: 'finger',
        selector,
        label: `Finger: ${selector}`,
        host,
        port,
        mime: 'text/plain',
        bytes: fingerResult.body.length,
      }]
      raw = fingerResult.body
    } else {
      throw fingerResult.error
    }
  } else if (protocol === 'nntp') {
    const nntpResult = result as NNTPResult[]
    // For now, just pass through - in full implementation, we'd parse NNTP response
    records = [{
      kind: 'article',
      selector,
      label: `NNTP Article: ${selector}`,
      host,
      port,
      mime: 'message/rfc822',
      bytes: 0,
    }]
    raw = JSON.stringify(nntpResult)
  }
  
  // Write to cache (for now, no-op)
  // In full implementation, cachePut would be called here
  
  // Update session breadcrumb
  const newBreadcrumb = [...session.breadcrumb, selector]
  const updatedSession: SeanceSession = {
    ...session,
    breadcrumb: newBreadcrumb,
  }
  
  return { records, raw, updatedSession }
}
