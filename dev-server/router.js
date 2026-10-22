const sectionIds = ['in-progress', 'ready', 'blocked', 'awaiting', 'done', 'insights', 'graph']

const taskIdPattern = /^Q-\d{4,}$/

export function parseRoute(pathname, search = '', hash = '') {
  const legacy = /^#task\/(Q-\d{4,})$/.exec(hash)
  if (legacy) return {kind: 'section', section: '', peek: legacy[1], legacy: true}
  const task = /^\/tasks\/(Q-\d{4,})\/?$/.exec(pathname)
  if (task) return {kind: 'task', id: task[1]}
  const section = pathname.replace(/^\/+|\/+$/g, '')
  const peek = new URLSearchParams(search).get('task') || ''
  return {
    kind: 'section',
    section: sectionIds.includes(section) ? section : '',
    peek: taskIdPattern.test(peek) ? peek : '',
  }
}

export function peekPath(section, id) {
  return `/${section}?task=${encodeURIComponent(id)}`
}

export function sectionPath(section) {
  return `/${section}`
}

export function taskPath(id) {
  return `/tasks/${id}`
}

export function sectionForTask(task) {
  if (task.status === 'done') return 'done'
  if (task.awaitingProduction) return 'awaiting'
  return task.status
}

export function internalPath(anchor, event) {
  if (!anchor || event.defaultPrevented || event.button !== 0) return ''
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return ''
  if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return ''
  const url = new URL(anchor.href, location.href)
  if (url.origin !== location.origin) return ''
  const route = parseRoute(url.pathname, url.search)
  const isPage = route.kind === 'task' || route.section || url.pathname === '/'
  return isPage ? `${url.pathname}${url.search}` : ''
}
