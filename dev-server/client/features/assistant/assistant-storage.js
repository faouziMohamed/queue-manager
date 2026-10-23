const LEGACY_CHATS_KEY = 'queue-agent-chats';

export const LAST_CHAT_KEY = 'queue-agent-last-chat';

/**
 * Chats that older versions kept in this browser's local storage.
 * @returns {{id: string}[]}
 */
export function readLegacyChats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_CHATS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(thread => thread && typeof thread.id === 'string');
  } catch {
    return [];
  }
}

/**
 * Removes the legacy browser chats once imported.
 */
export function clearLegacyChats() {
  try {
    localStorage.removeItem(LEGACY_CHATS_KEY);
  } catch {}
}

/**
 * Reads a browser-local preference; empty when storage is unavailable.
 * @param {string} key
 * @returns {string}
 */
export function readPreference(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

/**
 * Writes a browser-local preference; an empty value removes it.
 * @param {string} key
 * @param {string} value
 */
export function writePreference(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {}
}
