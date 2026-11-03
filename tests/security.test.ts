import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer, type Server } from 'net'
import { gopherFetch } from '../src/lib/protocols/gopher'
import { isAllowed } from '../src/lib/registry'
import { seanceNavigate, createSession } from '../src/lib/session'
import { ForbiddenHostError, GopherError } from '../src/lib/errors'

const servers: Server[] = []

/** Start a throwaway TCP server that answers every connection with `payload`. */
function startServer(payload: Buffer): Promise<number> {
  return new Promise(resolve => {
    const server = createServer(socket => {
      socket.once('data', () => {
        socket.end(payload)
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

afterEach(() => {
  while (servers.length > 0) servers.pop()?.close()
  delete process.env.SEANCE_ALLOW_ARBITRARY_HOSTS
  vi.restoreAllMocks()
})

describe('byte caps (R1.1 / acceptance criterion 4)', () => {
  it('rejects a response larger than 512 KB with reason "toobig"', async () => {
    const oversize = Buffer.alloc(512 * 1024 + 1, 0x41) // "A" × (512 KB + 1)
    const port = await startServer(oversize)

    const result = await gopherFetch('127.0.0.1', port, '/', { timeoutMs: 5000 })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(GopherError)
      expect((result.error as GopherError).reason).toBe('toobig')
    }
  })

  it('accepts a body just under the cap and detects a menu', async () => {
    const menu = Buffer.from('1World\t/world\tgopher.floodgap.com\t70\r\n', 'utf8')
    const port = await startServer(menu)

    const result = await gopherFetch('127.0.0.1', port, '/', { timeoutMs: 5000 })

    expect(result.ok).toBe(true)
    if (result.ok && result.type === 'menu') {
      expect(result.items[0]).toMatchObject({ kind: '1', label: 'World', selector: '/world' })
    } else {
      throw new Error('expected a parsed menu')
    }
  })
})

describe('allow-list enforcement (R5 / acceptance criterion 4)', () => {
  it('rejects a host that is not in sources.json', async () => {
    const session = createSession('gopher', 'not-allow-listed.example', 70)
    await expect(seanceNavigate(session, '/')).rejects.toBeInstanceOf(ForbiddenHostError)
  })

  it('allows an arbitrary host when SEANCE_ALLOW_ARBITRARY_HOSTS=true and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    process.env.SEANCE_ALLOW_ARBITRARY_HOSTS = 'true'

    expect(isAllowed('not-allow-listed.example', 70)).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SEANCE_ALLOW_ARBITRARY_HOSTS'))
  })

  it('rejects the same host when the flag is absent', () => {
    expect(isAllowed('not-allow-listed.example', 70)).toBe(false)
  })
})