import * as os from 'os';

export function resolveVariables(value: string, workspaceRoot?: string): string {
  value = value.replace(/\$\{userHome\}/g, os.homedir());

  value = value.replace(/\$\{env:([^}]+)\}/g, (_, varName) => process.env[varName] ?? '');

  if (workspaceRoot) {
    value = value.replace(/\$\{workspaceFolder\}/g, workspaceRoot);
  }

  return value;
}
