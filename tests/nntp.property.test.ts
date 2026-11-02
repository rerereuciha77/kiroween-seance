import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { parseListActive, parseGroup, parseOver, parseArticle, parseDate } from '../src/lib/protocols/nntp'

describe('nntp response parsers', () => {
  it('should parse list active responses', () => {
    const data = [
      'comp.os.linux.misc 1000 1 y',
      'comp.windows.x 2000 100 y',
    ]
    const result = parseListActive(data)
    
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      group: 'comp.os.linux.misc',
      high: 1000,
      low: 1,
      flags: 'y',
    })
  })
  
  it('should parse group responses', () => {
    // Format: count first last group
    const data = ['211 150 1 150 comp.os.linux.misc']
    const result = parseGroup(data)
    
    expect(result).toEqual({
      count: 211,
      first: 150,
      last: 1,
      group: '150',
    })
  })
  
  it('should parse over responses', () => {
    const data = [
      '1\tSubject\tFrom\tDate\t<msg1@example.com>\t<ref1@example.com>\t1234\t50',
      '2\tSubject2\tFrom2\tDate2\t<msg2@example.com>\t<ref2@example.com>\t2345\t60',
    ]
    const result = parseOver(data)
    
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      number: 1,
      subject: 'Subject',
      from: 'From',
      date: 'Date',
      messageId: '<msg1@example.com>',
      references: '<ref1@example.com>',
      bytes: 1234,
      lines: 50,
    })
  })
  
  it('should parse article responses', () => {
    const data = [
      '1 Subject: Test',
      '2 From: test@example.com',
      '',
      'This is the body.',
      'Line 2.',
    ]
    const result = parseArticle(data)
    
    expect(result.header).toContain('1 Subject: Test')
    expect(result.body).toContain('This is the body.')
  })
  
  it('should parse date responses', () => {
    const data = ['20240101120000']
    const result = parseDate(data)
    
    expect(result).toEqual({
      year: 2024,
      month: 1,
      day: 1,
      hour: 12,
      minute: 0,
      second: 0,
    })
  })
  
  it('should handle arbitrary string arrays for over parser', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (arbitraryLines) => {
        // This should never throw
        const result = parseOver(arbitraryLines)
        expect(Array.isArray(result)).toBe(true)
      })
    )
  })
  
  it('should handle arbitrary string arrays for group parser', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (arbitraryLines) => {
        // This should never throw
        const result = parseGroup(arbitraryLines)
        // Result can be null or object
        expect(result === null || typeof result === 'object').toBe(true)
      })
    )
  })
  
  it('should handle arbitrary string arrays for date parser', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (arbitraryLines) => {
        // This should never throw
        const result = parseDate(arbitraryLines)
        // Result can be null or object
        expect(result === null || typeof result === 'object').toBe(true)
      })
    )
  })
})
