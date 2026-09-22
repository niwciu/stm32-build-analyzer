import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDefaultAnalysisOrchestrator } from '../analysis/AnalysisOrchestrator';
import { IarAdapter } from '../toolchains/iar/IarAdapter';
import { IarMapParser } from '../toolchains/iar/IarMapParser';
import { AnalysisCancelledError } from '../utils/errors';
import {
  loadToolchainFixtures,
  ToolchainFixture,
} from './fixtures/fixtureLoader';

const fixtures = loadToolchainFixtures().filter(candidate =>
  candidate.manifest.toolchain === 'iar-arm'
  && candidate.manifest.kind === 'analysis'
);
if (fixtures.length !== 2) {
  throw new Error('Missing IAR real or synthetic analysis fixture');
}

suite('IarAdapter', () => {
  let temporaryDirectory: string;
  let executablePath: string;

  setup(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'iar-adapter-'));
    executablePath = path.join(temporaryDirectory, 'firmware.out');
    fs.writeFileSync(executablePath, Buffer.from('ELF\0test-validation-input'));
  });

  teardown(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  for (const fixture of fixtures) {
    test(`produces expected analysis for ${fixture.manifest.id}`, async () => {
      const analysis = await new IarAdapter().analyze(artifactSet(fixture));
      const expected = fixture.expected as ExpectedMapAnalysis;

      assert.deepStrictEqual(analysis.regions, expected.regions);
      assert.strictEqual(analysis.warnings.length, expected.warningCount);
      assert.deepStrictEqual(analysis.provenance.toolInvocations, []);
      assert.match(analysis.provenance.notes[0], /no proprietary executable/i);
    });
  }

  test('requires no proprietary tools for MAP analysis', async () => {
    const validation = await new IarAdapter().validateEnvironment(
      artifactSet(fixtures[0])
    );

    assert.deepStrictEqual(validation, {
      status: 'valid',
      tools: [],
      diagnostics: [],
    });
  });

  test('rejects symbolic placement ranges rather than guessing capacities', () => {
    const mapPath = path.join(temporaryDirectory, 'symbolic.map');
    fs.writeFileSync(mapPath, [
      'IAR ELF Linker for Arm V9.50.1',
      'PLACEMENT SUMMARY',
      '"ROM": place in [from ROM_START to ROM_END] { readonly };',
      'MODULE SUMMARY',
    ].join('\n'));

    assert.throws(
      () => new IarMapParser().parseFile(mapPath),
      /No numeric ILINK placement ranges/
    );
  });

  test('rejects unverified ILINK versions', () => {
    const mapPath = path.join(temporaryDirectory, 'unverified.map');
    fs.writeFileSync(mapPath, [
      'IAR ELF Linker for Arm V8.50.1',
      'PLACEMENT SUMMARY',
      '"ROM": place in [from 0x0 to 0xff] { readonly };',
    ].join('\n'));

    assert.throws(
      () => new IarMapParser().parseFile(mapPath),
      /not a supported IAR ILINK/
    );
  });

  test('preserves cancellation without parsing the MAP', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      new IarAdapter().analyze(artifactSet(fixtures[0]), controller.signal),
      AnalysisCancelledError
    );
  });

  test('default orchestrator detects and analyzes the real ILINK 7 MAP', async () => {
    const realFixture = fixtures.find(fixture =>
      fixture.manifest.origin.type === 'real'
    );
    assert.ok(realFixture);

    const result = await createDefaultAnalysisOrchestrator({
      toolchainPath: '',
    }).analyze(artifactSet(realFixture));

    assert.strictEqual(result.status, 'partial');
    if (result.status !== 'partial') {
      assert.fail('Expected partial IAR analysis result');
    }
    assert.strictEqual(result.detection.toolchainId, 'iar-arm');
    assert.strictEqual(result.analysis.toolchain.id, 'iar-arm');
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
