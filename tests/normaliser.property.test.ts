import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { normaliseGopher, normaliseNNTP, normaliseFinger } from '../src/lib/normaliser'
import type { GopherItem } from '../src/lib/protocols/gopher'

const KINDS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'g', 'I', 'T', 'i', 'h', '+', '!']

const arbitraryItem: fc.Arbitrary<GopherItem> = fc.record({
  kind: fc.constantFrom(...KINDS),
  label: fc.string(),
  selector: fc.string(),
  host: fc.constant('gopher.floodgap.com'),
  port: fc.constant(70),
})

describe('normaliseGopher', () => {
  it('never throws and always yields a non-empty kind and host', () => {
    fc.assert(
      fc.property(fc.array(arbitraryItem), items => {
        const records = normaliseGopher(items, 'gopher.floodgap.com', 70)
        expect(records).toHaveLength(items.length)
        for (const record of records) {
          expect(record.kind.length).toBeGreaterThan(0)
          expect(record.host).toBe('gopher.floodgap.com')
          expect(record.port).toBe(70)
          expect(typeof record.label).toBe('string')
        }
      }),
      { numRuns: 200 }
    )
  })

  it('maps item types to the menu / text / info categories', () => {
    const records = normaliseGopher(
      [
        { kind: '1', label: 'A menu', selector: '/menu', host: 'h', port: 70 },
        { kind: '0', label: 'A file', selector: '/file', host: 'h', port: 70 },
        { kind: 'i', label: 'just words', selector: '', host: 'h', port: 70 },
        { kind: '7', label: 'Search', selector: '/search', host: 'h', port: 70 },
      ],
      'h',
      70
    )
    expect(records.map(r => r.kind)).toEqual(['menu', 'text', 'info', 'menu'])
  })
})

describe('normaliseNNTP', () => {
  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), input => {
        expect(() => normaliseNNTP(input, 'news.neodome.net')).not.toThrow()
      }),
      { numRuns: 200 }
    )
  })

  it('keeps the message-id as selector', () => {
    const records = normaliseNNTP(
      [{ messageId: '<abc@example.com>', subject: 'Hello', from: 'a@b.c', bytes: 12 }],
      'news.neodome.net'
    )
    expect(records[0]!.selector).toBe('<abc@example.com>')
    expect(records[0]!.label).toBe('Hello')
    expect(records[0]!.mime).toBe('message/rfc822')
  })
})

describe('normaliseFinger', () => {
  it('returns one text record regardless of body content', () => {
    fc.assert(
      fc.property(fc.string(), body => {
        const records = normaliseFinger(body, 'graph.no', '')
        expect(records).toHaveLength(1)
        expect(records[0]!.kind).toBe('finger')
        expect(records[0]!.bytes).toBe(body.length)
        expect(records[0]!.host).toBe('graph.no')
      }),
      { numRuns: 100 }
    )
  })
})