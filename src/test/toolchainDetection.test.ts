import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BuildArtifactSet } from '../artifacts/BuildArtifactSet';
import {
  ArtifactInspectionError,
  FileArtifactInspector,
} from '../artifacts/ArtifactInspector';
import { parseElfMetadata } from '../artifacts/ElfMetadata';
import {
  createDefaultDetectionRegistry,
  createDefaultDetectors,
  DetectionRegistry,
} from '../analysis/DetectionRegistry';
import type {
  DetectionEvidence,
  KnownToolchainId,
  ToolchainDetection,
  ToolchainDetector,
} from '../analysis/contracts';
import { ANALYSIS_DIAGNOSTIC_CODES } from '../analysis/diagnostics';
import type { ToolAvailabilityProbe } from '../toolchains/detection/EvidenceBasedDetector';
import { AnalysisCancelledError } from '../utils/errors';
import {
  loadToolchainFixtures,
  ToolchainFixture,
} from './fixtures/fixtureLoader';

interface ExpectedDetection {
  readonly status: 'detected' | 'unknown' | 'ambiguous';
  readonly toolchainId?: KnownToolchainId;
  readonly toolchainIds?: readonly KnownToolchainId[];
  readonly minimumConfidence?: number;
  readonly requiredEvidenceSources?: readonly string[];
}

const detectionFixtures = loadToolchainFixtures().filter(fixture =>
  fixture.manifest.kind === 'detection'
);
const positiveFixtures = detectionFixtures.filter(fixture =>
  expectedDetection(fixture).status === 'detected'
);

suite('toolchain detection fixtures', () => {
  for (const fixture of detectionFixtures) {
    test(`detects ${fixture.manifest.id}`, async () => {
      const expected = expectedDetection(fixture);
      const report = await createDefaultDetectionRegistry().detect(
        artifactsFor(fixture)
      );

      assert.strictEqual(report.status, expected.status);
      if (report.status === 'detected') {
        assert.strictEqual(report.detection.toolchainId, expected.toolchainId);
        assert.ok(
          report.detection.confidence >= (expected.minimumConfidence ?? 0)
        );
        for (const source of expected.requiredEvidenceSources ?? []) {
          assert.ok(report.detection.evidence.some(item => item.source === source));
        }
      } else if (report.status === 'ambiguous') {
        const qualifyingIds = report.detections
          .filter(detection => detection.confidence >= 0.6)
          .map(detection => detection.toolchainId);
        assert.deepStrictEqual(qualifyingIds, expected.toolchainIds);
      }
    });
  }

  for (const fixture of positiveFixtures) {
    test(`isolates ${fixture.manifest.id} from competing detectors`, async () => {
      const expected = expectedDetection(fixture);
      const detections = await Promise.all(createDefaultDetectors().map(detector =>
        detector.detect(artifactsFor(fixture))
      ));

      for (const detection of detections) {
        if (detection && detection.toolchainId === expected.toolchainId) {
          assert.ok(detection.confidence >= 0.6);
        } else {
          assert.ok(!detection || detection.confidence < 0.6);
        }
      }
    });
  }

  test('all detectors reject generic and malformed negative fixtures', async () => {
    const negatives = detectionFixtures.filter(fixture =>
      expectedDetection(fixture).status === 'unknown'
    );

    for (const fixture of negatives) {
      for (const detector of createDefaultDetectors()) {
        const detection = await detector.detect(artifactsFor(fixture));
        assert.ok(
          !detection || detection.confidence < 0.6,
          `${detector.toolchainId} accepted ${fixture.manifest.id}`
        );
      }
    }
  });

  test('existing GNU Arm analysis fixtures remain detectable', async () => {
    const fixtures = loadToolchainFixtures().filter(fixture =>
      fixture.manifest.kind === 'analysis'
      && fixture.manifest.toolchain === 'gnu-arm-none-eabi'
    );

    for (const fixture of fixtures) {
      const report = await createDefaultDetectionRegistry().detect(
        artifactsFor(fixture)
      );
      assert.strictEqual(report.status, 'detected');
      assert.strictEqual(report.detection.toolchainId, 'gnu-arm-none-eabi');
    }
  });
});

suite('detection evidence policy', () => {
  test('combines a generic GNU MAP with EM_ARM ELF metadata', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gnu-arm-detection-'));
    const mapPath = path.join(directory, 'firmware.map');
    const executablePath = path.join(directory, 'firmware.elf');
    fs.writeFileSync(
      mapPath,
      'Memory Configuration\nFLASH 0x08000000 0x1000\nLinker script and memory map\n',
      'utf8'
    );
    fs.writeFileSync(executablePath, elfHeader(40));

    try {
      const report = await createDefaultDetectionRegistry().detect({
        mapPath,
        executablePath,
        linkerScriptPaths: [],
      });
      assert.strictEqual(report.status, 'detected');
      assert.strictEqual(report.detection.toolchainId, 'gnu-arm-none-eabi');
      assert.ok(report.detection.evidence.some(evidence =>
        evidence.source === 'elf-metadata'
      ));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('does not select GNU Arm from EM_ARM metadata alone', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gnu-arm-detection-'));
    const executablePath = path.join(directory, 'firmware.elf');
    fs.writeFileSync(executablePath, elfHeader(40));

    try {
      const report = await createDefaultDetectionRegistry().detect({
        executablePath,
        linkerScriptPaths: [],
      });
      assert.strictEqual(report.status, 'unknown');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('configured and available tools cannot decide a toolchain alone', async () => {
    const toolAvailability: ToolAvailabilityProbe = {
      isAvailable: async () => true,
    };
    const registry = createDefaultDetectionRegistry({
      configuredToolNames: [
        'arm-none-eabi-objdump',
        'riscv-none-elf-objdump',
        'xtensa-elf-objdump',
        'ld.lld',
        'armlink',
        'ilinkarm',
      ],
      toolAvailability,
    });

    const report = await registry.detect({
      executablePath: '/build/firmware.axf',
      linkerScriptPaths: [],
    });

    assert.strictEqual(report.status, 'unknown');
    assert.ok(report.detections.length > 0);
    assert.ok(report.detections.every(detection => detection.confidence < 0.6));
    assert.ok(report.detections.some(detection =>
      detection.evidence.some(item => item.source === 'available-tool')
    ));
  });

  test('emits deterministic debug traces with evidence and scores', async () => {
    const traces: string[] = [];
    const fixture = positiveFixtures.find(candidate =>
      candidate.manifest.toolchain === 'llvm'
    );
    assert.ok(fixture);
    const registry = createDefaultDetectionRegistry({}, {
      debugLogger: message => traces.push(message),
    });

    await registry.detect(artifactsFor(fixture));

    assert.strictEqual(traces.length, 6);
    assert.deepStrictEqual(
      traces.map(trace => trace.match(/\] ([^:]+):/)?.[1]),
      [...traces].map(trace => trace.match(/\] ([^:]+):/)?.[1]).sort()
    );
    assert.ok(traces.some(trace =>
      trace.includes('llvm: confidence') && trace.includes('file-content')
    ));
  });
});

suite('detection registry ranking', () => {
  const artifacts: BuildArtifactSet = { linkerScriptPaths: [] };

  test('sorts equal scores by toolchain ID and reports ambiguity', async () => {
    const registry = new DetectionRegistry([
      fixedDetector('iar-arm', 0.8),
      fixedDetector('gnu-arm-none-eabi', 0.8),
    ]);

    const report = await registry.detect(artifacts);

    assert.strictEqual(report.status, 'ambiguous');
    assert.deepStrictEqual(
      report.detections.map(detection => detection.toolchainId),
      ['gnu-arm-none-eabi', 'iar-arm']
    );
    assert.strictEqual(
      report.diagnostics.at(-1)?.code,
      ANALYSIS_DIAGNOSTIC_CODES.TOOLCHAIN_AMBIGUOUS
    );
  });

  test('selects a qualifying leader outside the ambiguity window', async () => {
    const registry = new DetectionRegistry([
      fixedDetector('gnu-arm-none-eabi', 0.91),
      fixedDetector('llvm', 0.7),
    ]);

    const report = await registry.detect(artifacts);

    assert.strictEqual(report.status, 'detected');
    assert.strictEqual(report.detection.toolchainId, 'gnu-arm-none-eabi');
  });

  test('rejects duplicate detector IDs and invalid thresholds', () => {
    assert.throws(() => new DetectionRegistry([
      fixedDetector('llvm', 0.8),
      fixedDetector('llvm', 0.7),
    ]), /Duplicate detector/);
    assert.throws(
      () => new DetectionRegistry([], { minimumConfidence: 1.1 }),
      /minimumConfidence/
    );
  });

  test('deduplicates artifact-read diagnostics from all detectors', async () => {
    const missingPath = path.join(os.tmpdir(), `missing-map-${Date.now()}.map`);
    const report = await createDefaultDetectionRegistry().detect({
      mapPath: missingPath,
      linkerScriptPaths: [],
    });

    assert.strictEqual(report.status, 'unknown');
    assert.strictEqual(
      report.diagnostics.filter(diagnostic =>
        diagnostic.code === ANALYSIS_DIAGNOSTIC_CODES.ARTIFACT_UNREADABLE
      ).length,
      1
    );
  });

  test('preserves cancellation', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      createDefaultDetectionRegistry().detect(artifacts, controller.signal),
      AnalysisCancelledError
    );
  });
});

suite('file artifact inspector', () => {
  test('reads text without modifying it', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-inspector-'));
    const artifactPath = path.join(directory, 'firmware.map');
    fs.writeFileSync(artifactPath, 'producer marker', 'utf8');

    try {
      const before = fs.statSync(artifactPath).mtimeMs;
      const content = await new FileArtifactInspector().readText(artifactPath);
      assert.strictEqual(content, 'producer marker');
      assert.strictEqual(fs.statSync(artifactPath).mtimeMs, before);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('returns a structured error for unreadable artifacts', async () => {
    const artifactPath = path.join(os.tmpdir(), `missing-${Date.now()}.map`);

    await assert.rejects(
      new FileArtifactInspector().readText(artifactPath),
      error => {
        assert.ok(error instanceof ArtifactInspectionError);
        assert.strictEqual(
          error.diagnostic.code,
          ANALYSIS_DIAGNOSTIC_CODES.ARTIFACT_UNREADABLE
        );
        assert.strictEqual(error.diagnostic.artifactPath, artifactPath);
        return true;
      }
    );
  });

  test('reads only the requested binary prefix', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-inspector-'));
    const artifactPath = path.join(directory, 'firmware.elf');
    fs.writeFileSync(artifactPath, Buffer.alloc(128, 0xaa));

    try {
      const content = await new FileArtifactInspector().readBytes(artifactPath, 20);
      assert.strictEqual(content.length, 20);
      assert.ok(content.every(byte => byte === 0xaa));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

suite('ELF metadata parsing', () => {
  test('parses little-endian 32-bit machine metadata', () => {
    assert.deepStrictEqual(parseElfMetadata(elfHeader(40)), {
      machine: 40,
      bitness: 32,
      littleEndian: true,
    });
  });

  test('rejects non-ELF and incomplete headers', () => {
    assert.strictEqual(parseElfMetadata(Buffer.from('not elf')), null);
    assert.strictEqual(parseElfMetadata(Buffer.alloc(19)), null);
  });
});

function artifactsFor(fixture: ToolchainFixture): BuildArtifactSet {
  return {
    mapPath: fixture.inputPaths.map,
    executablePath: fixture.inputPaths.executable,
    linkerScriptPaths: [],
  };
}

function expectedDetection(fixture: ToolchainFixture): ExpectedDetection {
  return fixture.expected as ExpectedDetection;
}

function fixedDetector(
  toolchainId: KnownToolchainId,
  confidence: number
): ToolchainDetector {
  const evidence: DetectionEvidence[] = [{
    source: 'file-content',
    description: `${toolchainId} test evidence`,
    weight: confidence,
  }];
  const detection: ToolchainDetection = {
    toolchainId,
    confidence,
    evidence,
    diagnostics: [],
  };
  return {
    toolchainId,
    detect: async () => detection,
  };
}

function elfHeader(machine: number): Buffer {
  const header = Buffer.alloc(64);
  header.set([0x7f, 0x45, 0x4c, 0x46, 1, 1]);
  header.writeUInt16LE(machine, 18);
  return header;
}
