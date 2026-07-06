const CHUNK_TARGET_SIZE = 800

function packOnBoundary(units: string[], joiner: string): string[] {
  const chunks: string[] = []
  let current = ''
  for (const unit of units) {
    const candidate = current ? `${current}${joiner}${unit}` : unit
    // a single unit longer than the target window is kept whole rather than dropped
    // or split mid-word; it becomes its own (oversized) chunk.
    if (candidate.length <= CHUNK_TARGET_SIZE || current === '') {
      current = candidate
    } else {
      chunks.push(current)
      current = unit
    }
  }
  if (current !== '') chunks.push(current)
  return chunks
}

export function chunkRunbook(content: string): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)

  const chunks: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_TARGET_SIZE) {
      if (current !== '') {
        chunks.push(current)
        current = ''
      }
      chunks.push(...packOnBoundary(paragraph.split('\n'), '\n'))
      continue
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length <= CHUNK_TARGET_SIZE) {
      current = candidate
    } else {
      chunks.push(current)
      current = paragraph
    }
  }
  if (current !== '') chunks.push(current)
  return chunks
}
