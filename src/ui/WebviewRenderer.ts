import * as vscode from 'vscode';
import { Region } from '../models';

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
          this.openFile(msg.filePath, msg.lineNumber);
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

  private async openFile(file: string, line: number) {
    try {
      if (this.debug) {
        console.log(`[STM32 Webview] Attempting to open file: ${file} @ ${line}`);
      }

      const uri = vscode.Uri.file(file);
      const doc = await vscode.workspace.openTextDocument(uri);
      const ed = await vscode.window.showTextDocument(doc);
      const pos = new vscode.Position(line - 1, 0);
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch (err) {
      vscode.window.showErrorMessage(`Cannot open ${file}`);
      if (this.debug) {
        console.error(`[STM32 Webview] Failed to open file: ${file}`, err);
      }
    }
  }

  private getHtml(): string {
    const web = this.view.webview;
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${web.cspSource} blob:; script-src 'unsafe-inline' ${web.cspSource}; style-src ${web.cspSource} 'unsafe-inline';">`;
    const icon1Uri = web.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', '1.png'));
    const icon2Uri = web.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', '2.png'));
    const icon3Uri = web.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', '3.png'));

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            ${csp}
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Build Analyzer</title>
            <style>
                table.gray {
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-family: var(--vscode-editor-font-family);
                    width: 100%;
                    text-align: left;
                    border-collapse: collapse;
                }
                table.gray td, table.gray th {
                    border: 1px solid var(--highlight-color);
                    padding: 3px 2px;
                }
                table.gray td:nth-child(5),
                table.gray td:nth-child(6) {
                    text-align: right;
                }
                table.gray tbody td {
                    font-size: 13px;
                }
                
                table.gray thead {
                    background: var(--highlight-color);
                    border-bottom: 2px solid var(--highlight-color);
                }
                table.gray thead th {
                    font-size: 15px;
                    font-weight: bold;
                    border-left: 2px solid var(--highlight-color);
                }
                table.gray thead th:first-child {
                    border-left: none;
                }
                #regionsHead td {
                    text-align: center;
                }
                #regionsBody td {
                    padding-left: 5px;
                    padding-right: 5px;
                }  
                #regionsBody td.right-align {
                    text-align: right;
                }
                .bar { 
                    background-color: var(--vscode-editorWidget-border); 
                    width: 100px; 
                    height: 100%;
                    display: inline-block;
                } 
                .toggle {
                    cursor: pointer;
                    display: inline-block;
                    width: 20px;
                    user-select: none;
                }
                #refreshButton,
                #refreshPathsButton {
                    padding: 5px 10px;
                    margin-bottom: 10px;
                    cursor: pointer;
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-secondaryBorder);
                    border-radius: 2px;
                }

                #refreshButton:hover,
                #refreshPathsButton:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }

            </style>
        </head>
        <body>
            <div class="button-container">
                <button id="refreshButton" class="button">Refresh Analyze</button>
                <button id="refreshPathsButton" class="button">Change Build Folder</button>
            </div>
            <div class="current-build-folder-path-container">
                <label><strong>Current Build Folder:</strong></label>
                <div id="buildFolderPath" style="margin-bottom: 10px;"></div>
            </div>

            <table id="regionsTable">
                <thead id="regionsHead">
                    <tr>
                        <td></td>
                        <td>Name</td>
                        <td>Address</td>
                        <td>Size</td>
                        <td>Used</td>
                        <td>Free</td>
                    </tr>
                </thead>
                <tbody id="regionsBody">
                </tbody>
            </table>
            <script>
                const vscode = acquireVsCodeApi();
                
                function formatBytes(bytes, decimals = 2) {
                    if (bytes <= 0) return '0 B';
                    const k = 1024;
                    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    const value = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));
                    return \`\${value} \${sizes[i]}\`;
                }

                function resetTableRegions() {
                    document.getElementById('regionsBody').innerHTML = '';
                }
                    
                function fillTableRegions(regions) {
                    const tableBody = document.getElementById('regionsBody');
                    tableBody.innerHTML = '';

                    let id = 0;

                    regions.forEach(region => {
                        id++;
                        const regionId = id;
                        const percent = region.used / region.size * 100;

                        const tableTr = document.createElement('tr');
                        tableTr.className = 'toggleTr level-1';
                        tableTr.setAttribute('data-level', '1');
                        tableTr.setAttribute('data-id', regionId);
                        
                        const tableTd1 = document.createElement('td');
                        const plus = document.createElement('span');
                        plus.className = 'toggle';
                        plus.textContent = '+';
                        tableTd1.appendChild(plus);
                        
                        const bar = document.createElement('div');
                        bar.className = 'bar';
                        const progress = document.createElement('div');
                        progress.setAttribute('style', \`
                            width: \${percent}%; 
                            background-color: \${percent > 95 ? 'var(--vscode-minimap-errorHighlight)' : 
                                             percent > 75 ? 'var(--vscode-minimap-warningHighlight)' : 
                                             'var(--vscode-minimap-infoHighlight)'}; 
                            height: 100%;
                            color: \${percent > 50 ? 'white' : 'black'};
                            text-align: center;
                            font-size: 12px;
                            line-height: 1.5;
                        \`);
                        progress.textContent = \`\${percent.toFixed(2)}%\`;
                        bar.appendChild(progress);
                        tableTd1.appendChild(bar);

                        const tableTd2 = document.createElement('td');
                        const img = document.createElement('img');
                        img.src = '${icon1Uri}';
                        img.alt = 'Icon';
                        img.style.width = '16px';
                        img.style.height = '16px';
                        img.style.verticalAlign = 'middle';
                        img.style.marginRight = '5px';
                        tableTd2.appendChild(img); 
                        tableTd2.appendChild(document.createTextNode(\` \${region.name} \`));

                        const tableTd3 = document.createElement('td');
                        tableTd3.appendChild(document.createTextNode(\`0x\${region.startAddress.toString(16).padStart(8,'0')}\`));

                        const tableTd4 = document.createElement('td');
                        tableTd4.className = 'right-align';
                        tableTd4.appendChild(document.createTextNode(formatBytes(region.size)));

                        const tableTd5 = document.createElement('td');
                        tableTd5.className = 'right-align';
                        tableTd5.appendChild(document.createTextNode(formatBytes(region.used)));

                        const tableTd6 = document.createElement('td');
                        tableTd6.className = 'right-align';
                        tableTd6.appendChild(document.createTextNode(formatBytes(region.size-region.used)));
                        
                        tableTr.appendChild(tableTd1);
                        tableTr.appendChild(tableTd2);
                        tableTr.appendChild(tableTd3);
                        tableTr.appendChild(tableTd4);
                        tableTr.appendChild(tableTd5);
                        tableTr.appendChild(tableTd6);
                        tableBody.appendChild(tableTr);

                        region.sections.forEach(section => {
                            id++;
                            const sectionId = id;
                            const sectionTr = document.createElement('tr');
                            sectionTr.className = 'toggleTr level-2';
                            sectionTr.setAttribute('data-level', '2');
                            sectionTr.setAttribute('data-id', sectionId);
                            sectionTr.setAttribute('data-parent', regionId);
                            sectionTr.style.display = 'none';

                            const sectionTd1 = document.createElement('td');
                            const plus = document.createElement('span');
                            plus.className = 'toggle';
                            plus.textContent = '+';
                            sectionTd1.appendChild(plus);

                            const sectionTd2 = document.createElement('td');
                            const img = document.createElement('img');
                            img.src = '${icon2Uri}';
                            img.alt = 'Icon';
                            img.style.width = '16px';
                            img.style.height = '16px';
                            img.style.verticalAlign = 'middle';
                            img.style.marginRight = '5px';
                            sectionTd2.appendChild(img); 
                            sectionTd2.appendChild(document.createTextNode(\` \${section.name} \`));
                            sectionTd2.style.paddingLeft = '15px';

                            const sectionTd3 = document.createElement('td');
                            sectionTd3.appendChild(document.createTextNode(\`0x\${section.startAddress.toString(16).padStart(8,'0')}\`));

                            const sectionTd4 = document.createElement('td');
                            sectionTd4.className = 'right-align';
                            sectionTd4.appendChild(document.createTextNode(formatBytes(section.size)));

                            const sectionTd5 = document.createElement('td');
                            sectionTd5.className = 'right-align';
                            const sectionTd6 = document.createElement('td');
                            sectionTd6.className = 'right-align';
                            
                            sectionTr.appendChild(sectionTd1);
                            sectionTr.appendChild(sectionTd2);
                            sectionTr.appendChild(sectionTd3);
                            sectionTr.appendChild(sectionTd4);
                            sectionTr.appendChild(sectionTd5);
                            sectionTr.appendChild(sectionTd6);
                            tableBody.appendChild(sectionTr);

                            section.symbols.forEach(symbol => {
                                id++;
                                const pointTr = document.createElement('tr');
                                pointTr.className = 'toggleTr level-3';
                                pointTr.setAttribute('data-level', '3');
                                pointTr.setAttribute('data-id', id);
                                pointTr.setAttribute('data-parent', sectionId);
                                pointTr.style.display = 'none';
                                
                                const pointTd1 = document.createElement('td');
                                const pointTd2 = document.createElement('td');
                                pointTd2.setAttribute('title', \`\${symbol.path}:\${symbol.row}\`);

                                const img = document.createElement('img');
                                img.src = '${icon3Uri}';
                                img.alt = 'Icon';
                                img.style.width = '16px';
                                img.style.height = '16px';
                                img.style.verticalAlign = 'middle';
                                img.style.marginRight = '5px';
                                pointTd2.appendChild(img); 

                                if (symbol.path === '') {
                                    pointTd2.appendChild(document.createTextNode(\` \${symbol.name} \`));
                                } else {
                                    const link = document.createElement('a');
                                    link.className = 'source-link';
                                    link.href = '#';
                                    link.dataset.file = symbol.path;
                                    link.dataset.line = symbol.row.toString();
                                    link.appendChild(document.createTextNode(\` \${symbol.name} \`));
                                    pointTd2.appendChild(link);
                                }
                                pointTd2.style.paddingLeft = '25px';

                                const pointTd3 = document.createElement('td');
                                pointTd3.appendChild(document.createTextNode(\`0x\${symbol.startAddress.toString(16).padStart(8,'0')}\`));

                                const pointTd4 = document.createElement('td');
                                pointTd4.className = 'right-align';
                                pointTd4.appendChild(document.createTextNode(\`\${symbol.size} B\`));
                                
                                const pointTd5 = document.createElement('td');
                                pointTd5.className = 'right-align';
                                const pointTd6 = document.createElement('td');  
                                pointTd6.className = 'right-align';                              

                                pointTr.appendChild(pointTd1);
                                pointTr.appendChild(pointTd2);
                                pointTr.appendChild(pointTd3);
                                pointTr.appendChild(pointTd4);
                                pointTr.appendChild(pointTd5);
                                pointTr.appendChild(pointTd6);
                                tableBody.appendChild(pointTr);
                            });
                        });
                    });
                }

                document.addEventListener('DOMContentLoaded', () => {
                    vscode.postMessage({ command: 'requestRefresh' });
                    
                    document.getElementById('refreshButton').addEventListener('click', () => {
                        vscode.postMessage({ command: 'requestRefresh' });
                    });
                    document.getElementById('refreshPathsButton').addEventListener('click', () => {
                        vscode.postMessage({ command: 'refreshPaths' });
                    });
                });

                document.getElementById('regionsTable').addEventListener('click', (e) => {
                    const toggleSpan = e.target.closest('.toggle');
                    if (toggleSpan) {
                        const tr = toggleSpan.closest('tr');
                        const level = parseInt(tr.getAttribute('data-level'), 10);
                        const parentId = tr.getAttribute('data-id');

                        const childRows = document.querySelectorAll(\`tr[data-parent="\${parentId}"]\`);
                        childRows.forEach(child => {
                            child.style.display = child.style.display === 'none' ? '' : 'none';
                            const childId = child.getAttribute('data-id');
                            const childLevel = parseInt(child.getAttribute('data-level'), 10);
                            if (child.style.display === 'none' && childLevel === 2) {
                                const grandChildRows = document.querySelectorAll(\`tr[data-parent="\${childId}"]\`);
                                grandChildRows.forEach(grandChild => {
                                    if (grandChild.style.display !== 'none') {
                                        grandChild.style.display = 'none';
                                    }
                                });
                            }
                        });

                        toggleSpan.textContent = toggleSpan.textContent === '+' ? '−' : '+';
                    }

                    const sourceLink = e.target.closest('.source-link');
                    if (sourceLink) {
                        e.preventDefault();
                        vscode.postMessage({
                            command: 'openFile',
                            filePath: sourceLink.dataset.file,
                            lineNumber: parseInt(sourceLink.dataset.line, 10)
                        });
                    }
                });

                window.addEventListener('message', event => {
                    const message = event.data;

                    switch (message.command) {
                        case 'showMapData':
                            resetTableRegions();
                            fillTableRegions(message.data);
                            if (message.currentBuildFolderRelativePath) {
                                const folderDiv = document.getElementById('buildFolderPath');
                                folderDiv.textContent = message.currentBuildFolderRelativePath;
                            }
                            break;
                    }
                });



            </script>
        </body>
        </html>`;
  }
}
