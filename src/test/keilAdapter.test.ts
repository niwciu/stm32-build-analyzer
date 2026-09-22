import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDefaultAnalysisOrchestrator } from '../analysis/AnalysisOrchestrator';
import { AnalysisCancelledError } from '../utils/errors';
import { KeilAdapter } from '../toolchains/keil/KeilAdapter';
import { KeilMapParser } from '../toolchains/keil/KeilMapParser';
import {
  loadToolchainFixtures,
  ToolchainFixture,
} from './fixtures/fixtureLoader';

const fixtures = loadToolchainFixtures().filter(candidate =>
  candidate.manifest.toolchain === 'keil-armclang'
  && candidate.manifest.kind === 'analysis'
);
if (fixtures.length !== 2) {
  throw new Error('Missing Keil real or synthetic analysis fixture');
}

suite('KeilAdapter', () => {
  let temporaryDirectory: string;
  let executablePath: string;

  setup(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'keil-adapter-'));
    executablePath = path.join(temporaryDirectory, 'firmware.axf');
    fs.writeFileSync(executablePath, Buffer.from('ELF\0test-validation-input'));
  });

  teardown(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  for (const fixture of fixtures) {
    test(`produces expected analysis for ${fixture.manifest.id}`, async () => {
      const analysis = await new KeilAdapter().analyze(artifactSet(fixture));
      const expected = fixture.expected as ExpectedMapAnalysis;

      assert.deepStrictEqual(analysis.regions, expected.regions);
      assert.strictEqual(analysis.warnings.length, expected.warningCount);
      assert.deepStrictEqual(analysis.provenance.toolInvocations, []);
      assert.match(analysis.provenance.notes[0], /no proprietary executable/i);
    });
  }

  test('requires no proprietary tools for MAP analysis', async () => {
    const validation = await new KeilAdapter().validateEnvironment(
      artifactSet(fixtures[0])
    );

    assert.deepStrictEqual(validation, {
      status: 'valid',
      tools: [],
      diagnostics: [],
    });
  });

  test('rejects unverified armlink versions', () => {
    const mapPath = path.join(temporaryDirectory, 'future.map');
    fs.writeFileSync(mapPath, [
      'ARM Linker, 5.07',
      'Memory Map of the image',
      'Execution Region ROM (Base: 0x0, Size: 0x1, Max: 0x10)',
    ].join('\n'));

    assert.throws(
      () => new KeilMapParser().parseFile(mapPath),
      /not a supported Arm Compiler 5\.06 or 6\.21/
    );
  });

  test('preserves cancellation without parsing the MAP', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      new KeilAdapter().analyze(artifactSet(fixtures[0]), controller.signal),
      AnalysisCancelledError
    );
  });

  test('default orchestrator detects and analyzes the real Arm Compiler 5 MAP', async () => {
    const realFixture = fixtures.find(fixture =>
      fixture.manifest.origin.type === 'real'
    );
    assert.ok(realFixture);

    const result = await createDefaultAnalysisOrchestrator({
      toolchainPath: '',
    }).analyze(artifactSet(realFixture));

    assert.strictEqual(result.status, 'partial');
    if (result.status !== 'partial') {
      assert.fail('Expected partial Keil analysis result');
    }
    assert.strictEqual(result.detection.toolchainId, 'keil-armclang');
    assert.strictEqual(result.analysis.toolchain.id, 'keil-armclang');
  });

  function artifactSet(fixture: ToolchainFixture) {
    return {
      mapPath: fixture.inputPaths.map,
      executablePath,
      linkerScriptPaths: [],
      workspaceFolder: fixture.caseDirectory,
    };
  }
});

interface ExpectedMapAnalysis {
  readonly regions: unknown;
  readonly warningCount: number;
}
