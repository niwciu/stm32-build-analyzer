import * as os from 'os';

export interface WorkspaceFolderVariable {
  name: string;
  path: string;
}

export function resolveVariables(
  value: string,
  workspaceRoot?: string,
  workspaceFolders: readonly WorkspaceFolderVariable[] = []
): string {
  value = value.replace(/\$\{userHome\}/g, os.homedir());

  value = value.replace(/\$\{env:([^}]+)\}/g, (_, varName) => process.env[varName] ?? '');

  value = value.replace(/\$\{workspaceFolder:([^}]+)\}/g, (match, folderName: string) => {
    const folder = workspaceFolders.find(candidate => candidate.name === folderName);
    return folder?.path ?? match;
  });

  if (workspaceRoot) {
    value = value.replace(/\$\{workspaceFolder\}/g, workspaceRoot);
  }

  return value;
}
