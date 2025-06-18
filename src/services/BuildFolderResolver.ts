import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface BuildPaths { map: string; elf: string; }

export class BuildFolderResolver {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolve(): Promise<BuildPaths> {
    const cfg = vscode.workspace.getConfiguration('stm32BuildAnalyzer');
    const customMap = cfg.get<string>('mapFilePath');
    const customElf = cfg.get<string>('elfFilePath');
    if (customMap && customElf && fs.existsSync(customMap) && fs.existsSync(customElf)) {
      return { map: customMap, elf: customElf };
    }

    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!root) {throw new Error('No workspace folder open');}

    const folders = await this.findBuildFolders(root);
    if (folders.length === 0) {
      throw new Error('No build folders containing both .map and .elf found');
    }

    let target = folders[0];
    if (folders.length > 1) {
      const pick = await vscode.window.showQuickPick(
        folders.map(f => ({ label: path.basename(f), folder: f })),
        { placeHolder: 'Select build folder with .map & .elf' }
      );
      if (!pick) {throw new Error('Build folder selection cancelled');}
      target = pick.folder;
    }

    const mapFile = await this.findFile(target, '.map');
    const elfFile = await this.findFile(target, '.elf');
    if (!mapFile || !elfFile) {
      throw new Error(`Missing .map or .elf in ${target}`);
    }
    return { map: mapFile, elf: elfFile };
  }

  private async findBuildFolders(root: string): Promise<string[]> {
    const found = new Set<string>();
    const common = ['build','Build','Release','Debug','out','output']
      .map(p => path.join(root, p));

    const walk = (dir: string) => {
      try {
        let hasMap = false, hasElf = false;
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, d.name);
          if (d.isDirectory()) { walk(full); }
          else if (d.name.endsWith('.map')) {hasMap = true;}
          else if (d.name.endsWith('.elf')) {hasElf = true;}
        }
        if (hasMap && hasElf) {found.add(dir);}
      } catch { /* ignore */ }
    };

    for (const c of common) {if (fs.existsSync(c)) {walk(c);}}
    if (found.size === 0) {walk(root);}
    return Array.from(found);
  }

  private async findFile(folder: string, ext: string): Promise<string> {
    const files = fs.readdirSync(folder).filter(f => f.endsWith(ext));
    if (files.length === 0) {return '';}
    // priorytetyzuj Release / Debug
    files.sort((a,b) => {
      if (a.includes('Release')) {return -1;}
      if (b.includes('Release')) {return 1;}
      if (a.includes('Debug')) {return -1;}
      if (b.includes('Debug')) {return 1;}
      return 0;
    });
    const p = path.join(folder, files[0]);
    fs.accessSync(p, fs.constants.R_OK);
    if (ext === '.map' && fs.statSync(p).size === 0) {
      throw new Error('Map file is empty');
    }
    return p;
  }
}
