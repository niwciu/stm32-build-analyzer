// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import * as fs from 'fs';

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
        };

		const projectPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        const mapFilePath = this.findMapFile(projectPath);

        webviewView.webview.html = this.getHtmlContent(webviewView.webview, "");

        webviewView.webview.onDidReceiveMessage(
            message => {
                console.log('Received message:', message);
                switch (message.command) {
                    case 'parseMapFile':
                        const sections = this.parseMapFile(mapFilePath);
                        webviewView.webview.postMessage({ command: 'showMapData', data: sections });
                        return;
                }
            },
            undefined,
            this._context.subscriptions
        );
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
	    
    private parseMapFile(mapFilePath: string): Region[] {
        const content = fs.readFileSync(mapFilePath, 'utf8');
        const lines = content.split('\n');
        const sections: Section[] = [];

        const regions:Region[] = [];

        const regionRegex = /^\s*(\w+)\s+(0x[\da-fA-F]+)\s+(0x[\da-fA-F]+)\s+\w+/;
        const sectionFullRegex = /^([a-zA-Z0-9._]+)\s+(0x[\da-fA-F]+)\s+(0x[\da-fA-F]+)(?:\s+load address\s+(0x[\da-fA-F]+))?\s+(.*)$/;
        const sectionNameRegex = /^([a-zA-Z0-9._]+)/;
        const sectionDataRegex = /^\s+(0x[\da-fA-F]+)\s+(0x[\da-fA-F]+)(?:\s+load address\s+(0x[\da-fA-F]+))?\s+(.*)$/;

        const subSectionFullRegex = /^\s([a-zA-Z0-9._]+)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s+(.*)[\r\n]/;
        const subSectionNameRegex = /^\s([a-zA-Z0-9._]+)\s+[\r\n]/;
        const subSectionDataRegex = /^\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s+(.*)[\r\n]/;

        const symbolsRegex = /^\s+(0x[0-9a-fA-F]+)\s+([a-zA-Z0-9._]+)[\r\n]/;

        let isRegion = false;
        let isSection = false;

        let combinedStr: string | null = null;

        let actualSectionName: string = "";
        let actualSectionStartAddress: number = 0;
        let actualSectionSize: number = 0;
        let symbols: Symbol[] = [];

        for (const line of lines) {
            if (line.startsWith('Memory Configuration')) {
                isRegion = true;
                isSection = false;
                continue;
            }
            if (line.startsWith('Linker script and memory map')) {
                isRegion = false;
                isSection = true;
                continue;
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

            if(isSection) {
                const nameMatch = sectionNameRegex.exec(line);
                if(nameMatch) {
                    combinedStr = line;
                    continue;
                }

                const dataMatch = sectionDataRegex.exec(line);
                if(combinedStr && dataMatch) {
                    combinedStr += ' ' + line.trim();
                }
                
                let match = sectionFullRegex.exec(combinedStr?combinedStr:line);
                if(match) {
                    const [, name, startAddress, sizeHex, loadAddress, ] = match;
                    const sectionStart = parseInt(startAddress, 16);
                    const sectionSize = parseInt(sizeHex, 16);
                    const sectionLoadStart = parseInt(loadAddress, 16);
                    if(sectionStart === 0 || sectionSize === 0) {
                        continue;
                    }
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
                                startAddress: sectionStart,
                                size: sectionSize,
                                loadAddress: sectionLoadStart,
                                symbols: []
                            });
                            region.used += sectionSize;
                        }
                    }
                }

                match = subSectionFullRegex.exec(line);
                if(!match) {
                    const symbolNameMatch = subSectionNameRegex.exec(line);
                    if(symbolNameMatch) {
                        combinedStr = line;
                        continue;
                    }
    
                    const symbolDataMatch = subSectionDataRegex.exec(line);
                    if(combinedStr && symbolDataMatch) {
                        combinedStr += ' ' + line.trim();
                    }

                    match = subSectionFullRegex.exec(combinedStr?combinedStr:line);
                }

                if(match) {
                    const [, name, startAddress, sizeHex, ] = match;
                    const subSectionStart = parseInt(startAddress, 16);
                    const subSectionSize = parseInt(sizeHex, 16);
                    if(symbols.length > 0) {
                        const lastSym = symbols.at(-1)!;
                        lastSym.size = actualSectionStartAddress + actualSectionSize - lastSym.startAddress;
                    } else {
                        symbols.push({
                            name: actualSectionName,
                            startAddress: actualSectionStartAddress,
                            size: actualSectionSize
                        });
                    }
                    for(const region of regions) {
                        for(const section of region.sections) {
                            if(subSectionStart >= section.startAddress && subSectionStart < section.startAddress+section.size) {
                                for(const symbol of symbols) {
                                    section.symbols.push({
                                        name: symbol.name,
                                        startAddress: symbol.startAddress,
                                        size: symbol.size
                                    });
                                }
                                symbols = [];
                            }
                        }
                    }
                    actualSectionName = name;
                    actualSectionStartAddress = subSectionStart;
                    actualSectionSize = subSectionSize;
                }
                
                match = symbolsRegex.exec(line);
                if(match) {
                    const [, startAddress, name, ] = match;
                    const symbolStart = parseInt(startAddress, 16);
                    symbols.push({
                        name,
                        startAddress: symbolStart,
                        size: 0
                    });
                    if(symbols.length > 1) {
                        symbols.at(-2)!.size = symbols.at(-1)!.startAddress - symbols.at(-2)!.startAddress;
                    }
                }


                combinedStr = null;
            }

            
        }
        return regions;
    }

    private getHtmlContent(webview: vscode.Webview, elfFilePath: string|null): string {
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
			<pre id="regions" class="tree"></pre>
			<script>
                const vscode = acquireVsCodeApi();
                window.addEventListener('DOMContentLoaded', () => {
                    console.log('Webview opened, sending message to extension...');
					vscode.postMessage({ command: 'parseMapFile' });
                });
				window.addEventListener('message', (event) => {
					const message = event.data;
					if (message.command === 'showMapData') {
                        displayRegions(message.data);
                        fillTableRegions(message.data);
                    }
				});

                function formatBytes(bytes, decimals = 2) {
                    if (bytes === 0) return '0 Bytes';
                    const k = 1024;
                    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    const value = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));
                    return \`\${value} \${sizes[i]}\`;
                }

                function displayRegions(regions) {
                    const regionsContainer = document.getElementById('regions');
                    regionsContainer.innerHTML = ''; // Очистить контейнер

                    regions.forEach(region => {
                        const regionDiv = document.createElement('div');
                        regionDiv.className = 'node';

                        const header = document.createElement('div');
                        header.className = 'toggleRow';

                        const percent = region.used / region.size * 100;
                    
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
                        const plus = document.createElement('span');
                        plus.className = 'toggle';
                        plus.textContent = \`+\`;
                        header.appendChild(plus);
                        header.appendChild(bar);
                        const textNode = document.createTextNode(\` \${region.name} (0x\${region.startAddress.toString(16)}): Used \${region.used} / \${region.size} bytes \`);
                        
                        header.appendChild(textNode);                    

                        const sectionsList = document.createElement('div');
                        sectionsList.className = 'children hidden';
                        region.sections.forEach(section => {
                            const sectionDiv = document.createElement('div');
                            sectionDiv.className = 'node';
                            sectionDiv.textContent = \`\${section.name} - Address: 0x\${section.startAddress.toString(16)}, Size: \${section.size} bytes\`;
                            sectionsList.appendChild(sectionDiv);
                        });

                        regionDiv.appendChild(header);
                        regionDiv.appendChild(sectionsList);
                        regionsContainer.appendChild(regionDiv);

                    });
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

                            const sectionName = document.createTextNode(\` \${section.name} \`);
                            sectionTd2.appendChild(sectionName); 

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

                                const pointName = document.createTextNode(\` \${symbol.name} \`);
                                pointTd2.appendChild(pointName); 

                                const pointTd3 = document.createElement('td');

                                const pointAddress = document.createTextNode(\` 0x\${symbol.startAddress.toString(16).padStart(8,'0')} \`);
                                pointTd3.appendChild(pointAddress); 

                                const pointTd4 = document.createElement('td');

                                const pointSize = document.createTextNode(\` \${formatBytes(symbol.size)} \`);
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
                    const regionsContainer = document.getElementById("regions");

                    regionsContainer.addEventListener("click", (e) => {
                        const toggle = e.target.closest(".toggle");
                        if (toggle) {
                            toggleNode(toggle);
                        }
                    });

                    regionsContainer.addEventListener("dblclick", (e) => {
                        const toggleRow = e.target.closest(".toggleRow");
                        if (toggleRow) {
                            const toggle = toggleRow.querySelector(".toggle");
                            if (toggle) toggleNode(toggle);
                        }
                    });

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
    
                        if (!tr) return; // Если кликнули не по строке, выходим
                        
                        // Получаем уровень строки (data-level)
                        const level = parseInt(tr.getAttribute('data-level'), 10);
                        const parentId = tr.getAttribute('data-id'); // Идентификатор родительской строки

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

                    
                });
			</script>
        </body>
        </html>
        `;
    }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "buildAnalyzer", // ID панели, зарегистрированной в package.json
            new BuildAnalyzerProvider(context)
        )
    );
}

// This method is called when your extension is deactivated
export function deactivate() {}

