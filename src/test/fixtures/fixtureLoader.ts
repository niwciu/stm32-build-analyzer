import * as fs from 'fs';
import * as path from 'path';

export type FixtureKind = 'analysis' | 'detection';
export type FixtureOriginType = 'synthetic' | 'real';

export interface FixtureOrigin {
  type: FixtureOriginType;
  documentation: string[];
  notes: string;
  compilerVersion?: string;
  targetArchitecture?: string;
  buildFlags?: string[];
  sourceLicense?: string;
  artifactLicense?: string;
  provenance?: string;
  generationCommand?: string;
}

export interface ToolchainFixtureManifest {
  schemaVersion: 1;
  id: string;
  toolchain: string;
  kind: FixtureKind;
  origin: FixtureOrigin;
  inputs: Record<string, string>;
  expected: string;
  ignored: string[];
}

export interface ToolchainFixture {
  caseDirectory: string;
  manifestPath: string;
  manifest: ToolchainFixtureManifest;
  inputPaths: Record<string, string>;
  expectedPath: string;
  expected: unknown;
}

export class FixtureValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureValidationError';
  }
}

export const TOOLCHAIN_FIXTURE_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'test',
  'fixtures',
  'toolchains'
);

export function loadToolchainFixtures(
  root: string = TOOLCHAIN_FIXTURE_ROOT
): ToolchainFixture[] {
  const manifestPaths = discoverManifestPaths(root);
  const fixtures = manifestPaths.map(manifestPath => loadFixture(manifestPath, root));
  const ids = new Map<string, string>();

  for (const fixture of fixtures) {
    const previous = ids.get(fixture.manifest.id);
    if (previous) {
      throw new FixtureValidationError(
        `Duplicate fixture id "${fixture.manifest.id}" in "${previous}" and `
        + `"${fixture.manifestPath}".`
      );
    }
    ids.set(fixture.manifest.id, fixture.manifestPath);
  }

  return fixtures.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

function discoverManifestPaths(root: string): string[] {
  let toolchainEntries: fs.Dirent[];
  try {
    toolchainEntries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    throw new FixtureValidationError(
      `Cannot read toolchain fixture root "${root}": ${errorMessage(error)}`
    );
  }

  const expectedManifests: string[] = [];
  for (const toolchainEntry of sortedEntries(toolchainEntries)) {
    const toolchainPath = path.join(root, toolchainEntry.name);
    if (!toolchainEntry.isDirectory() || toolchainEntry.isSymbolicLink()) {
      throw new FixtureValidationError(
        `Fixture root may contain only toolchain directories; found "${toolchainPath}".`
      );
    }

    const caseEntries = fs.readdirSync(toolchainPath, { withFileTypes: true });
    for (const caseEntry of sortedEntries(caseEntries)) {
      const casePath = path.join(toolchainPath, caseEntry.name);
      if (!caseEntry.isDirectory() || caseEntry.isSymbolicLink()) {
        throw new FixtureValidationError(
          `Toolchain fixture directory "${toolchainPath}" may contain only case `
          + `directories; found "${casePath}".`
        );
      }

      const manifestPath = path.join(casePath, 'fixture.json');
      if (!isRegularFile(manifestPath)) {
        throw new FixtureValidationError(
          `Fixture case directory "${casePath}" is missing fixture.json.`
        );
      }
      expectedManifests.push(manifestPath);
    }
  }

  const recursivelyDiscovered = findFilesNamed(root, 'fixture.json');
  const expected = new Set(expectedManifests.map(file => path.normalize(file)));
  for (const manifestPath of recursivelyDiscovered) {
    if (!expected.has(path.normalize(manifestPath))) {
      throw new FixtureValidationError(
        `fixture.json must belong to an immediate case directory: "${manifestPath}".`
      );
    }
  }

  return expectedManifests.sort((a, b) => a.localeCompare(b));
}

function loadFixture(manifestPath: string, root: string): ToolchainFixture {
  const caseDirectory = path.dirname(manifestPath);
  const parentToolchain = path.basename(path.dirname(caseDirectory));
  const manifest = parseManifest(readJson(manifestPath), manifestPath);

  if (manifest.toolchain !== parentToolchain) {
    throw new FixtureValidationError(
      `Fixture "${manifest.id}" declares toolchain "${manifest.toolchain}" but `
      + `its parent directory is "${parentToolchain}".`
    );
  }

  const expectedCaseDirectory = path.dirname(path.dirname(manifestPath));
  if (path.dirname(expectedCaseDirectory) !== path.resolve(root)) {
    throw new FixtureValidationError(
      `Fixture manifest must be exactly one case directory below its toolchain: `
      + `"${manifestPath}".`
    );
  }

  const declaredFiles = new Set<string>(['fixture.json']);
  const inputPaths: Record<string, string> = {};
  for (const [name, relativePath] of Object.entries(manifest.inputs)) {
    const normalized = normalizeDeclaredPath(relativePath, manifestPath);
    assertUniqueDeclaration(declaredFiles, normalized, manifestPath);
    const inputPath = resolveCasePath(caseDirectory, normalized);
    if (!isRegularFile(inputPath)) {
      throw new FixtureValidationError(
        `Fixture "${manifest.id}" declares missing input "${relativePath}" `
        + `for inputs.${name}.`
      );
    }
    inputPaths[name] = inputPath;
  }

  const expectedRelativePath = normalizeDeclaredPath(manifest.expected, manifestPath);
  assertUniqueDeclaration(declaredFiles, expectedRelativePath, manifestPath);
  const expectedPath = resolveCasePath(caseDirectory, expectedRelativePath);
  if (!isRegularFile(expectedPath)) {
    throw new FixtureValidationError(
      `Fixture "${manifest.id}" declares missing expected result `
      + `"${manifest.expected}".`
    );
  }

  for (const ignoredPath of manifest.ignored) {
    const normalized = normalizeDeclaredPath(ignoredPath, manifestPath);
    assertUniqueDeclaration(declaredFiles, normalized, manifestPath);
    const resolved = resolveCasePath(caseDirectory, normalized);
    if (!isRegularFile(resolved)) {
      throw new FixtureValidationError(
        `Fixture "${manifest.id}" ignores missing file "${ignoredPath}".`
      );
    }
  }

  const actualFiles = listCaseFiles(caseDirectory);
  const undeclared = actualFiles.filter(file => !declaredFiles.has(file));
  if (undeclared.length > 0) {
    throw new FixtureValidationError(
      `Fixture "${manifest.id}" contains undeclared file(s): ${undeclared.join(', ')}.`
    );
  }

  return {
    caseDirectory,
    manifestPath,
    manifest,
    inputPaths,
    expectedPath,
    expected: readJson(expectedPath),
  };
}

function parseManifest(value: unknown, manifestPath: string): ToolchainFixtureManifest {
  const manifest = requireObject(value, `Manifest "${manifestPath}"`);
  if (manifest.schemaVersion !== 1) {
    throw new FixtureValidationError(
      `Manifest "${manifestPath}" has unsupported schemaVersion `
      + `"${String(manifest.schemaVersion)}"; expected 1.`
    );
  }

  const id = requireString(manifest.id, 'id', manifestPath);
  const toolchain = requireString(manifest.toolchain, 'toolchain', manifestPath);
  const kind = manifest.kind;
  if (kind !== 'analysis' && kind !== 'detection') {
    throw new FixtureValidationError(
      `Manifest "${manifestPath}" has unknown fixture kind "${String(kind)}".`
    );
  }

  const origin = parseOrigin(manifest.origin, manifestPath);
  const rawInputs = requireObject(manifest.inputs, `Manifest "${manifestPath}" inputs`);
  const inputs: Record<string, string> = {};
  for (const [name, inputPath] of Object.entries(rawInputs)) {
    if (name.trim().length === 0) {
      throw new FixtureValidationError(
        `Manifest "${manifestPath}" contains an empty input name.`
      );
    }
    inputs[name] = requireString(inputPath, `inputs.${name}`, manifestPath);
  }
  if (Object.keys(inputs).length === 0) {
    throw new FixtureValidationError(
      `Manifest "${manifestPath}" must declare at least one input.`
    );
  }

  if (typeof manifest.expected !== 'string' || manifest.expected.trim().length === 0) {
    const expectedType = kind === 'analysis' ? 'analysis' : 'detection';
    throw new FixtureValidationError(
      `${kind === 'analysis' ? 'Analysis' : 'Detection'} fixture "${id}" must `
      + `declare an expected ${expectedType} file.`
    );
  }

  const ignored = manifest.ignored === undefined
    ? []
    : requireStringArray(manifest.ignored, 'ignored', manifestPath, false);

  return {
    schemaVersion: 1,
    id,
    toolchain,
    kind,
    origin,
    inputs,
    expected: manifest.expected,
    ignored,
  };
}

function parseOrigin(value: unknown, manifestPath: string): FixtureOrigin {
  const origin = requireObject(value, `Manifest "${manifestPath}" origin`);
  if (origin.type !== 'synthetic' && origin.type !== 'real') {
    throw new FixtureValidationError(
      `Manifest "${manifestPath}" has unknown origin type "${String(origin.type)}".`
    );
  }

  const parsed: FixtureOrigin = {
    type: origin.type,
    documentation: requireStringArray(
      origin.documentation,
      'origin.documentation',
      manifestPath,
      true
    ),
    notes: requireString(origin.notes, 'origin.notes', manifestPath),
  };

  if (origin.type === 'real') {
    parsed.compilerVersion = requireString(
      origin.compilerVersion,
      'origin.compilerVersion',
      manifestPath
    );
    parsed.targetArchitecture = requireString(
      origin.targetArchitecture,
      'origin.targetArchitecture',
      manifestPath
    );
    parsed.buildFlags = requireStringArray(
      origin.buildFlags,
      'origin.buildFlags',
      manifestPath,
      false
    );
    parsed.sourceLicense = requireString(
      origin.sourceLicense,
      'origin.sourceLicense',
      manifestPath
    );
    parsed.artifactLicense = requireString(
      origin.artifactLicense,
      'origin.artifactLicense',
      manifestPath
    );
    parsed.provenance = requireString(
      origin.provenance,
      'origin.provenance',
      manifestPath
    );
    parsed.generationCommand = requireString(
      origin.generationCommand,
      'origin.generationCommand',
      manifestPath
    );
  }

  return parsed;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FixtureValidationError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string, manifestPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FixtureValidationError(
      `Manifest "${manifestPath}" field ${field} must be a non-empty string.`
    );
  }
  return value;
}

function requireStringArray(
  value: unknown,
  field: string,
  manifestPath: string,
  requireEntry: boolean
): string[] {
  if (!Array.isArray(value) || (requireEntry && value.length === 0)) {
    throw new FixtureValidationError(
      `Manifest "${manifestPath}" field ${field} must be `
      + `${requireEntry ? 'a non-empty' : 'an'} array of strings.`
    );
  }
  return value.map((entry, index) =>
    requireString(entry, `${field}[${index}]`, manifestPath)
  );
}

function normalizeDeclaredPath(value: string, manifestPath: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (
    path.posix.isAbsolute(normalized)
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized === 'fixture.json'
  ) {
    throw new FixtureValidationError(
      `Manifest "${manifestPath}" contains invalid case-relative path "${value}".`
    );
  }
  return normalized;
}

function resolveCasePath(caseDirectory: string, relativePath: string): string {
  return path.join(caseDirectory, ...relativePath.split('/'));
}

function assertUniqueDeclaration(
  declaredFiles: Set<string>,
  relativePath: string,
  manifestPath: string
): void {
  if (declaredFiles.has(relativePath)) {
    throw new FixtureValidationError(
      `Manifest "${manifestPath}" declares "${relativePath}" more than once.`
    );
  }
  declaredFiles.add(relativePath);
}

function listCaseFiles(directory: string, relativeDirectory: string = ''): string[] {
  const entries = sortedEntries(fs.readdirSync(directory, { withFileTypes: true }));
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new FixtureValidationError(
        `Fixture cases may not contain symbolic links: "${fullPath}".`
      );
    }
    if (entry.isDirectory()) {
      files.push(...listCaseFiles(fullPath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new FixtureValidationError(
        `Fixture case contains unsupported filesystem entry: "${fullPath}".`
      );
    }
  }
  return files;
}

function findFilesNamed(directory: string, fileName: string): string[] {
  const entries = sortedEntries(fs.readdirSync(directory, { withFileTypes: true }));
  const matches: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      matches.push(...findFilesNamed(fullPath, fileName));
    } else if (entry.isFile() && entry.name === fileName) {
      matches.push(fullPath);
    }
  }
  return matches;
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new FixtureValidationError(
      `Cannot read JSON file "${filePath}": ${errorMessage(error)}`
    );
  }
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function sortedEntries(entries: fs.Dirent[]): fs.Dirent[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
