import * as cp from 'child_process';
import { AnalysisCancelledError } from '../utils/errors';

export interface ToolRunOptions {
  readonly maxBuffer: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface ToolRunResult {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

export type ToolRunner = (
  command: string,
  args: readonly string[],
  options: ToolRunOptions
) => Promise<ToolRunResult>;

/** Runs a native inspection tool without using a shell. */
export const spawnTool: ToolRunner = (command, args, options) =>
  new Promise(resolve => {
    if (options.signal?.aborted) {
      resolve(cancelledResult());
      return;
    }

    let child: cp.ChildProcess;
    try {
      child = cp.spawn(command, [...args], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        status: null,
        signal: null,
        error: toError(error),
      });
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let completed = false;

    const finish = (result: ToolRunResult): void => {
      if (completed) {
        return;
      }
      completed = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      resolve(result);
    };

    const failAndKill = (error: Error): void => {
      child.kill();
      finish({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        status: null,
        signal: null,
        error,
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > options.maxBuffer) {
        failAndKill(new Error(`stdout exceeded ${options.maxBuffer} bytes`));
        return;
      }
      stdout.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrSize += chunk.length;
      if (stderrSize > options.maxBuffer) {
        failAndKill(new Error(`stderr exceeded ${options.maxBuffer} bytes`));
        return;
      }
      stderr.push(chunk);
    });

    child.once('error', error => {
      finish({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        status: null,
        signal: null,
        error,
      });
    });

    child.once('close', (status, signal) => {
      finish({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        status,
        signal,
      });
    });

    const timeout = setTimeout(() => {
      failAndKill(new Error(`timed out after ${options.timeoutMs} ms`));
    }, options.timeoutMs);

    function abort(): void {
      failAndKill(new AnalysisCancelledError());
    }
    options.signal?.addEventListener('abort', abort, { once: true });
  });

function cancelledResult(): ToolRunResult {
  return {
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    status: null,
    signal: null,
    error: new AnalysisCancelledError(),
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
