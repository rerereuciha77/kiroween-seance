import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
  cacheGet,
  cachePut,
  cacheEvict,
  cacheClear,
  cacheKey,
  contentHash,
  DEFAULT_TTL_MS,
} from '../src/lib/cache'

const dir = mkdtempSync(path.join(tmpdir(), 'seance-cache-'))
process.env.SEANCE_CACHE_DIR = dir

const base = { protocol: 'gopher' as const, host: 'gopher.floodgap.com', port: 70, selector: '/' }

beforeEach(async () => {
  await cacheClear()
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('cacheKey', () => {
  it('is stable and selector sensitive', () => {
    const a = cacheKey('gopher', 'h', 70, '/')
    const b = cacheKey('gopher', 'h', 70, '/')
    const c = cacheKey('gopher', 'h', 70, '/other')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('cacheGet / cachePut', () => {
  it('misses on an empty cache', async () => {
    expect(await cacheGet(cacheKey(base.protocol, base.host, base.port, base.selector))).toBeNull()
  })

  it('returns a hit inside the TTL', async () => {
    const entry = await cachePut({ ...base, body: 'hello gopher' })
    const hit = await cacheGet(entry.key)
    expect(hit).not.toBeNull()
    expect(hit!.body).toBe('hello gopher')
    expect(hit!.entry.contentHash).toBe(contentHash('hello gopher'))
  })

  it('returns null once the TTL has expired', async () => {
    const entry = await cachePut({ ...base, body: 'stale', ttlMs: 50 })
    const later = Date.now() + 60
    expect(await cacheGet(entry.key, later)).toBeNull()
    expect(entry.ttlMs).toBe(50)
    expect(DEFAULT_TTL_MS).toBeGreaterThan(50)
  })

  it('returns null when the stored body no longer matches its hash', async () => {
    const entry = await cachePut({ ...base, body: 'original' })
    const { writeFile } = await import('fs/promises')
    await writeFile(entry.bodyPath, 'tampered', 'utf8')
    expect(await cacheGet(entry.key)).toBeNull()
  })

  it('stores normalised records alongside the body', async () => {
    const records = [
      { kind: 'menu', selector: '/world', label: 'World', host: base.host, port: 70, mime: 'text/plain', bytes: 0 },
    ]
    const entry = await cachePut({ ...base, body: 'body', records })
    const hit = await cacheGet(entry.key)
    expect(hit!.entry.records).toHaveLength(1)
    expect(hit!.entry.records![0]!.selector).toBe('/world')
  })
})

describe('cacheEvict', () => {
  it('drops the oldest bodies until the cache fits the budget', async () => {
    // Three 400-byte bodies, budget of 900 bytes → one must go.
    const big = 'x'.repeat(400)
    const first = await cachePut({ ...base, selector: '/a', body: big })
    await new Promise(r => setTimeout(r, 5))
    const second = await cachePut({ ...base, selector: '/b', body: big })
    await new Promise(r => setTimeout(r, 5))
    const third = await cachePut({ ...base, selector: '/c', body: big })

    const evicted = await cacheEvict(1000)
    expect(evicted).toBe(1)
    expect(await cacheGet(first.key)).toBeNull() // oldest removed
    expect(await cacheGet(second.key)).not.toBeNull()
    expect(await cacheGet(third.key)).not.toBeNull()
  })

  it('evicts nothing when the cache is already under budget', async () => {
    await cachePut({ ...base, body: 'small' })
    expect(await cacheEvict()).toBe(0)
  })
})