import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Region } from '../models';

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class WebviewRenderer {
  private readonly debug: boolean;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly view: vscode.WebviewView
  ) {
    this.debug = vscode.workspace
      .getConfiguration('stm32BuildAnalyzerEnhanced')
      .get<boolean>('debug') ?? false;
  }

  public init(): void {
    this.view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    this.view.webview.html = this.getHtml();

    if (this.debug) {
      console.log('[STM32 Webview] Initialized webview with HTML and options.');
    }

    this.view.webview.onDidReceiveMessage(msg => {
      if (this.debug) {
        console.log(`[STM32 Webview] Received message:`, msg);
      }

      switch (msg.command) {
        case 'requestRefresh':
          vscode.commands.executeCommand('stm32BuildAnalyzerEnhanced.refresh');
          break;
        case 'refreshPaths':
          vscode.commands.executeCommand('stm32BuildAnalyzerEnhanced.refreshPaths');
          break;
        case 'openFile':
          this.openFile(msg.filePath, msg.lineNumber, msg.scrollTop);
          break;
      }
    });
  }

  public showData(regions: Region[], buildFolder: string) {
    if (this.debug) {
      console.log(`[STM32 Webview] Sending ${regions.length} region(s) to webview.`);
    }

    this.view.webview.postMessage({
      command: 'showMapData',
      data: regions,
      currentBuildFolderRelativePath: buildFolder
    });
  }

  private async openFile(file: string, line: number, scrollTop?: number) {
    try {
      if (this.debug) {
        console.log(`[STM32 Webview] Attempting to open file: ${file} @ ${line}`);
      }

      const uri = vscode.Uri.file(file);
      const doc = await vscode.workspace.openTextDocument(uri);
      const ed = await vscode.window.showTextDocument(doc, { preserveFocus: true });
      const pos = new vscode.Position(line - 1, 0);
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

      // Send message to restore scroll position in webview
      if (scrollTop !== undefined) {
        this.view.webview.postMessage({
          command: 'restoreScroll',
          scrollTop: scrollTop
        });
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Cannot open ${file}`);
      if (this.debug) {
        console.error(`[STM32 Webview] Failed to open file: ${file}`, err);
      }
    }
  }

  private getHtml(): string {
    const webview = this.view.webview;
    const extensionPath = this.context.extensionPath;

    const nonce = getNonce();
    const csp = `default-src 'none'; img-src ${webview.cspSource} blob:; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline';`;

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(extensionPath, 'dist', 'build-analyzer.bundle.js'))
    );
    const icon1Uri = webview.asWebviewUri(
      vscode.Uri.file(path.join(extensionPath, 'resources', '1.png'))
    );
    const icon2Uri = webview.asWebviewUri(
      vscode.Uri.file(path.join(extensionPath, 'resources', '2.png'))
    );
    const icon3Uri = webview.asWebviewUri(
      vscode.Uri.file(path.join(extensionPath, 'resources', '3.png'))
    );

    let html = fs.readFileSync(
      path.join(extensionPath, 'resources', 'build-analyzer.html'),
      { encoding: 'utf8', flag: 'r' }
    );

    html = html
      .replace(/\$\{csp\}/g, csp)
      .replace(/\$\{nonce\}/g, nonce)
      .replace(/\$\{scriptUri\}/g, scriptUri.toString());

    html = html.replace(
      '<body>',
      `<body data-icon1-uri="${icon1Uri}" data-icon2-uri="${icon2Uri}" data-icon3-uri="${icon3Uri}">`
    );

    return html;
  }
}
