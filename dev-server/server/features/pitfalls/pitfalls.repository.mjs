import {promises as fs} from 'node:fs';
import path from 'node:path';

/** @typedef {import('../../../shared/types.mjs').TaskRecord} TaskRecord */

// A lesson is a Markdown section. The canonical shape is
//   ### PIT-001 — Title
//   **Symptom:** … **Cause:** … **Remedy:** … **Verified:** date, `case`
// Unnumbered `## Title` lessons are accepted so older project files still show up.
const lessonId = /\bPIT-\d{3,}\b/i;
const fieldPattern = /^\*\*([A-Za-z][A-Za-z /-]{0,30}):\*\*\s*(.*)$/;
const groupNames = new Set([
  'meta',
  'frontend',
  'backend',
  'infra',
  'infrastructure',
  'database',
  'data',
  'deployment',
  'testing',
  'security',
  'performance',
  'tooling',
  'workflow',
  'api',
  'auth',
  'build',
  'ops',
  'ui',
  'general',
  'misc',
  'debugging',
]);
const knownFields = new Set([
  'symptom',
  'cause',
  'remedy',
  'applies to',
  'verified',
  'verified/checked',
  'cost',
  'scope',
  'fix',
  'workaround',
  'why it recurs',
  'detect',
  'avoid',
]);

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return (
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'lesson'
  );
}

function headingInfo(text) {
  const id = (text.match(lessonId) || [])[0];
  const title = clean(
    text
      .replace(lessonId, '')
      .replace(/^[\s—–:-]+/, '')
      .replace(/[\s—–:-]+$/, ''),
  );
  return {id: id ? id.toUpperCase() : '', title: title || clean(text)};
}

function groupHeadings(lines, index, level, text) {
  if (level !== 2 || lessonId.test(text)) return false;
  let cursor = index + 1;
  let body = false;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (/^#{1,6}\s+/.test(line)) break;
    if (line.trim() && !/^<a\s+id=/i.test(line.trim())) body = true;
    cursor += 1;
  }
  if (body) return false;
  return groupNames.has(text.trim().toLowerCase()) || cursor < lines.length;
}

function parseFields(lines) {
  const fields = [];
  const prose = [];
  let active = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      active = null;
      continue;
    }
    if (/^<a\s+id=/i.test(line)) continue;
    // A line can hold several fields, e.g. "**Applies to:** … **Verified:** …".
    const segments = line.split(/\s+(?=\*\*[A-Za-z][A-Za-z /-]{0,30}:\*\*)/);
    for (const segment of segments) {
      const match = fieldPattern.exec(segment);
      if (match) {
        active = {
          label: clean(match[1]),
          key: clean(match[1]).toLowerCase(),
          parts: [match[2]],
        };
        fields.push(active);
      } else if (active) {
        active.parts.push(segment);
      } else {
        prose.push(segment);
      }
    }
  }
  return {
    fields: fields.map(field => ({
      label: field.label,
      key: field.key,
      value: clean(field.parts.join(' ').replace(/<a\s+id=[^>]*><\/a>/gi, '')),
    })),
    body: prose.join('\n').trim(),
  };
}

function findField(fields, names) {
  const wanted = names.map(name => name.toLowerCase());
  return fields.find(field => wanted.includes(field.key))?.value || '';
}

function casesOf(verified) {
  const backticked = [...verified.matchAll(/`([^`]+)`/g)].map(match =>
    clean(match[1]),
  );
  if (backticked.length > 0) return [...new Set(backticked)];
  return [
    ...new Set(
      verified
        .split(/[,;]/)
        .map(value => clean(value).replace(/\.$/, ''))
        .filter(value => /^[a-z0-9][a-z0-9._-]*$/i.test(value))
        .filter(value => !/^\d{4}-\d{2}-\d{2}$/.test(value)),
    ),
  ];
}

function finishLesson(lesson) {
  const info = headingInfo(lesson.heading);
  const parsed = parseFields(lesson.lines);
  const verified = findField(parsed.fields, ['Verified', 'Verified/checked']);
  const extras = parsed.fields.filter(field => !knownFields.has(field.key));
  const number = info.id ? Number(info.id.slice(4)) : Number.MAX_SAFE_INTEGER;
  return {
    id: info.id,
    title: info.title,
    anchor: info.id ? info.id.toLowerCase() : slug(info.title),
    group: lesson.group,
    order: lesson.order,
    symptom: findField(parsed.fields, ['Symptom']),
    cause: findField(parsed.fields, ['Cause']),
    remedy: findField(parsed.fields, ['Remedy', 'Fix', 'Workaround']),
    appliesTo: findField(parsed.fields, ['Applies to', 'Scope']),
    cost: findField(parsed.fields, ['Cost']),
    verified: Boolean(verified),
    verifiedDate: (verified.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || '',
    cases: casesOf(verified),
    extras,
    body: parsed.body,
    number,
  };
}

/**
 * Parses `PIT-###` lessons from PITFALLS.md, grouped by their source heading.
 * @param {string} source
 * @param {string} [file]
 * @returns {{exists: boolean, file: string, intro: string, pitfalls: object[]}}
 */
export function parsePitfalls(source, file = 'PITFALLS.md') {
  const lines = String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const lessons = [];
  const intro = [];
  let current = null;
  let group = '';
  let order = 0;
  let inFence = false;

  function commit() {
    if (!current) return;
    lessons.push(finishLesson(current));
    current = null;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/.test(line)) inFence = !inFence;
    if (inFence) {
      if (current) current.lines.push(line);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1) {
        commit();
        group = '';
        continue;
      }
      if (groupHeadings(lines, index, level, text)) {
        commit();
        group = clean(text);
        continue;
      }
      commit();
      current = {heading: text, group, order: order++, lines: []};
      continue;
    }
    if (current) current.lines.push(line);
    else if (!/^\s*<a\s+id=/i.test(line)) intro.push(line);
  }
  commit();

  const introText = intro
    .join('\n')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  lessons.sort(
    (left, right) => left.number - right.number || left.order - right.order,
  );
  return {file, intro: introText, pitfalls: lessons};
}

/**
 * Reads and parses the project's PITFALLS.md, if any.
 * @param {string} root
 * @returns {Promise<{exists: boolean, file: string, intro: string, pitfalls: object[]}>}
 */
export async function readPitfalls(root) {
  const candidates = [
    ['PITFALLS.md', path.join(root, 'PITFALLS.md')],
    ['docs/PITFALLS.md', path.join(root, 'docs', 'PITFALLS.md')],
    ['docs/pitfalls.md', path.join(root, 'docs', 'pitfalls.md')],
  ];
  for (const [name, file] of candidates) {
    try {
      const text = await fs.readFile(file, 'utf8');
      return {exists: true, ...parsePitfalls(text, name)};
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return {exists: false, file: 'PITFALLS.md', intro: '', pitfalls: []};
}

/**
 * Adds to each lesson the tasks whose body mentions its id.
 * @param {{pitfalls: object[]}} data
 * @param {TaskRecord[]} tasks
 * @returns {object}
 */
export function attachLinkedTasks(data, tasks) {
  const links = new Map();
  for (const task of tasks) {
    for (const id of new Set(
      (task.body.match(/\bPIT-\d{3,}\b/gi) || []).map(value =>
        value.toUpperCase(),
      ),
    )) {
      if (!links.has(id)) links.set(id, []);
      links.get(id).push({
        id: task.id,
        title: task.title,
        status: task.status,
        repo: task.repo || '',
      });
    }
  }
  const pitfalls = data.pitfalls.map(pitfall => ({
    ...pitfall,
    linkedTasks: links.get(pitfall.id) || [],
  }));
  const linked = pitfalls.filter(
    pitfall => pitfall.linkedTasks.length > 0,
  ).length;
  const verified = pitfalls.filter(pitfall => pitfall.verified).length;
  return {
    ...data,
    pitfalls,
    counts: {
      total: pitfalls.length,
      linked,
      verified,
      unverified: pitfalls.length - verified,
      openLinked: pitfalls.filter(pitfall =>
        pitfall.linkedTasks.some(task => task.status !== 'done'),
      ).length,
    },
  };
}
