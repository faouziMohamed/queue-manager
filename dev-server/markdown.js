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
    if (!/^(https?:\/\/|mailto:|#|\/)/i.test(href)) return label
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
    listItemAt(line) ||
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

const listItemPattern = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

function indentOf(line) {
  return line.match(/^\s*/)[0].replace(/\t/g, '    ').length
}

function listItemAt(line) {
  return listItemPattern.test(line)
}

// Renders a bullet or numbered list, including nested lists and wrapped item lines.
function renderList(lines, index, indent) {
  const first = lines[index].match(listItemPattern)
  const ordered = /\d/.test(first[2])
  const start = ordered ? parseInt(first[2], 10) : 1
  const items = []
  let cursor = index
  while (cursor < lines.length) {
    const line = lines[cursor]
    const match = line.match(listItemPattern)
    if (!match || indentOf(line) !== indent || /\d/.test(match[2]) !== ordered) break
    const text = [match[3]]
    const children = []
    cursor += 1
    while (cursor < lines.length) {
      const next = lines[cursor]
      if (!next.trim()) {
        const following = lines.slice(cursor + 1).find(value => value.trim())
        if (following && indentOf(following) > indent) { cursor += 1; continue }
        break
      }
      if (indentOf(next) <= indent) break
      if (listItemAt(next)) {
        const nested = renderList(lines, cursor, indentOf(next))
        children.push(nested.html)
        cursor = nested.next
        continue
      }
      text.push(next.trim())
      cursor += 1
    }
    const checkbox = text[0].match(/^\[([ xX])\]\s+(.*)$/)
    if (checkbox) {
      const done = checkbox[1].toLowerCase() === 'x'
      items.push({checklist: true, html: `<li class="${done ? 'done' : ''}"><input type="checkbox" disabled${done ? ' checked' : ''}><span>${inline([checkbox[2], ...text.slice(1)].join(' '))}</span>${children.join('')}</li>`})
    } else {
      items.push({checklist: false, html: `<li>${inline(text.join(' '))}${children.join('')}</li>`})
    }
    while (cursor < lines.length && !lines[cursor].trim()) {
      const following = lines.slice(cursor).find(value => value.trim())
      const nextMatch = following && following.match(listItemPattern)
      if (nextMatch && indentOf(following) === indent && /\d/.test(nextMatch[2]) === ordered) cursor += 1
      else break
    }
  }
  const tag = ordered ? 'ol' : 'ul'
  const checklist = items.length > 0 && items.every(item => item.checklist)
  const attributes = `${ordered && start !== 1 ? ` start="${start}"` : ''}${checklist ? ' class="checklist"' : ''}`
  return {html: `<${tag}${attributes}>${items.map(item => item.html).join('')}</${tag}>`, next: cursor}
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

    if (listItemAt(line)) {
      const list = renderList(lines, index, indentOf(line))
      output.push(list.html)
      index = list.next
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
