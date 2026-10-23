const DAY_MS = 86_400_000;

/**
 * Parses the leading `YYYY-MM-DD` of a value as a local date.
 * @param {unknown} value
 * @returns {Date | undefined}
 */
export function parseDay(value) {
  // Matches the leading YYYY-MM-DD of a date string.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Whole days between a `YYYY-MM-DD` value and today; NaN when it has no date.
 * @param {unknown} value
 * @returns {number}
 */
export function daysAgo(value) {
  const day = parseDay(value);
  if (!day) return Number.NaN;
  return Math.round((todayAtMidnight() - day) / DAY_MS);
}

/**
 * Monday-based week buckets ending with the current week, oldest first.
 * @param {number} count
 * @returns {{from: Date, to: Date, count: number}[]}
 */
export function lastWeeks(count) {
  const start = todayAtMidnight();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weeks = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const from = new Date(start);
    from.setDate(from.getDate() - index * 7);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    weeks.push({from, to, count: 0});
  }
  return weeks;
}

function todayAtMidnight() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}
