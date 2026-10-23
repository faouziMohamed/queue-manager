/** @typedef {import('../../../shared/types.mjs').TaskStatus} TaskStatus */
/** @typedef {import('../../../shared/types.mjs').TaskRecord} TaskRecord */

/**
 * Parses a task file's frontmatter and body.
 * @param {string} text
 * @param {TaskStatus} status The folder it was read from.
 * @param {string} file
 * @returns {TaskRecord | undefined} Undefined when the frontmatter is missing.
 */
export function parseTask(text, status, file) {
  const sections = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!sections) return undefined;

  const meta = {};
  for (const line of sections[1].split('\n')) {
    const separator = line.indexOf(': ');
    if (separator > 0)
      meta[line.slice(0, separator)] = line.slice(separator + 2);
  }

  const body = sections[2];
  const resume = (body.match(/^\*\*Resume:\*\* (.*)$/m) || [])[1] || '';

  return {
    id: meta.id,
    status,
    file,
    title: meta.title || '',
    priority: meta.priority || '',
    updated: meta.updated || '',
    shipped: meta.shipped || '',
    prodGate: meta.prod_gate === 'true',
    sourceRepository: meta.source_repository || '',
    resume,
    dod: definitionOfDone(body),
    body,
  };
}

/**
 * Task file text with the body replaced and the frontmatter kept.
 * @param {string} text
 * @param {string} body
 * @returns {string | undefined} Undefined when the frontmatter is missing.
 */
export function replaceBodyText(text, body) {
  const closing = text.indexOf('\n---\n', 4);
  if (closing === -1) return undefined;
  return `${text.slice(0, closing + 5)}${body.replace(/\s+$/, '')}\n`;
}

// Checklist items under a "Definition of done" heading, up to the next heading of the same or higher level.
function definitionOfDone(body) {
  const lines = body.split('\n');
  const start = lines.findIndex(line =>
    /^#{2,6}\s+definition of done\b/i.test(line),
  );
  if (start === -1) return {present: false, total: 0, done: 0, items: []};
  const level = lines[start].match(/^#+/)[0].length;
  const items = [];
  for (const line of lines.slice(start + 1)) {
    const heading = line.match(/^(#{1,6})\s/);
    if (heading && heading[1].length <= level) break;
    const checkbox = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (checkbox)
      items.push({done: checkbox[1] !== ' ', text: checkbox[2].trim()});
    else if (bullet) items.push({done: false, text: bullet[1].trim()});
  }
  return {
    present: true,
    total: items.length,
    done: items.filter(item => item.done).length,
    items,
  };
}
