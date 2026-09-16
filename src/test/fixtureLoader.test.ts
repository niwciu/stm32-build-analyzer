import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FixtureValidationError,
  loadToolchainFixtures,
  TOOLCHAIN_FIXTURE_ROOT,
} from './fixtures/fixtureLoader';

const discoveredFixtures = loadToolchainFixtures();

suite('toolchain fixture conformance', () => {
  test('fixture root is the source tree, not compiler output', () => {
    assert.strictEqual(
      TOOLCHAIN_FIXTURE_ROOT,
      path.resolve(process.cwd(), 'src', 'test', 'fixtures', 'toolchains')
    );
  });

  for (const fixture of discoveredFixtures) {
    test(`loads ${fixture.manifest.id}`, () => {
      assert.ok(fs.statSync(fixture.manifestPath).isFile());
      assert.ok(fs.statSync(fixture.expectedPath).isFile());
      assert.strictEqual(
        Object.keys(fixture.inputPaths).length,
        Object.keys(fixture.manifest.inputs).length
      );
      assert.ok(fixture.expected && typeof fixture.expected === 'object');
      assert.ok(fixture.manifest.origin.documentation.length > 0);
      assert.ok(fixture.manifest.origin.notes.length > 0);
    });
  }
});

suite('toolchain fixture validation', () => {
  let root: string;

  setup(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-analyzer-fixtures-'));
  });

  teardown(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('rejects an immediate case directory without a manifest', () => {
    fs.mkdirSync(path.join(root, 'gnu-arm-none-eabi', 'missing-manifest'), {
      recursive: true,
    });

    assertFixtureError(() => loadToolchainFixtures(root), /missing fixture\.json/);
  });

  test('rejects files not declared by the manifest', () => {
    const caseDirectory = writeValidCase(root);
    fs.writeFileSync(path.join(caseDirectory, 'undeclared.bin'), 'data');

    assertFixtureError(() => loadToolchainFixtures(root), /undeclared\.bin/);
  });

  test('accepts files explicitly ignored by the manifest', () => {
    const manifest = validManifest();
    manifest.ignored = ['fixture-notes.md'];
    const caseDirectory = writeCase(root, manifest);
    fs.writeFileSync(path.join(caseDirectory, 'fixture-notes.md'), 'notes');

    assert.strictEqual(loadToolchainFixtures(root).length, 1);
  });

  test('rejects a declared input that is missing', () => {
    const caseDirectory = writeValidCase(root);
    fs.rmSync(path.join(caseDirectory, 'firmware.map'));

    assertFixtureError(() => loadToolchainFixtures(root), /declares missing input/);
  });

  test('rejects duplicate fixture IDs', () => {
    writeCase(root, validManifest(), 'gnu-arm-none-eabi', 'first');
    writeCase(root, validManifest(), 'gnu-arm-none-eabi', 'second');

    assertFixtureError(() => loadToolchainFixtures(root), /Duplicate fixture id/);
  });

  test('rejects a toolchain that differs from the parent directory', () => {
    const manifest = validManifest();
    manifest.toolchain = 'llvm';
    writeCase(root, manifest);

    assertFixtureError(() => loadToolchainFixtures(root), /parent directory/);
  });

  test('rejects an analysis fixture without expected analysis', () => {
    const manifest = validManifest();
    delete manifest.expected;
    writeCase(root, manifest);

    assertFixtureError(
      () => loadToolchainFixtures(root),
      /declare an expected analysis file/
    );
  });

  test('rejects a detection fixture without expected detection', () => {
    const manifest = validManifest();
    manifest.kind = 'detection';
    delete manifest.expected;
    writeCase(root, manifest);

    assertFixtureError(
      () => loadToolchainFixtures(root),
      /declare an expected detection file/
    );
  });

  test('rejects an unknown fixture kind', () => {
    const manifest = validManifest();
    manifest.kind = 'unsupported-kind';
    writeCase(root, manifest);

    assertFixtureError(() => loadToolchainFixtures(root), /unknown fixture kind/);
  });

  test('rejects unsupported manifest schema versions', () => {
    const manifest = validManifest();
    manifest.schemaVersion = 2;
    writeCase(root, manifest);

    assertFixtureError(() => loadToolchainFixtures(root), /unsupported schemaVersion/);
  });

  test('rejects paths that leave the case directory', () => {
    const manifest = validManifest();
    manifest.inputs = { map: '../firmware.map' };
    writeCase(root, manifest);

    assertFixtureError(() => loadToolchainFixtures(root), /invalid case-relative path/);
  });

  test('rejects synthetic fixtures without documentation provenance', () => {
    const manifest = validManifest();
    const origin = manifest.origin as Record<string, unknown>;
    origin.documentation = [];
    writeCase(root, manifest);

    assertFixtureError(() => loadToolchainFixtures(root), /non-empty array of strings/);
  });
});

function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'test-fixture',
    toolchain: 'gnu-arm-none-eabi',
    kind: 'analysis',
    origin: {
      type: 'synthetic',
      documentation: ['GNU Binutils documentation'],
      notes: 'Synthetic test data.',
    },
    inputs: {
      map: 'firmware.map',
    },
    expected: 'expected-analysis.json',
  };
}

function writeValidCase(root: string): string {
  return writeCase(root, validManifest());
}

function writeCase(
  root: string,
  manifest: Record<string, unknown>,
  toolchain: string = 'gnu-arm-none-eabi',
  caseName: string = 'case'
): string {
  const caseDirectory = path.join(root, toolchain, caseName);
  fs.mkdirSync(caseDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(caseDirectory, 'fixture.json'),
    JSON.stringify(manifest),
    'utf8'
  );
  fs.writeFileSync(path.join(caseDirectory, 'firmware.map'), 'Memory Configuration');
  fs.writeFileSync(path.join(caseDirectory, 'expected-analysis.json'), '{}');
  return caseDirectory;
}

function assertFixtureError(fn: () => unknown, pattern: RegExp): void {
  assert.throws(fn, error => {
    assert.ok(error instanceof FixtureValidationError);
    assert.match(error.message, pattern);
    return true;
  });
}
