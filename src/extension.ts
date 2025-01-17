// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';

interface Region {
    name: string,
    startAddress: number;
    size: number;
    used: number;
    sections: Section[];
}

interface Section {
    name: string;
    startAddress: number;
    size: number;
    loadAddress: number;
    symbols: Symbol[];
}

interface Symbol {
    name: string;
    startAddress: number;
    size: number;
    path: string;
    row: number;
}

class BuildAnalyzerProvider implements vscode.WebviewViewProvider {
    private _context: vscode.ExtensionContext;
    private _view: vscode.WebviewView | undefined;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): void {
		this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._context.extensionUri, 'resources')
            ]
        };

		const projectPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        const mapFilePath = this.findMapFile(projectPath);
        const elfFilePath = this.findElfFile(projectPath);

        webviewView.webview.html = this.getHtmlContent(webviewView.webview, "");

        webviewView.webview.onDidReceiveMessage(
            message => {
                console.log('Received message:', message);
                switch (message.command) {
                    case 'parseMapFile':
                        const sections = this.parseMapAndElfFile(mapFilePath, elfFilePath);
                        webviewView.webview.postMessage({ command: 'showMapData', data: sections });
                        return;
                    case 'openFile':
                        this.openFileAtLine(message.filePath, message.lineNumber);
                        return;
                }
            },
            undefined,
            this._context.subscriptions
        );
    }
	
	private findElfFile(projectPath: string): string {
        const buildDir = path.join(projectPath, 'build', 'Debug');
        if (fs.existsSync(buildDir)) {
            const files = fs.readdirSync(buildDir);
            const elfFile = files.find(file => file.endsWith('.elf')); 
            if (elfFile) {
                return path.join(buildDir, elfFile); 
            }
        }
        return ``;
    }
	    
    private parseMapAndElfFile(mapFilePath: string, elfFilePath: string): Region[] {
        const regions:Region[] = [];

        const regionRegex = /^\s*(\w+)\s+(0x[\da-fA-F]+)\s+(0x[\da-fA-F]+)\s+\w+/;

        const sectionRegex = /^\s*([\d]+)\s+([\.\w]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+/;

        const symbolRegex = /^([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)?\s*([a-zA-Z]+)\s+([\S]+)\s*([\S]*)?\s*/;
        const pathRegex = /(.*):(\d+)$/;

        let isRegion = false;

        //parsing MAP
        const content = fs.readFileSync(mapFilePath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
            if (line.startsWith('Memory Configuration')) {
                isRegion = true;
                continue;
            }
            if (line.startsWith('Linker script and memory map')) {
                break;
            }
            
            if(isRegion) {
                const match = regionRegex.exec(line);
                if(match) {
                    const [, name, startAddress, length] = match;
                    regions.push({
                        name,
                        startAddress: parseInt(startAddress, 16),
                        size: parseInt(length, 16),
                        used: 0,
                        sections: [],
                    });
                }
            }
        }
        //parsing OBJDUMP ELF
        try {
            const result = cp.spawnSync('arm-none-eabi-objdump', ['-h', elfFilePath]);
            if (result.error) {
                console.error('Error executing command:', result.error);
            } else {
                const lines = result.stdout.toString().split('\n');
                for (const line of lines) {
                    const match = sectionRegex.exec(line);
                    if(!match) { continue;}
                    const [, , name, size, address, load] = match;
                    const sectionStart = parseInt(address, 16);
                    const sectionSize = parseInt(size, 16);
                    if(sectionSize === 0) { continue; }
                    const sectionLoadStart = parseInt(load, 16);
                    for(const region of regions) {
                        const regionStart = region.startAddress;
                        const regionEnd = regionStart + region.size;
                        if(sectionStart >= regionStart && sectionStart < regionEnd) {
                            region.sections.push({
                                name,
                                startAddress: sectionStart,
                                size: sectionSize,
                                loadAddress: sectionLoadStart,
                                symbols: []
                            });
                            region.used += sectionSize;
                            continue;
                        }
                        if(sectionLoadStart >= regionStart && sectionLoadStart < regionEnd && name === '.data') {
                            region.sections.push({
                                name,
                                startAddress: sectionLoadStart,
                                size: sectionSize,
                                loadAddress: sectionLoadStart,
                                symbols: []
                            });
                            region.used += sectionSize;
                        }
                    }
                    
                }
            }
        } catch (error) {
            console.error('error', error);
        }
        //parsing NM ELF
        try {
            const result = cp.spawnSync('arm-none-eabi-nm', ['-C', '-S', '-n', '-l', elfFilePath]);
            if (result.error) {
                console.error('Error executing command:', result.error);
            } else {
                const lines = result.stdout.toString().split('\n');
                for (const line of lines) {
                    const match = symbolRegex.exec(line);
                    if(!match) { continue;}
                    const [, address, size, type, name, path] = match;
                    const symbolStart = parseInt(address, 16);
                    const symbolSize = Number.isNaN(parseInt(size, 16))? 0 : parseInt(size, 16);
                    const pathMatch = pathRegex.exec(path);
                    let filePath: string = "";
                    let fileRow: number = 0;
                    if(!pathMatch) { 
                        filePath = "";
                        fileRow = 0;
                    } else {
                        const [, filePathStr, fileRowStr] = pathMatch;
                        filePath = filePathStr;
                        fileRow = parseInt(fileRowStr, 10);
                    }
                    for(const region of regions) {
                        const regionStart = region.startAddress;
                        const regionEnd = regionStart + region.size;
                        if(symbolStart < regionStart || symbolStart >= regionEnd) {continue;}
                        for(const section of region.sections) {
                            const sectionStart = section.startAddress;
                            const sectionEnd = sectionStart + section.size;
                            if(symbolStart < sectionStart || symbolStart >= sectionEnd) {continue;}
                            section.symbols.push({
                                name: name,
                                startAddress: symbolStart,
                                size: symbolSize,
                                path: filePath,
                                row: fileRow
                            });
                            break;
                        }                        
                    }
                }
            }
        } catch (error) {
            console.error('error', error);
        }
        return regions;
    }
	
	private findMapFile(projectPath: string): string {
        const buildDir = path.join(projectPath, 'build', 'Debug');
        if (fs.existsSync(buildDir)) {
            const files = fs.readdirSync(buildDir);
            const mapFile = files.find(file => file.endsWith('.map')); 
            if (mapFile) {
                return path.join(buildDir, mapFile); 
            }
        }
        return ``;
    }

    private async openFileAtLine(filePath: string, lineNumber: number) {
        try {
            const fileUri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document);
            const position = new vscode.Position(lineNumber - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
        } catch (error) {
            vscode.window.showErrorMessage(`File opening error: ${filePath}`);
        }
    }

    private getHtmlContent(webview: vscode.Webview, elfFilePath: string|null): string {
        const icon1Uri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'resources', '1.png')
        );
        const icon2Uri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'resources', '2.png')
        );
        const icon3Uri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'resources', '3.png')
        );
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Build Analyzer</title>
            <style>
            table.gray {
                background-color: var(--vscode-editor-background);
                foreground-color: var(--vscode-editor-foreground);
                font-family: var(--vscode-editor-font-family, Arial, sans-serif);
                width: 100%;
                text-align: left;
                border-collapse: collapse;
                }
                table.gray td, table.gray th {
                border: 1px solid var(--highlight-color);
                padding: 3px 2px;
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
                table.gray tfoot td {
                font-size: 14px;
                }
                table.gray tfoot .links {
                text-align: right;
                }
                #regionsHead td {
                text-align: center;
                }
                #regionsBody td {
                padding-left: 5px;
                padding-right: 5px;
                }
                .bar { 
                    background-color: var(--vscode-editorWidget-border); 
                    width: 100px; 
                    height: 100%;
                    display: inline-block;
                } 
                .node {
                    margin-left: 20px;
                }
                .toggleRow {
                    display: flex;
                    align-items: center;
                    cursor: pointer;
                    user-select: none;
                }
                .toggle {
                    cursor: pointer;
                    display: inline-block;
                    width: 20px;
                    user-select: none;
                }
                .children.hidden {
                    display: none;
                }
        </style>
        </head>
        <body>
        <table id="regionsTable">
            <thead id="regionsHead">
                <tr>
                    <td></td>
                    <td>Name</td>
                    <td>Address</td>
                    <td>Size</td>
                    <td>Notes</td>
                </tr>
            </thead>
            <tbody id="regionsBody">
            </tbody>
        </table>
			<script>
                const vscode = acquireVsCodeApi();
                window.addEventListener('DOMContentLoaded', () => {
					vscode.postMessage({ command: 'parseMapFile' });
                });
				window.addEventListener('message', (event) => {
					const message = event.data;
					if (message.command === 'showMapData') {
                        fillTableRegions(message.data);
                    }
				});

                function formatBytes(bytes, decimals = 2) {
                    if (bytes === 0) return '0 B';
                    const k = 1024;
                    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    const value = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));
                    return \`\${value} \${sizes[i]}\`;
                }
                    
                function fillTableRegions(regions) {
                    const tableBody = document.getElementById('regionsBody');
                    tableBody.innerHTML = ''; // Очистить контейнер

                    id = 0;

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
                        plus.textContent = \`+\`;
                        tableTd1.appendChild(plus);
                        
                        const bar = document.createElement('div');
                        bar.className = 'bar';
                        const progress = document.createElement('div');
                        if(percent > 95) {
                            progress.setAttribute('style', \`width: \${percent}%; background-color: var(--vscode-minimap-errorHighlight); height: 100%;\`);
                        } else if(percent > 75) {
                            progress.setAttribute('style', \`width: \${percent}%; background-color: var(--vscode-minimap-warningHighlight); height: 100%;\`);
                        } else {
                            progress.setAttribute('style', \`width: \${percent}%; background-color: var(--vscode-minimap-infoHighlight); height: 100%;\`);
                        }
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

                        const textNodeName = document.createTextNode(\` \${region.name} \`);
                        tableTd2.appendChild(textNodeName); 

                        const tableTd3 = document.createElement('td');

                        const textNodeAddress = document.createTextNode(\` 0x\${region.startAddress.toString(16).padStart(8,'0')} \`);
                        tableTd3.appendChild(textNodeAddress); 

                        const tableTd4 = document.createElement('td');

                        const textNodeSize = document.createTextNode(\` \${formatBytes(region.size)} \`);
                        tableTd4.appendChild(textNodeSize); 

                        const tableTd5 = document.createElement('td');

                        const textNodeFreeSize = document.createTextNode(\` \${formatBytes(region.size-region.used)} free \`);
                        tableTd5.appendChild(textNodeFreeSize); 
                        
                        tableTr.appendChild(tableTd1);
                        tableTr.appendChild(tableTd2);
                        tableTr.appendChild(tableTd3);
                        tableTr.appendChild(tableTd4);
                        tableTr.appendChild(tableTd5);
                        tableBody.appendChild(tableTr);

                        region.sections.forEach(section => {
                            id++;
                            sectionId = id;
                            const sectionTr = document.createElement('tr');
                            sectionTr.className = 'toggleTr level-2';
                            sectionTr.setAttribute('data-level', '2');
                            sectionTr.setAttribute('data-id', sectionId);
                            sectionTr.setAttribute('data-parent', regionId);
                            sectionTr.style.display = 'none';

                            const sectionTd1 = document.createElement('td');
                            
                            const plus = document.createElement('span');
                            plus.className = 'toggle';
                            plus.textContent = \`+\`;
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

                            const sectionName = document.createTextNode(\` \${section.name} \`);
                            sectionTd2.appendChild(sectionName); 
                            sectionTd2.setAttribute('style', \`padding-left: 15px;\`);

                            const sectionTd3 = document.createElement('td');

                            const sectionAddress = document.createTextNode(\` 0x\${section.startAddress.toString(16).padStart(8,'0')} \`);
                            sectionTd3.appendChild(sectionAddress); 

                            const sectionTd4 = document.createElement('td');

                            const sectionSize = document.createTextNode(\` \${formatBytes(section.size)} \`);
                            sectionTd4.appendChild(sectionSize); 

                            const sectionTd5 = document.createElement('td');

                            
                            sectionTr.appendChild(sectionTd1);
                            sectionTr.appendChild(sectionTd2);
                            sectionTr.appendChild(sectionTd3);
                            sectionTr.appendChild(sectionTd4);
                            sectionTr.appendChild(sectionTd5);

                            tableBody.appendChild(sectionTr);
                            section.symbols.forEach(symbol => {
                                id++;
                                pointId = id;
                                const pointTr = document.createElement('tr');
                                pointTr.className = 'toggleTr level-3';
                                pointTr.setAttribute('data-level', '3');
                                pointTr.setAttribute('data-id', pointId);
                                pointTr.setAttribute('data-parent', sectionId);
                                pointTr.style.display = 'none';
                                
                                const pointTd1 = document.createElement('td');
                                const pointTd2 = document.createElement('td');
                                pointTd2.setAttribute('title', \`\${symbol.path} : \${symbol.row}\`);

                                const img = document.createElement('img');
                                img.src = '${icon3Uri}';
                                img.alt = 'Icon';
                                img.style.width = '16px';
                                img.style.height = '16px';
                                img.style.verticalAlign = 'middle';
                                img.style.marginRight = '5px';
                                pointTd2.appendChild(img); 

                                if(symbol.path == '') {
                                    const pointName = document.createTextNode(\` \${symbol.name} \`);
                                    pointTd2.appendChild(pointName);
                                } else {
                                    const link = document.createElement('a');
                                    link.className = 'source-link';
                                    link.setAttribute('href', '#');
                                    link.setAttribute('data-file', \`\${symbol.path}\`);
                                    link.setAttribute('data-line', \`\${symbol.row}\`);
                                    const pointName = document.createTextNode(\` \${symbol.name} \`);
                                    link.appendChild(pointName);
                                    pointTd2.appendChild(link);
                                }

                                pointTd2.setAttribute('style', \`padding-left: 25px;\`);

                                const pointTd3 = document.createElement('td');

                                const pointAddress = document.createTextNode(\` 0x\${symbol.startAddress.toString(16).padStart(8,'0')} \`);
                                pointTd3.appendChild(pointAddress); 

                                const pointTd4 = document.createElement('td');

                                const pointSize = document.createTextNode(\` \${symbol.size} B\`);
                                pointTd4.appendChild(pointSize); 

                                const pointTd5 = document.createElement('td');                                

                                pointTr.appendChild(pointTd1);
                                pointTr.appendChild(pointTd2);
                                pointTr.appendChild(pointTd3);
                                pointTr.appendChild(pointTd4);
                                pointTr.appendChild(pointTd5);

                                tableBody.appendChild(pointTr);
                            });
                        });
                    });
                }
                document.addEventListener("DOMContentLoaded", () => {
                    
                    function toggleNode(toggleElement) {
                        const children = toggleElement.closest(".node").querySelector(".children");
                        if (children) {
                            children.classList.toggle("hidden");
                            toggleElement.textContent = children.classList.contains("hidden") ? "+" : "-";
                        }
                    }

                    const regionsTable = document.getElementById("regionsTable");
                
                    regionsTable.addEventListener("dblclick", (e) => {
                        const tr = e.target.closest('tr');
                        if (!tr) return;

                        const level = parseInt(tr.getAttribute('data-level'), 10);
                        const parentId = tr.getAttribute('data-id');

                        function toggleVisibility(parentId) {\
                            const childRows = document.querySelectorAll(\`tr[data-parent="\${parentId}"]\`);
                            childRows.forEach(child => {\
                                child.style.display = child.style.display === 'none' ? '' : 'none';\
                                const childId = child.getAttribute('data-id');
                                const childLevel = parseInt(child.getAttribute('data-level'), 10);
                                if (child.style.display === 'none' && childLevel === 2) { \
                                    const childChildRows = document.querySelectorAll(\`tr[data-parent="\${childId}"]\`);
                                    childChildRows.forEach(c => {
                                        if(c.style.display !== 'none') c.style.display = 'none';
                                    });
                                }
                            });
                        }
                        
                        const toggleSpan = tr.querySelector('.toggle');
                        if (toggleSpan) {
                            toggleSpan.textContent = toggleSpan.textContent === '+' ? '−' : '+';
                        }
                        toggleVisibility(parentId);
                    });

                    regionsTable.addEventListener('click', (event) => {
                        if (event.target.classList.contains('source-link')) {
                            event.preventDefault();

                            const filePath = event.target.dataset.file;
                            const lineNumber = parseInt(event.target.dataset.line, 10);

                            vscode.postMessage({
                                command: 'openFile',
                                filePath: filePath,
                                lineNumber: lineNumber
                            });

                            event.stopPropagation();
                        }
                    });
                });
			</script>
        </body>
        </html>
        `;
    }
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "buildAnalyzer",
            new BuildAnalyzerProvider(context)
        )
    );
}

export function deactivate() {}

