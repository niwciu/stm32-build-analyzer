import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ToolchainAdapter } from '../../analysis/contracts';
import { ANALYSIS_DIAGNOSTIC_CODES } from '../../analysis/diagnostics';
import type { ToolResolver } from '../../process/ToolResolver';
import type { ToolRunner, ToolRunResult } from '../../process/ToolRunner';
import {
  GnuToolchainId,
  ToolExecutionError,
} from '../../toolchains/gnu/GnuBinutilsAdapter';

export interface GnuAdapterContractOptions {
  readonly name: string;
  readonly toolchainId: GnuToolchainId;
  readonly displayName: string;
  readonly targetArchitecture: string;
  readonly objdumpTool: string;
  readonly nmTool: string;
  readonly createAdapter: (
    runner: ToolRunner,
    resolver: ToolResolver
  ) => ToolchainAdapter;
}

export function defineGnuAdapterContract(
  options: GnuAdapterContractOptions
): void {
  suite(options.name, () => {
    let directory: string;
    let mapPath: string;
    let executablePath: string;

    setup(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gnu-contract-'));
      mapPath = path.join(directory, 'firmware.map');
      executablePath = path.join(directory, 'firmware.elf');
      fs.writeFileSync(mapPath, GNU_MAP, 'utf8');
      fs.writeFileSync(executablePath, Buffer.from('ELF\0contract'));
    });

    teardown(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    test('uses its configured tool names during environment validation', async () => {
      const adapter = options.createAdapter(
        async command => successfulResult(`${command} 1.0\nCopyright`),
        directResolver()
      );

      const validation = await adapter.validateEnvironment(artifacts());

      assert.strictEqual(validation.status, 'valid');
      assert.deepStrictEqual(validation.tools, [
        {
          name: options.objdumpTool,
          role: 'section-inspector',
          required: true,
          resolvedPath: options.objdumpTool,
          version: `${options.objdumpTool} 1.0`,
        },
        {
          name: options.nmTool,
          role: 'symbol-inspector',
          required: false,
          resolvedPath: options.nmTool,
          version: `${options.nmTool} 1.0`,
        },
      ]);
    });

    test('reports configured identity, target metadata, and provenance', async () => {
      const commands: string[] = [];
      const adapter = options.createAdapter(async command => {
        commands.push(command);
        return successfulResult(
          command === options.objdumpTool ? OBJDUMP_OUTPUT : NM_OUTPUT
        );
      }, directResolver());

      const analysis = await adapter.analyze(artifacts());

      assert.deepStrictEqual(analysis.toolchain, {
        id: options.toolchainId,
        displayName: options.displayName,
        targetArchitecture: options.targetArchitecture,
      });
      assert.deepStrictEqual(commands, [options.objdumpTool, options.nmTool]);
      assert.deepStrictEqual(
        analysis.provenance.toolInvocations.map(invocation => ({
          tool: invocation.tool,
          arguments: invocation.arguments,
        })),
        [
          { tool: options.objdumpTool, arguments: ['-h', executablePath] },
          {
            tool: options.nmTool,
            arguments: [
              '-C', '-S', '-n', '-l', '--defined-only', executablePath,
            ],
          },
        ]
      );
      assert.strictEqual(analysis.regions[0].used, 0x20);
      assert.strictEqual(
        analysis.regions[0].sections[0].symbols[0].name,
        'contract_symbol'
      );
    });

    test('treats nm as optional for validation and analysis', async () => {
      const adapter = options.createAdapter(async (command, arguments_) => {
        if (command === options.nmTool) {
          return failedResult('symbol table unavailable');
        }
        return successfulResult(
          arguments_[0] === '--version'
            ? `${command} 1.0`
            : OBJDUMP_OUTPUT
        );
      }, directResolver());

      const validation = await adapter.validateEnvironment(artifacts());
      const analysis = await adapter.analyze(artifacts());

      assert.strictEqual(validation.status, 'partial');
      assert.strictEqual(analysis.regions[0].used, 0x20);
      assert.strictEqual(analysis.warnings.length, 1);
      assert.strictEqual(
        analysis.warnings[0].code,
        ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_PARTIAL
      );
    });

    test('treats objdump as required for validation and analysis', async () => {
      const adapter = options.createAdapter(async command =>
        command === options.objdumpTool
          ? failedResult('objdump unavailable')
          : successfulResult(`${command} 1.0`), directResolver());

      const validation = await adapter.validateEnvironment(artifacts());

      assert.strictEqual(validation.status, 'invalid');
      await assert.rejects(
        adapter.analyze(artifacts()),
        error => error instanceof ToolExecutionError
          && error.tool === options.objdumpTool
      );
    });

    function artifacts() {
      return {
        mapPath,
        executablePath,
        linkerScriptPaths: [],
        workspaceFolder: directory,
      };
    }
  });
}

function directResolver(): ToolResolver {
  return {
    resolve: tool => ({ command: tool, source: 'path' }),
  };
}

function successfulResult(stdout: string): ToolRunResult {
  return {
    stdout: Buffer.from(stdout),
    stderr: Buffer.alloc(0),
    status: 0,
    signal: null,
  };
}

function failedResult(stderr: string): ToolRunResult {
  return {
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(stderr),
    status: 1,
    signal: null,
  };
}

const GNU_MAP = [
  'Memory Configuration',
  'FLASH 0x08000000 0x00001000 xr',
  'Linker script and memory map',
].join('\n');

const OBJDUMP_OUTPUT = [
  'Sections:',
  'Idx Name          Size      VMA       LMA       File off  Algn',
  '  0 .text         00000020  08000000  08000000  00000100  2**2',
  '                  CONTENTS, ALLOC, LOAD, READONLY, CODE',
].join('\n');

const NM_OUTPUT = '08000000 00000010 T contract_symbol\tsrc/main.c:7\n';
