import {escapeHtml} from './render.js'
import {loadECharts} from './vendor.js'

export const statusOrder = [
  {key: 'in-progress', label: 'In progress', token: '--brand'},
  {key: 'ready', label: 'Ready', token: '--ok'},
  {key: 'blocked', label: 'Blocked', token: '--danger'},
  {key: 'awaiting', label: 'Awaiting production', token: '--warn'},
  {key: 'done', label: 'Done', token: '--faint'},
]

const openStatuses = statusOrder.filter(status => status.key !== 'done')
const DAY = 86_400_000
const WEEKS = 12
const charts = []
let renderedSignature = ''
let renderToken = 0

export function statusKey(task) {
  if (task.status === 'done') return 'done'
  return task.awaitingProduction ? 'awaiting' : task.status
}

export function themeColors() {
  const style = getComputedStyle(document.documentElement)
  const read = name => style.getPropertyValue(name).trim()
  const colors = {
    ink: read('--ink'),
    muted: read('--muted'),
    faint: read('--faint'),
    line: read('--line'),
    surface: read('--surface'),
    canvas: read('--canvas'),
    brand: read('--brand'),
  }
  for (const status of statusOrder) colors[status.key] = read(status.token)
  return colors
}

export function disposeInsights() {
  while (charts.length > 0) {
    const {chart, observer} = charts.pop()
    observer.disconnect()
    chart.dispose()
  }
  renderedSignature = ''
}

export function renderInsights(state, container) {
  const colors = themeColors()
  const signature = JSON.stringify([
    state.tasks.map(task => [task.id, task.status, task.priority, task.repo, task.updated, task.shipped, task.awaitingProduction, task.blockedBy]),
    state.workspace.mode,
    colors,
  ])
  if (signature === renderedSignature && container.querySelector('.insights')) return
  disposeInsights()
  renderedSignature = signature

  if (state.tasks.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg class="icon" aria-hidden="true"><use href="#i-chart"/></svg>
      <h2>No tasks to chart yet</h2>
      <p>Insights appear once the queue has tasks.</p>
      <button class="btn primary" type="button" data-new-task>New task</button>
    </div>`
    return
  }

  const open = state.tasks.filter(task => task.status !== 'done')
  const done = state.tasks.filter(task => task.status === 'done')
  const counts = countByStatus(state.tasks)
  const showRepos = state.workspace.mode === 'workspace'
  container.innerHTML = `<div class="insights">
    ${kpiTiles(counts, open.length, done)}
    <div class="chart-grid">
      ${chartCard('status', 'Open work by status', 'Click a slice to open that list.')}
      ${chartCard('shipped', 'Shipped per week', `Last ${WEEKS} weeks, by shipped date.`)}
      ${chartCard('priority', 'Open work by priority', 'Each bar splits a priority by status.')}
      ${showRepos ? chartCard('repos', 'Open work by repository', 'Top repositories by open tasks.') : ''}
      ${listCard('Most blocking', 'Open tasks that hold back the most other open tasks.', blockingList(state.tasks))}
      ${listCard('Longest untouched', 'Open tasks with the oldest update date.', staleList(open))}
    </div>
  </div>`

  const token = ++renderToken
  loadECharts()
    .then(echarts => {
      if (token !== renderToken || !container.isConnected) return
      mount(echarts, container, 'status', statusOption(counts, open.length, colors))
      mount(echarts, container, 'shipped', shippedOption(done, colors))
      mount(echarts, container, 'priority', stackedOption(priorityRows(open), colors))
      if (showRepos) mount(echarts, container, 'repos', stackedOption(repositoryRows(open), colors))
    })
    .catch(error => {
      for (const element of container.querySelectorAll('.chart-canvas')) {
        element.innerHTML = `<div class="chart-empty" role="alert">Charts could not load: ${escapeHtml(error.message)}
          <button class="btn" type="button" data-retry-charts>Retry</button></div>`
      }
      renderedSignature = ''
    })
}

function mount(echarts, container, name, option) {
  const element = container.querySelector(`[data-chart="${name}"]`)
  if (!element) return
  if (!option) {
    element.innerHTML = '<p class="chart-empty">Nothing to show yet.</p>'
    return
  }
  const chart = echarts.init(element, null, {renderer: 'svg'})
  chart.setOption({
    aria: {enabled: true},
    animationDuration: 400,
    textStyle: {fontFamily: getComputedStyle(document.body).fontFamily},
    ...option,
  })
  chart.on('click', params => {
    const section = params.data?.section || params.seriesId
    if (section) element.dispatchEvent(new CustomEvent('queue-set-section', {bubbles: true, detail: section}))
  })
  const observer = new ResizeObserver(() => chart.resize())
  observer.observe(element)
  charts.push({chart, observer})
}

function baseTooltip(colors) {
  return {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    textStyle: {color: colors.ink, fontSize: 12},
    extraCssText: 'box-shadow: 0 6px 16px rgb(0 0 0 / 0.12); border-radius: 6px;',
  }
}

function statusOption(counts, openCount, colors) {
  if (openCount === 0) return undefined
  return {
    tooltip: {...baseTooltip(colors), trigger: 'item', formatter: '{b}: {c} ({d}%)'},
    legend: {
      orient: 'vertical',
      right: 0,
      top: 'middle',
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: {color: colors.muted, fontSize: 12},
      formatter: name => `${name}  ${counts[openStatuses.find(status => status.label === name).key]}`,
    },
    title: {
      text: String(openCount),
      subtext: 'open',
      left: '29%',
      top: '38%',
      textAlign: 'center',
      textStyle: {color: colors.ink, fontSize: 26, fontWeight: 650},
      subtextStyle: {color: colors.faint, fontSize: 12},
      itemGap: 2,
    },
    series: [{
      type: 'pie',
      radius: ['56%', '78%'],
      center: ['30%', '50%'],
      padAngle: 2,
      itemStyle: {borderRadius: 4},
      label: {show: false},
      emphasis: {scale: true, scaleSize: 4},
      data: openStatuses
        .filter(status => counts[status.key] > 0)
        .map(status => ({name: status.label, value: counts[status.key], section: status.key, itemStyle: {color: colors[status.key]}})),
    }],
  }
}

function shippedOption(done, colors) {
  const weeks = lastWeeks()
  for (const task of done) {
    const shipped = parseDay(task.shipped)
    if (!shipped) continue
    const week = weeks.find(item => shipped >= item.from && shipped < item.to)
    if (week) week.count += 1
  }
  if (weeks.every(week => week.count === 0)) return undefined
  return {
    grid: {left: 28, right: 8, top: 16, bottom: 28},
    tooltip: {...baseTooltip(colors), trigger: 'axis', axisPointer: {type: 'shadow'}, formatter: items => `Week of ${items[0].name}<br><b>${items[0].value}</b> shipped`},
    xAxis: {
      type: 'category',
      data: weeks.map(week => week.from.toLocaleDateString(undefined, {day: 'numeric', month: 'short'})),
      axisLine: {lineStyle: {color: colors.line}},
      axisTick: {show: false},
      axisLabel: {color: colors.faint, fontSize: 11, interval: 2},
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: {lineStyle: {color: colors.line}},
      axisLabel: {color: colors.faint, fontSize: 11},
    },
    series: [{
      id: 'done',
      type: 'bar',
      barMaxWidth: 26,
      itemStyle: {color: colors.brand, borderRadius: [4, 4, 0, 0]},
      data: weeks.map(week => week.count),
    }],
  }
}

function priorityRows(open) {
  return ['1', '2', '3'].map(priority => ({
    label: `P${priority}`,
    tasks: open.filter(task => task.priority === priority),
  }))
}

function repositoryRows(open) {
  const byRepo = new Map()
  for (const task of open) {
    const repo = task.repo || 'Workspace-wide'
    if (!byRepo.has(repo)) byRepo.set(repo, [])
    byRepo.get(repo).push(task)
  }
  return [...byRepo.entries()]
    .map(([label, tasks]) => ({label, tasks}))
    .sort((left, right) => right.tasks.length - left.tasks.length || left.label.localeCompare(right.label))
    .slice(0, 8)
}

function stackedOption(rows, colors) {
  if (rows.every(row => row.tasks.length === 0)) return undefined
  const ordered = [...rows].reverse()
  return {
    grid: {left: 8, right: 16, top: 30, bottom: 8, containLabel: true},
    legend: {top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: {color: colors.muted, fontSize: 11}},
    tooltip: {...baseTooltip(colors), trigger: 'axis', axisPointer: {type: 'shadow'}},
    xAxis: {type: 'value', minInterval: 1, splitLine: {lineStyle: {color: colors.line}}, axisLabel: {color: colors.faint, fontSize: 11}},
    yAxis: {
      type: 'category',
      data: ordered.map(row => row.label),
      axisLine: {lineStyle: {color: colors.line}},
      axisTick: {show: false},
      axisLabel: {color: colors.muted, fontSize: 12, width: 150, overflow: 'truncate'},
    },
    series: openStatuses.map(status => ({
      id: status.key,
      name: status.label,
      type: 'bar',
      stack: 'open',
      barMaxWidth: 18,
      itemStyle: {color: colors[status.key]},
      emphasis: {focus: 'series'},
      data: ordered.map(row => row.tasks.filter(task => statusKey(task) === status.key).length),
    })),
  }
}

function chartCard(name, title, subtitle) {
  return `<section class="chart-card">
    <header><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p></header>
    <div class="chart-canvas" data-chart="${name}" role="img" aria-label="${escapeHtml(title)}"></div>
  </section>`
}

function listCard(title, subtitle, body) {
  return `<section class="chart-card">
    <header><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p></header>
    ${body}
  </section>`
}

function countByStatus(tasks) {
  const counts = Object.fromEntries(statusOrder.map(status => [status.key, 0]))
  for (const task of tasks) counts[statusKey(task)] += 1
  return counts
}

function kpiTiles(counts, openCount, done) {
  const lastWeek = done.filter(task => daysAgo(task.shipped) <= 6).length
  const weekBefore = done.filter(task => {
    const age = daysAgo(task.shipped)
    return age >= 7 && age <= 13
  }).length
  const delta = lastWeek - weekBefore
  let trend = 'same as the 7 days before'
  if (delta > 0) trend = `+${delta} vs the 7 days before`
  else if (delta < 0) trend = `${delta} vs the 7 days before`
  const tiles = [
    tile('Open', openCount, 'tasks not done', 'ready', ''),
    ...openStatuses.map(status => tile(status.label, counts[status.key], shareOfOpen(counts[status.key], openCount), status.key, status.token)),
    tile('Shipped · 7 days', lastWeek, trend, 'done', '--faint'),
  ]
  return `<div class="kpi-grid">${tiles.join('')}</div>`
}

function tile(label, value, hint, section, token) {
  const swatch = token ? `<span class="kpi-swatch" style="background:var(${token})"></span>` : ''
  return `<button class="kpi" type="button" data-section="${section}">
    <span class="kpi-label">${swatch}${escapeHtml(label)}</span>
    <strong class="kpi-value">${value}</strong>
    <span class="kpi-hint">${escapeHtml(hint)}</span>
  </button>`
}

function shareOfOpen(value, total) {
  if (total === 0) return '0% of open work'
  return `${Math.round((value / total) * 100)}% of open work`
}

function blockingList(tasks) {
  const open = new Map(tasks.filter(task => task.status !== 'done').map(task => [task.id, task]))
  const blocking = new Map()
  for (const task of open.values()) {
    for (const blocker of task.blockedBy) {
      if (open.has(blocker)) blocking.set(blocker, (blocking.get(blocker) || 0) + 1)
    }
  }
  const rows = [...blocking.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
  if (rows.length === 0) return '<p class="chart-empty">No open task is blocking another.</p>'
  return `<ol class="rank-list">${rows.map(([id, count]) => rankRow(open.get(id), `blocks ${count}`)).join('')}</ol>`
}

function staleList(open) {
  const rows = open
    .map(task => ({task, age: daysAgo(task.updated)}))
    .filter(row => Number.isFinite(row.age))
    .sort((left, right) => right.age - left.age || left.task.id.localeCompare(right.task.id))
    .slice(0, 5)
  if (rows.length === 0) return '<p class="chart-empty">No open task has an update date.</p>'
  return `<ol class="rank-list">${rows.map(row => rankRow(row.task, row.age === 0 ? 'today' : `${row.age} d`)).join('')}</ol>`
}

function rankRow(task, metric) {
  const status = statusOrder.find(item => item.key === statusKey(task))
  return `<li><button class="rank-row" type="button" data-open="${escapeHtml(task.id)}">
    <span class="legend-swatch" style="background:var(${status.token})" title="${escapeHtml(status.label)}"></span>
    <span class="rank-id">${escapeHtml(task.id)}</span>
    <span class="rank-title">${escapeHtml(task.title)}</span>
    <span class="rank-metric">${escapeHtml(metric)}</span>
  </button></li>`
}

function lastWeeks() {
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const weeks = []
  for (let index = WEEKS - 1; index >= 0; index -= 1) {
    const from = new Date(start)
    from.setDate(from.getDate() - index * 7)
    const to = new Date(from)
    to.setDate(to.getDate() + 7)
    weeks.push({from, to, count: 0})
  }
  return weeks
}

function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  if (!match) return undefined
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function daysAgo(value) {
  const day = parseDay(value)
  if (!day) return Number.NaN
  const today = new Date()
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((midnight - day) / DAY)
}
