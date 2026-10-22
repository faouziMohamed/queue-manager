// Matches a Markdown ATX heading: hashes, the text, and optional closing hashes.
const headingPattern = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const fencePattern = /^\s*(```|~~~)/

export function upsertSection(body, heading, content) {
  const title = heading.replace(/\s+/g, ' ').trim()
  const text = content.trim()
  const lines = String(body || '').split('\n')
  const headings = scanHeadings(lines)
  const existing = headings.find(item => item.level >= 2 && item.text.toLowerCase() === title.toLowerCase())
  if (!existing) {
    const trimmed = lines.join('\n').replace(/\s+$/, '')
    return `${trimmed}\n\n## ${title}\n\n${text}\n`
  }
  const next = headings.find(item => item.line > existing.line && item.level <= existing.level)
  const end = next ? next.line : lines.length
  const replacement = [`${'#'.repeat(existing.level)} ${title}`, '', text, '']
  return [...lines.slice(0, existing.line), ...replacement, ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n')
}

function scanHeadings(lines) {
  const headings = []
  let fenced = false
  lines.forEach((line, index) => {
    if (fencePattern.test(line)) { fenced = !fenced; return }
    if (fenced) return
    const match = headingPattern.exec(line)
    if (match) headings.push({line: index, level: match[1].length, text: match[2].trim()})
  })
  return headings
}
