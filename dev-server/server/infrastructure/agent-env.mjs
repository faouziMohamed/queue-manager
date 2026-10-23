import {promises as fs} from 'node:fs';

/**
 * Loads `KEY=value` lines into `process.env` without overriding variables already set.
 * @param {string} file
 * @returns {Promise<void>}
 */
export async function loadAgentEnv(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    for (const line of text.split('\n')) {
      // Matches KEY=value lines, with an optional leading "export".
      const match = line.match(
        /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
      );
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  } catch {}
}
