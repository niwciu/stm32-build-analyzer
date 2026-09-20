import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BuildArtifactSet } from '../../artifacts/BuildArtifactSet';
import type {
  BuildAnalysis,
  EnvironmentTool,
  EnvironmentValidation,
  KnownToolchainId,
  ToolInvocationProvenance,
  ToolchainAdapter,
} from '../../analysis/contracts';
import {
  ANALYSIS_DIAGNOSTIC_CODES,
  AnalysisDiagnostic,
  createAnalysisDiagnostic,
} from '../../analysis/diagnostics';
import {
  spawnTool,
  ToolRunner,
  ToolRunResult,
} from '../../process/ToolRunner';
import {
  ConfiguredDirectoryToolResolver,
  ToolResolver,
} from '../../process/ToolResolver';
import { AnalysisCancelledError } from '../../utils/errors';
import { GnuBinutilsParser, GnuRegion } from './GnuBinutilsParser';
import { GnuLinkerMapParser } from './GnuLinkerMapParser';

const TOOL_TIMEOUT_MS = 30_000;
const OBJDUMP_MAX_BUFFER = 8 * 1024 * 1024;
const NM_MAX_BUFFER = 32 * 1024 * 1024;
const VERSION_MAX_BUFFER = 1024 * 1024;

export interface GnuBinutilsAdapterDefinition {
  readonly displayName: string;
  readonly targetArchitecture: string;
  readonly objdumpTool: string;
  readonly nmTool: string;
  readonly logLabel: string;
  readonly temporaryDirectoryPrefix: string;
}

export interface GnuBinutilsAdapterDependencies {
  readonly toolRunner?: ToolRunner;
  readonly toolResolver?: ToolResolver;
  readonly mapParser?: GnuLinkerMapParser;
  readonly binutilsParser?: GnuBinutilsParser;
}

export type GnuToolchainId = Extract<KnownToolchainId, `gnu-${string}`>;

interface AnalysisContext {
  readonly invocations: ToolInvocationProvenance[];
  readonly notes: string[];
}

interface GnuToolDefinition {
  readonly name: string;
  readonly role: string;
  readonly required: boolean;
}

export class ToolExecutionError extends Error {
  constructor(
    public readonly tool: string,
    public readonly command: string,
    message: string,
    public readonly diagnostic: AnalysisDiagnostic
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

/** Shared GNU linker-map and binutils workflow configured by concrete adapters. */
export abstract class GnuBinutilsAdapter implements ToolchainAdapter {
  abstract readonly toolchainId: GnuToolchainId;
  protected abstract readonly definition: GnuBinutilsAdapterDefinition;

  private readonly toolRunner: ToolRunner;
  private readonly toolResolver: ToolResolver;
  private readonly mapParser: GnuLinkerMapParser;
  private readonly binutilsParser: GnuBinutilsParser;

  protected constructor(
    private readonly toolchainPath: string,
    private readonly debug: boolean = false,
    dependencies: GnuBinutilsAdapterDependencies = {}
  ) {
    this.toolRunner = dependencies.toolRunner ?? spawnTool;
    this.toolResolver = dependencies.toolResolver
      ?? new ConfiguredDirectoryToolResolver(toolchainPath);
    this.mapParser = dependencies.mapParser ?? new GnuLinkerMapParser(debug);
    this.binutilsParser = dependencies.binutilsParser
      ?? new GnuBinutilsParser(debug);
  }

  async validateEnvironment(
    _artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<EnvironmentValidation> {
    throwIfCancelled(signal);
    const tools: EnvironmentTool[] = [];
    const diagnostics: AnalysisDiagnostic[] = [];
    let status: EnvironmentValidation['status'] = 'valid';

    for (const toolDefinition of this.toolDefinitions) {
      const resolution = this.toolResolver.resolve(toolDefinition.name);
      if (
        this.toolchainPath
        && resolution.source === 'path'
        && resolution.configuredCandidate
      ) {
        diagnostics.push(createAnalysisDiagnostic({
          code: ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_PARTIAL,
          severity: 'warning',
          message: `Configured toolchain directory does not contain ${toolDefinition.name}; validation is falling back to PATH.`,
          toolchainId: this.toolchainId,
          artifactPath: resolution.configuredCandidate,
          remediation: 'Install the missing configured binary or correct stm32BuildAnalyzerEnhanced.toolchainPath.',
        }));
      }

      let version: string | undefined;
      try {
        version = firstLine(await this.executeTool(
          toolDefinition.name,
          ['--version'],
          VERSION_MAX_BUFFER,
          signal
        ));
      } catch (error) {
        if (error instanceof AnalysisCancelledError) {
          throw error;
        }
        if (error instanceof ToolExecutionError) {
          diagnostics.push(error.diagnostic);
        } else {
          throw error;
        }
        status = toolDefinition.required
          ? 'invalid'
          : status === 'valid' ? 'partial' : status;
      }

      tools.push({
        name: toolDefinition.name,
        role: toolDefinition.role,
        required: toolDefinition.required,
        resolvedPath: resolution.command,
        version,
      });
    }

    return { status, tools, diagnostics };
  }

  async analyze(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<BuildAnalysis> {
    throwIfCancelled(signal);
    const mapPath = requiredArtifactPath(
      artifacts.mapPath,
      'MAP',
      this.definition.displayName
    );
    const executablePath = requiredArtifactPath(
      artifacts.executablePath,
      'executable',
      this.definition.displayName
    );
    const warnings: AnalysisDiagnostic[] = [];
    const context: AnalysisContext = { invocations: [], notes: [] };

    if (this.debug) {
      console.log(`${this.logPrefix} Parsing map: ${mapPath}`);
      console.log(`${this.logPrefix} Parsing executable: ${executablePath}`);
    }

    const regions: GnuRegion[] = this.mapParser.parseFile(mapPath);
    if (this.debug) {
      console.log(`${this.logPrefix} Regions parsed: ${regions.length}`);
      regions.forEach(region => console.log(
        ` → ${region.name}: ${region.size.toString(16)} bytes at `
        + `0x${region.startAddress.toString(16)}`
      ));
    }

    await this.withExecutableCopy(executablePath, context, async safeExecutable => {
      const objdumpOutput = await this.executeTool(
        this.definition.objdumpTool,
        ['-h', safeExecutable],
        OBJDUMP_MAX_BUFFER,
        signal,
        context,
        ['-h', executablePath]
      );
      this.binutilsParser.parseSections(objdumpOutput, regions);

      try {
        const nmOutput = await this.executeTool(
          this.definition.nmTool,
          ['-C', '-S', '-n', '-l', '--defined-only', safeExecutable],
          NM_MAX_BUFFER,
          signal,
          context,
          ['-C', '-S', '-n', '-l', '--defined-only', executablePath]
        );
        this.binutilsParser.parseSymbols(
          nmOutput,
          regions,
          path.dirname(executablePath)
        );
      } catch (error) {
        if (!(error instanceof ToolExecutionError)
          || error.tool !== this.definition.nmTool) {
          throw error;
        }
        const message = `${error.message} Memory usage is available, but symbol `
          + 'and source details are incomplete.';
        warnings.push(createAnalysisDiagnostic({
          code: ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_PARTIAL,
          severity: 'warning',
          message,
          toolchainId: this.toolchainId,
          artifactPath: executablePath,
          cause: error,
          remediation: error.diagnostic.remediation,
        }));
      }
    });

    return {
      regions,
      toolchain: {
        id: this.toolchainId,
        displayName: this.definition.displayName,
        targetArchitecture: this.definition.targetArchitecture,
      },
      provenance: {
        adapterId: this.toolchainId,
        artifacts,
        toolInvocations: context.invocations,
        notes: context.notes,
      },
      warnings,
    };
  }

  private get toolDefinitions(): readonly GnuToolDefinition[] {
    return [
      {
        name: this.definition.objdumpTool,
        role: 'section-inspector',
        required: true,
      },
      {
        name: this.definition.nmTool,
        role: 'symbol-inspector',
        required: false,
      },
    ];
  }

  private get logPrefix(): string {
    return `[${this.definition.logLabel}]`;
  }

  private async executeTool(
    tool: string,
    arguments_: readonly string[],
    maxBuffer: number,
    signal?: AbortSignal,
    context?: AnalysisContext,
    provenanceArguments: readonly string[] = arguments_
  ): Promise<string> {
    const resolution = this.toolResolver.resolve(tool);
    if (resolution.source === 'configured-directory') {
      if (this.debug) {
        console.log(`${this.logPrefix} Using tool: ${resolution.command}`);
      }
    } else if (this.debug) {
      console.warn(`${this.logPrefix} Falling back to ${tool} from PATH`);
    }

    context?.invocations.push({
      tool,
      executablePath: resolution.command,
      arguments: provenanceArguments,
    });

    let result: ToolRunResult;
    try {
      result = await this.toolRunner(resolution.command, arguments_, {
        maxBuffer,
        timeoutMs: TOOL_TIMEOUT_MS,
        signal,
      });
    } catch (error) {
      throw this.createToolExecutionError(
        tool,
        resolution.command,
        errorMessage(error),
        error
      );
    }

    if (result.error instanceof AnalysisCancelledError) {
      throw result.error;
    }
    if (result.error || result.status !== 0) {
      const reason = result.error?.message
        ?? (result.signal
          ? `terminated by signal ${result.signal}`
          : `exited with code ${result.status ?? 'unknown'}`);
      const stderr = result.stderr.toString().trim().replace(/\s+/g, ' ');
      const details = stderr ? `${reason}; ${stderr.slice(0, 500)}` : reason;
      throw this.createToolExecutionError(
        tool,
        resolution.command,
        details,
        result.error
      );
    }

    return result.stdout.toString();
  }

  private createToolExecutionError(
    tool: string,
    command: string,
    details: string,
    cause?: unknown
  ): ToolExecutionError {
    const guidance = this.toolchainPath
      ? 'Check stm32BuildAnalyzerEnhanced.toolchainPath and the configured toolchain binaries.'
      : `Install ${tool}, add it to PATH, or configure stm32BuildAnalyzerEnhanced.toolchainPath.`;
    const message = `STM32 Build Analyzer: failed to run ${tool} (${command}): `
      + `${details}. ${guidance}`;
    const code = isMissingExecutable(cause)
      ? ANALYSIS_DIAGNOSTIC_CODES.REQUIRED_TOOL_MISSING
      : ANALYSIS_DIAGNOSTIC_CODES.TOOL_EXECUTION_FAILED;

    if (this.debug) {
      console.error(`${this.logPrefix} ${message}`);
    }

    return new ToolExecutionError(
      tool,
      command,
      message,
      createAnalysisDiagnostic({
        code,
        severity: 'error',
        message,
        toolchainId: this.toolchainId,
        cause: cause ?? details,
        remediation: guidance,
      })
    );
  }

  private async withExecutableCopy(
    executablePath: string,
    context: AnalysisContext,
    callback: (safeExecutable: string) => Promise<void>
  ): Promise<void> {
    let tempDirectory: string | undefined;
    let executableForTools = executablePath;

    try {
      tempDirectory = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), this.definition.temporaryDirectoryPrefix)
      );
      const destination = path.join(tempDirectory, path.basename(executablePath));
      await fs.promises.writeFile(
        destination,
        await fs.promises.readFile(executablePath)
      );
      executableForTools = destination;
      if (this.debug) {
        console.log(`${this.logPrefix} Analyzing executable copy: ${destination}`);
      }
    } catch (error) {
      const note = `Could not create executable copy; analyzed original: ${errorMessage(error)}`;
      context.notes.push(note);
      if (this.debug) {
        console.warn(`${this.logPrefix} ${note}`);
      }
      if (tempDirectory) {
        await this.removeTempDirectory(tempDirectory);
        tempDirectory = undefined;
      }
      executableForTools = executablePath;
    }

    try {
      await callback(executableForTools);
    } finally {
      if (tempDirectory) {
        await this.removeTempDirectory(tempDirectory);
      }
    }
  }

  private async removeTempDirectory(directory: string): Promise<void> {
    try {
      await fs.promises.rm(directory, { recursive: true, force: true });
    } catch (error) {
      if (this.debug) {
        console.warn(
          `${this.logPrefix} Failed to remove temp dir ${directory}: ${errorMessage(error)}`
        );
      }
    }
  }
}

function requiredArtifactPath(
  value: string | undefined,
  kind: string,
  displayName: string
): string {
  if (!value) {
    throw new Error(
      `STM32 Build Analyzer: ${displayName} analysis requires a ${kind} artifact.`
    );
  }
  return value;
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/, 1)[0]?.trim() || undefined;
}

function isMissingExecutable(error: unknown): boolean {
  return error instanceof Error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AnalysisCancelledError();
  }
}
