import { createHash } from 'crypto'
import { mkdir, readFile, writeFile, rename, readdir, unlink, stat } from 'fs/promises'
import path from 'path'
import { CacheEntry, NormalisedRecord, Protocol } from '@/types'

export const DEFAULT_TTL_MS = 10 * 60 * 1000 // 10 minutes
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 // 8 MB

/** Directory holding the cache index and body files. */
export function cacheDir(): string {
  return process.env.SEANCE_CACHE_DIR ?? path.join(process.cwd(), '.seance-cache')
}

function indexPath(): string {
  return path.join(cacheDir(), 'index.json')
}

/** Stable cache key: sha256 over protocol + host + port + selector. */
export function cacheKey(protocol: Protocol, host: string, port: number, selector: string): string {
  return createHash('sha256').update(`${protocol}:${host}:${port}:${selector}`).digest('hex')
}

/** sha256 of a body, used to detect on-disk corruption. */
export function contentHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

async function ensureDir(): Promise<void> {
  await mkdir(cacheDir(), { recursive: true })
}

async function loadIndex(): Promise<CacheEntry[]> {
  try {
    const raw = await readFile(indexPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is CacheEntry =>
      typeof e === 'object' && e !== null && typeof (e as CacheEntry).key === 'string'
    )
  } catch {
    // Missing or corrupt index: treat as empty cache rather than failing.
    return []
  }
}

async function saveIndex(entries: CacheEntry[]): Promise<void> {
  await ensureDir()
  const target = indexPath()
  const tmp = `${target}.tmp`
  await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8')
  await rename(tmp, target) // atomic swap
}

export interface CacheHit {
  entry: CacheEntry
  body: string
}

/**
 * Read a cache entry. Returns null on miss, expiry, missing body file or a
 * content-hash mismatch (corruption).
 */
export async function cacheGet(key: string, now = Date.now()): Promise<CacheHit | null> {
  const entries = await loadIndex()
  const entry = entries.find(e => e.key === key)
  if (!entry) return null

  if (now - entry.createdAt > entry.ttlMs) return null

  try {
    const body = await readFile(entry.bodyPath, 'utf8')
    if (contentHash(body) !== entry.contentHash) return null
    return { entry, body }
  } catch {
    return null
  }
}

export interface CachePutInput {
  protocol: Protocol
  host: string
  port: number
  selector: string
  body: string
  records?: NormalisedRecord[]
  ttlMs?: number
}

/** Write a body + index entry, then evict if the cache exceeds its budget. */
export async function cachePut(input: CachePutInput, maxBytes = DEFAULT_MAX_BYTES): Promise<CacheEntry> {
  await ensureDir()
  const key = cacheKey(input.protocol, input.host, input.port, input.selector)
  const bodyPath = path.join(cacheDir(), `${key}.body`)
  const tmp = `${bodyPath}.tmp`
  await writeFile(tmp, input.body, 'utf8')
  await rename(tmp, bodyPath)

  const entry: CacheEntry = {
    key,
    protocol: input.protocol,
    host: input.host,
    selector: input.selector,
    createdAt: Date.now(),
    ttlMs: input.ttlMs ?? DEFAULT_TTL_MS,
    contentHash: contentHash(input.body),
    bodyPath,
    records: input.records,
  }

  const entries = (await loadIndex()).filter(e => e.key !== key)
  entries.push(entry)
  await saveIndex(entries)
  await cacheEvict(maxBytes)
  return entry
}

/**
 * Drop oldest bodies until the cache directory is under `maxBytes`.
 * Returns the number of evicted entries.
 */
export async function cacheEvict(maxBytes = DEFAULT_MAX_BYTES): Promise<number> {
  const entries = await loadIndex()
  if (entries.length === 0) return 0

  const sized = await Promise.all(
    entries.map(async e => {
      try {
        const s = await stat(e.bodyPath)
        return { entry: e, size: s.size }
      } catch {
        return { entry: e, size: 0 }
      }
    })
  )

  let total = sized.reduce((acc, s) => acc + s.size, 0)
  if (total <= maxBytes) return 0

  let evicted = 0
  const kept: CacheEntry[] = []
  for (const { entry, size } of [...sized].sort((a, b) => a.entry.createdAt - b.entry.createdAt)) {
    if (total > maxBytes) {
      try {
        await unlink(entry.bodyPath)
      } catch {
        // Body already gone — nothing to delete.
      }
      total -= size
      evicted++
    } else {
      kept.push(entry)
    }
  }

  // Preserve the original (newest-last) ordering for the survivors.
  const keptKeys = new Set(kept.map(e => e.key))
  await saveIndex(entries.filter(e => keptKeys.has(e.key)))
  return evicted
}

/** Test helper: remove every cached body and the index. */
export async function cacheClear(): Promise<void> {
  const dir = cacheDir()
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  await Promise.all(
    names
      .filter(n => n.endsWith('.body') || n === 'index.json')
      .map(n => unlink(path.join(dir, n)).catch(() => undefined))
  )
}