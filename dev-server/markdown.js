function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]))
}

function inline(value) {
  let text = escapeHtml(value)
  const code = []
  text = text.replace(/`([^`]+)`/g, (_, content) => {
    code.push(content)
    return `\u0000${code.length - 1}\u0000`
  })
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const href = url.replace(/&amp;/g, '&')
    if (!/^(https?:\/\/|mailto:|#)/i.test(href)) return label
    const external = /^https?:/i.test(href)
    return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${label}</a>`
  })
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${code[Number(index)]}</code>`)
}

function isBlockStart(lines, index) {
  const line = lines[index]
  return /^```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^---+$/.test(line.trim()) ||
    /^>\s?/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    tableAt(lines, index)
}

function tableAt(lines, index) {
  if (!lines[index].includes('|')) return false
  const next = lines[index + 1]
  return Boolean(next && /^\s*\|?\s*:?-{3,}/.test(next))
}

function cells(line) {
  const parts = line.split('|').map(cell => cell.trim())
  if (parts[0] === '') parts.shift()
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

function renderTable(lines, index) {
  const header = cells(lines[index])
  const rows = []
  let cursor = index + 2
  while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim()) {
    rows.push(cells(lines[cursor]))
    cursor += 1
  }
  const head = header.map(cell => `<th>${inline(cell)}</th>`).join('')
  const body = rows.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')
  return {
    html: `<div class="md-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    next: cursor,
  }
}

function paragraph(lines, index) {
  const values = []
  let cursor = index
  while (cursor < lines.length && lines[cursor].trim() && !isBlockStart(lines, cursor)) {
    values.push(lines[cursor])
    cursor += 1
  }
  return {html: `<p>${inline(values.join(' '))}</p>`, next: cursor}
}

export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const output = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }

    const fence = line.match(/^```([\w-]*)/)
    if (fence) {
      const code = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      const language = fence[1] ? ` class="language-${fence[1]}"` : ''
      output.push(`<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (/^---+$/.test(line.trim())) {
      output.push('<hr>')
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      output.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`)
      continue
    }

    if (/^[-*]\s+\[[ xX]\]\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^[-*]\s+\[[ xX]\]\s+/.test(lines[index])) {
        const item = lines[index].match(/^[-*]\s+\[([ xX])\]\s+(.*)$/)
        const done = item[1].toLowerCase() === 'x'
        items.push(`<li class="${done ? 'done' : ''}"><input type="checkbox" disabled${done ? ' checked' : ''}><span>${inline(item[2])}</span></li>`)
        index += 1
      }
      output.push(`<ul class="checklist">${items.join('')}</ul>`)
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^[-*]\s+/, ''))}</li>`)
        index += 1
      }
      output.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^\d+\.\s+/, ''))}</li>`)
        index += 1
      }
      output.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    if (tableAt(lines, index)) {
      const table = renderTable(lines, index)
      output.push(table.html)
      index = table.next
      continue
    }

    const block = paragraph(lines, index)
    output.push(block.html)
    index = block.next
  }

  return output.join('\n') || '<p class="muted">No body recorded.</p>'
}
