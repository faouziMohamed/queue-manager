import {lastWeeks, parseDay} from '../../core/date.util.js';
import {openStatuses, statusKey} from '../../core/status.util.js';

/** @typedef {import('../../../shared/types.mjs').StatusKey} StatusKey */
/** @typedef {import('../../../shared/types.mjs').Task} Task */

export const WEEKS = 12;

/**
 * ECharts donut of open work by status, or undefined when nothing is open.
 * @param {Record<StatusKey, number>} counts
 * @param {number} openCount
 * @param {Record<string, string>} colors
 * @returns {object | undefined}
 */
export function statusOption(counts, openCount, colors) {
  if (openCount === 0) return undefined;
  return {
    tooltip: {
      ...baseTooltip(colors),
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)',
    },
    legend: {
      orient: 'vertical',
      right: 0,
      top: 'middle',
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: {color: colors.muted, fontSize: 12},
      formatter: name =>
        `${name}  ${counts[openStatuses.find(status => status.label === name).key]}`,
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
    series: [
      {
        type: 'pie',
        radius: ['56%', '78%'],
        center: ['30%', '50%'],
        padAngle: 2,
        itemStyle: {borderRadius: 4},
        label: {show: false},
        emphasis: {scale: true, scaleSize: 4},
        data: openStatuses
          .filter(status => counts[status.key] > 0)
          .map(status => ({
            name: status.label,
            value: counts[status.key],
            section: status.key,
            itemStyle: {color: colors[status.key]},
          })),
      },
    ],
  };
}

/**
 * ECharts bars of tasks shipped per week, or undefined when none shipped in the window.
 * @param {Task[]} done
 * @param {Record<string, string>} colors
 * @returns {object | undefined}
 */
export function shippedOption(done, colors) {
  const weeks = lastWeeks(WEEKS);
  for (const task of done) {
    const shipped = parseDay(task.shipped);
    if (!shipped) continue;
    const week = weeks.find(item => shipped >= item.from && shipped < item.to);
    if (week) week.count += 1;
  }
  if (weeks.every(week => week.count === 0)) return undefined;
  return {
    grid: {left: 28, right: 8, top: 16, bottom: 28},
    tooltip: {
      ...baseTooltip(colors),
      trigger: 'axis',
      axisPointer: {type: 'shadow'},
      formatter: items =>
        `Week of ${items[0].name}<br><b>${items[0].value}</b> shipped`,
    },
    xAxis: {
      type: 'category',
      data: weeks.map(week =>
        week.from.toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
        }),
      ),
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
    series: [
      {
        id: 'done',
        type: 'bar',
        barMaxWidth: 26,
        itemStyle: {color: colors.brand, borderRadius: [4, 4, 0, 0]},
        data: weeks.map(week => week.count),
      },
    ],
  };
}

/**
 * Open tasks grouped by priority, P1 to P3.
 * @param {Task[]} open
 * @returns {{label: string, tasks: Task[]}[]}
 */
export function priorityRows(open) {
  return ['1', '2', '3'].map(priority => ({
    label: `P${priority}`,
    tasks: open.filter(task => task.priority === priority),
  }));
}

/**
 * Open tasks grouped by repository, the eight largest groups.
 * @param {Task[]} open
 * @returns {{label: string, tasks: Task[]}[]}
 */
export function repositoryRows(open) {
  const byRepo = new Map();
  for (const task of open) {
    const repo = task.repo || 'Workspace-wide';
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo).push(task);
  }
  return [...byRepo.entries()]
    .map(([label, tasks]) => ({label, tasks}))
    .sort(
      (left, right) =>
        right.tasks.length - left.tasks.length ||
        left.label.localeCompare(right.label),
    )
    .slice(0, 8);
}

/**
 * ECharts horizontal bars stacked by status, or undefined when every row is empty.
 * @param {{label: string, tasks: Task[]}[]} rows
 * @param {Record<string, string>} colors
 * @returns {object | undefined}
 */
export function stackedOption(rows, colors) {
  if (rows.every(row => row.tasks.length === 0)) return undefined;
  const ordered = [...rows].reverse();
  return {
    grid: {left: 8, right: 16, top: 30, bottom: 8, containLabel: true},
    legend: {
      top: 0,
      left: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: {color: colors.muted, fontSize: 11},
    },
    tooltip: {
      ...baseTooltip(colors),
      trigger: 'axis',
      axisPointer: {type: 'shadow'},
    },
    xAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: {lineStyle: {color: colors.line}},
      axisLabel: {color: colors.faint, fontSize: 11},
    },
    yAxis: {
      type: 'category',
      data: ordered.map(row => row.label),
      axisLine: {lineStyle: {color: colors.line}},
      axisTick: {show: false},
      axisLabel: {
        color: colors.muted,
        fontSize: 12,
        width: 150,
        overflow: 'truncate',
      },
    },
    series: openStatuses.map(status => ({
      id: status.key,
      name: status.label,
      type: 'bar',
      stack: 'open',
      barMaxWidth: 18,
      itemStyle: {color: colors[status.key]},
      emphasis: {focus: 'series'},
      data: ordered.map(
        row => row.tasks.filter(task => statusKey(task) === status.key).length,
      ),
    })),
  };
}

function baseTooltip(colors) {
  return {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    textStyle: {color: colors.ink, fontSize: 12},
    extraCssText:
      'box-shadow: 0 6px 16px rgb(0 0 0 / 0.12); border-radius: 6px;',
  };
}
