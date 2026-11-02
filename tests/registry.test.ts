import { describe, it, expect, beforeEach } from 'vitest'
import { loadRegistry, isAllowed } from '../src/lib/registry'
import * as fs from 'fs'
import * as path from 'path'

describe('loadRegistry', () => {
  beforeEach(() => {
    delete process.env.SEANCE_REGISTRY_PATH
  })
  
  it('should load valid sources.json', () => {
    const sources = loadRegistry(path.join(__dirname, '..', 'sources.json'))
    expect(sources).toHaveLength(3)
    expect(sources[0]).toEqual({
      id: 'gopher-floodgap',
      protocol: 'gopher',
      host: 'gopher.floodgap.com',
      port: 70,
      description: 'Gopher server at floodgap.com',
    })
  })
  
  it('should throw on missing file', () => {
    expect(() => {
      loadRegistry('/nonexistent/path/sources.json')
    }).toThrow('Failed to read sources.json')
  })
  
  it('should throw on bad JSON', () => {
    const tmpFile = path.join(__dirname, 'bad.json')
    fs.writeFileSync(tmpFile, 'not valid json{', 'utf8')
    
    expect(() => {
      loadRegistry(tmpFile)
    }).toThrow('sources.json is not valid JSON')
    
    fs.unlinkSync(tmpFile)
  })
  
  it('should throw on invalid schema', () => {
    const tmpFile = path.join(__dirname, 'invalid.json')
    fs.writeFileSync(tmpFile, JSON.stringify([{ id: 'test', protocol: 'invalid' }]), 'utf8')
    
    expect(() => {
      loadRegistry(tmpFile)
    }).toThrow('protocol')
    
    fs.unlinkSync(tmpFile)
  })
})

describe('isAllowed', () => {
  beforeEach(() => {
    delete process.env.SEANCE_ALLOW_ARBITRARY_HOSTS
  })
  
  it('should return true for allowed hosts', () => {
    expect(isAllowed('gopher.floodgap.com', 70)).toBe(true)
    expect(isAllowed('news.europenews.net', 119)).toBe(true)
    expect(isAllowed('localhost', 79)).toBe(true)
  })
  
  it('should return false for unknown hosts', () => {
    expect(isAllowed('unknown.example.com', 70)).toBe(false)
  })
  
  it('should allow arbitrary hosts when SEANCE_ALLOW_ARBITRARY_HOSTS=true', () => {
    process.env.SEANCE_ALLOW_ARBITRARY_HOSTS = 'true'
    
    expect(isAllowed('unknown.example.com', 70)).toBe(true)
  })
})
