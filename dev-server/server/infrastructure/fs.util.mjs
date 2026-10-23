import {promises as fs} from 'node:fs';

/**
 * Whether a path exists.
 * @param {string} target
 * @returns {Promise<boolean>}
 */
export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
