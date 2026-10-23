import {execFile} from 'node:child_process';
import {httpError} from '../http/http.util.mjs';

/**
 * Runs `queue.sh` one command at a time; failures become 409 errors with the CLI message.
 * @param {{root: string, queueScript: string}} options
 * @returns {{serialize: <T>(operation: () => Promise<T>) => Promise<T>, run: (args: string[]) => Promise<string>}}
 */
export function createQueueCli({root, queueScript}) {
  let mutations = Promise.resolve();

  function serialize(operation) {
    const next = mutations.then(operation, operation);
    mutations = next.catch(() => {});
    return next;
  }

  function run(args) {
    return new Promise((resolve, reject) => {
      execFile(
        'sh',
        [queueScript, ...args],
        {
          cwd: root,
          env: {...process.env, WORKSPACE_ROOT: root},
          maxBuffer: 1_000_000,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(httpError(409, (stderr || stdout || error.message).trim()));
            return;
          }
          resolve(stdout.trim());
        },
      );
    });
  }

  return {serialize, run: args => serialize(() => run(args))};
}
