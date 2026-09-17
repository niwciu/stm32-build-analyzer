import * as assert from 'assert';
import { spawnTool } from '../process/ToolRunner';
import { AnalysisCancelledError } from '../utils/errors';

suite('ToolRunner', () => {
  test('returns stdout, stderr, and status after execution', async () => {
    const result = await spawnTool(
      process.execPath,
      ['-e', 'process.stdout.write("out"); process.stderr.write("err")'],
      { maxBuffer: 1024, timeoutMs: 1000 }
    );

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout.toString(), 'out');
    assert.strictEqual(result.stderr.toString(), 'err');
    assert.strictEqual(result.error, undefined);
  });

  test('returns a non-zero exit status for the caller to classify', async () => {
    const result = await spawnTool(
      process.execPath,
      ['-e', 'process.stderr.write("failed"); process.exit(3)'],
      { maxBuffer: 1024, timeoutMs: 1000 }
    );

    assert.strictEqual(result.status, 3);
    assert.strictEqual(result.stderr.toString(), 'failed');
    assert.strictEqual(result.error, undefined);
  });

  test('terminates a tool that exceeds its timeout', async () => {
    const result = await spawnTool(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 1000)'],
      { maxBuffer: 1024, timeoutMs: 20 }
    );

    assert.match(result.error?.message ?? '', /timed out after 20 ms/);
  });

  test('terminates a tool that exceeds the stdout limit', async () => {
    const result = await spawnTool(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(2048))'],
      { maxBuffer: 128, timeoutMs: 1000 }
    );

    assert.match(result.error?.message ?? '', /stdout exceeded 128 bytes/);
  });

  test('terminates a tool that exceeds the stderr limit', async () => {
    const result = await spawnTool(
      process.execPath,
      ['-e', 'process.stderr.write("x".repeat(2048))'],
      { maxBuffer: 128, timeoutMs: 1000 }
    );

    assert.match(result.error?.message ?? '', /stderr exceeded 128 bytes/);
  });

  test('does not start a tool when cancellation already occurred', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await spawnTool(
      process.execPath,
      ['-e', 'process.stdout.write("unexpected")'],
      { maxBuffer: 1024, timeoutMs: 1000, signal: controller.signal }
    );

    assert.ok(result.error instanceof AnalysisCancelledError);
    assert.strictEqual(result.stdout.length, 0);
  });

  test('terminates a running tool when analysis is cancelled', async () => {
    const controller = new AbortController();
    const resultPromise = spawnTool(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 1000)'],
      {
        maxBuffer: 1024,
        timeoutMs: 1000,
        signal: controller.signal,
      }
    );
    setTimeout(() => controller.abort(), 20);

    const result = await resultPromise;

    assert.ok(result.error instanceof AnalysisCancelledError);
  });

  test('reports a missing executable without rejecting the runner promise', async () => {
    const result = await spawnTool(
      `definitely-missing-tool-${Date.now()}`,
      [],
      { maxBuffer: 1024, timeoutMs: 1000 }
    );

    assert.strictEqual(result.status, null);
    assert.ok(result.error instanceof Error);
  });
});
