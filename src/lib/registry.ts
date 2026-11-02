import { readFileSync } from 'fs'
import { Protocol, Source } from '@/types'

/**
 * Reads sources.json from the repo root and validates its schema.
 * Throws on invalid JSON or schema errors.
 */
export function loadRegistry(path?: string): Source[] {
  const sourcesPath = path ?? process.env.SEANCE_REGISTRY_PATH ?? './sources.json'
  
  let content: string
  try {
    content = readFileSync(sourcesPath, 'utf8')
  } catch (err) {
    throw new Error(`Failed to read sources.json at ${sourcesPath}: ${(err as Error).message}`)
  }
  
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch (err) {
    throw new Error(`sources.json is not valid JSON: ${(err as Error).message}`)
  }
  
  if (!Array.isArray(data)) {
    throw new Error('sources.json must be an array of sources')
  }
  
  const sources: Source[] = []
  for (let i = 0; i < data.length; i++) {
    const item = data[i]
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Source at index ${i} is not an object`)
    }
    
    const { id, protocol, host, port, description } = item as Record<string, unknown>
    
    if (typeof id !== 'string') {
      throw new Error(`Source at index ${i}: 'id' must be a string`)
    }
    if (protocol !== 'gopher' && protocol !== 'nntp' && protocol !== 'finger') {
      throw new Error(`Source at index ${i} ('${id}'): 'protocol' must be 'gopher', 'nntp', or 'finger'`)
    }
    if (typeof host !== 'string' || host.length === 0) {
      throw new Error(`Source at index ${i} ('${id}'): 'host' must be a non-empty string`)
    }
    if (typeof port !== 'number' || port <= 0 || port > 65535) {
      throw new Error(`Source at index ${i} ('${id}'): 'port' must be a valid port number (1-65535)`)
    }
    if (typeof description !== 'string') {
      throw new Error(`Source at index ${i} ('${id}'): 'description' must be a string`)
    }
    
    sources.push({
      id,
      protocol: protocol as Protocol,
      host,
      port,
      description,
    })
  }
  
  return sources
}

/**
 * Checks if a host:port combination is in the allow-list.
 * If SEANCE_ALLOW_ARBITRARY_HOSTS=true, always returns true with a warning.
 */
export function isAllowed(host: string, port: number): boolean {
  const allowArbitrary = process.env.SEANCE_ALLOW_ARBITRARY_HOSTS === 'true'
  if (allowArbitrary) {
    console.warn('SEANCE_ALLOW_ARBITRARY_HOSTS=true: skipping allow-list check')
    return true
  }
  
  const sources = loadRegistry()
  return sources.some(s => s.host === host && s.port === port)
}
