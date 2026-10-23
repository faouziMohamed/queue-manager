import {spawn} from 'node:child_process';
import {constants, promises as fs} from 'node:fs';
import path from 'node:path';
import {httpError} from '../../http/http.util.mjs';

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Whether an executable is on PATH.
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function commandExists(name) {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    try {
      await fs.access(path.join(directory, name), constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

/**
 * Runs a provider CLI with an 8 MB output cap and a timeout; failures become redacted 502 errors.
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd: string, env?: NodeJS.ProcessEnv, timeout?: number}} options `timeout` in milliseconds, 180 s by default.
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let overflowed = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeout ?? DEFAULT_TIMEOUT_MS);

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        overflowed
          ? httpError(502, `${command} produced more than 8 MB of output.`)
          : providerFailure(command, error, stderr),
      );
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => {
      if (stdout.length + chunk.length > 8_000_000) {
        overflowed = true;
        child.kill('SIGKILL');
        return;
      }
      stdout += chunk;
    });
    child.stderr?.on('data', chunk => {
      stderr = (stderr + chunk).slice(-64_000);
    });
    child.on('error', fail);
    child.on('close', (code, signal) => {
      if (settled) return;
      if (overflowed) {
        fail(new Error('output limit'));
        return;
      }
      if (code === 0) {
        settled = true;
        clearTimeout(timer);
        resolve({stdout, stderr});
        return;
      }
      const error = new Error('command failed');
      error.code = code;
      error.killed = timedOut || signal !== null;
      fail(error);
    });
  });
}

function providerFailure(command, error, stderr) {
  if (error?.code === 'ENOENT')
    return httpError(502, `${command} is not installed.`);
  const lastLine =
    String(stderr || '')
      // Matches ANSI color escape sequences.
      .replace(/\x1b\[[0-9;]*m/g, '')
      .split('\n')
      .map(line => line.trim())
      .filter(
        line =>
          line &&
          !line.startsWith('Warning:') &&
          !line.startsWith('⚠') &&
          !line.startsWith('Reading additional input'),
      )
      .pop() || '';
  const detail = lastLine
    // Matches OpenAI-style secret keys and bearer tokens, so they never reach the UI.
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .slice(0, 400);
  const timeout = error?.killed ? ' (timed out)' : '';
  const suffix = detail ? ` ${detail}` : '';
  return httpError(502, `${command} failed to answer${timeout}.${suffix}`);
}
