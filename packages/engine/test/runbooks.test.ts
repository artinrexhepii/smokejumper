import { describe, expect, it } from 'vitest'
import { chunkRunbook } from '../src/runbooks'

describe('chunkRunbook', () => {
  it('returns an empty array for empty or whitespace-only content', () => {
    expect(chunkRunbook('')).toEqual([])
    expect(chunkRunbook('   \n\n   ')).toEqual([])
  })

  it('returns a single chunk for content under the window size', () => {
    const content = 'Step 1. Restart the service.\n\nStep 2. Check the logs.'
    expect(chunkRunbook(content)).toEqual([content])
  })

  it('packs consecutive paragraphs into one chunk until the ~800-char window is exceeded', () => {
    const paragraph = 'x'.repeat(390)
    const content = [paragraph, paragraph, paragraph].join('\n\n')
    const chunks = chunkRunbook(content)
    expect(chunks).toEqual([`${paragraph}\n\n${paragraph}`, paragraph])
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(800)
  })

  it('splits a single oversized paragraph on line boundaries', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `segment-${i}-` + 'x'.repeat(60))
    const content = lines.join('\n')
    const chunks = chunkRunbook(content)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('\n')).toBe(content)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(800)
  })

  it('is deterministic for the same input', () => {
    const content = `${'a'.repeat(1000)}\n\n${'b'.repeat(1000)}`
    expect(chunkRunbook(content)).toEqual(chunkRunbook(content))
  })
})
