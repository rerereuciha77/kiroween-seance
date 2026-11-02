import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { parseGopherMenu } from '../src/lib/protocols/gopher'

describe('parseGopherMenu', () => {
  it('should never throw for arbitrary input', () => {
    fc.assert(
      fc.property(fc.uint8Array(), (arbitraryBytes) => {
        const buffer = Buffer.from(arbitraryBytes)
        const data = buffer.toString('utf8')
        
        // This should never throw
        const result = parseGopherMenu(data, 'test.example.com', 70)
        
        // Result should always be an array
        expect(Array.isArray(result)).toBe(true)
        
        // Each item should have required fields
        for (const item of result) {
          expect(typeof item.kind).toBe('string')
          expect(item.kind.length).toBeGreaterThan(0)
          expect(typeof item.label).toBe('string')
          expect(typeof item.selector).toBe('string')
          expect(typeof item.host).toBe('string')
          expect(item.port).toBeGreaterThan(0)
        }
      })
    )
  })
  
  it('should handle empty input', () => {
    const result = parseGopherMenu('', 'test.example.com', 70)
    expect(result).toEqual([])
  })
  
  it('should parse simple menu correctly', () => {
    const menu = '0\tFile1\tfile1.txt\texample.com\t70\r\n1\tDirectory\t/dir\texample.com\t70\r\n'
    const result = parseGopherMenu(menu, 'example.com', 70)
    
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      kind: '0',
      label: 'File1',
      selector: 'file1.txt',
      host: 'example.com',
      port: 70,
    })
    expect(result[1]).toEqual({
      kind: '1',
      label: 'Directory',
      selector: '/dir',
      host: 'example.com',
      port: 70,
    })
  })
  
  it('should fallback to kind=i for malformed lines', () => {
    const menu = 'just some text without tabs\r\n0\tValid\tselector\thost\t70\r\n'
    const result = parseGopherMenu(menu, 'example.com', 70)
    
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      kind: 'i',
      label: 'just some text without tabs',
      selector: '',
      host: 'example.com',
      port: 70,
    })
    expect(result[1]).toEqual({
      kind: '0',
      label: 'Valid',
      selector: 'selector',
      host: 'host',
      port: 70,
    })
  })
})
