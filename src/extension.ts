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
    module: string;
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
        const sectionFullRegex = /^\s*(\.\w+)\s+(0x[\da-fA-F]+)\s+(0x[\da-fA-F]+)(?:\s+load address\s+(0x[\da-fA-F]+))?\s+(.*)$/;
        const sectionNameRegex = /^\s*(\.\w+)/;
        const sectionDataRegex = /^\s+(0x[\da-fA-F]+)\s+(0x[\da-fA-F]+)(?:\s+load address\s+(0x[\da-fA-F]+))?\s+(.*)$/;

        let isRegion = false;
        let isSection = false;

        let combinedStr: string | null = null;

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
                
                const match = sectionFullRegex.exec(combinedStr?combinedStr:line);
                if(match) {
                    const [, name, startAddress, sizeHex, loadAddress, module] = match;
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
                                module,
                            });
                            region.used += sectionSize;
                            continue;
                        }
                        if(sectionLoadStart >= regionStart && sectionLoadStart < regionEnd) {
                            region.sections.push({
                                name,
                                startAddress: sectionStart,
                                size: sectionSize,
                                loadAddress: sectionLoadStart,
                                module,
                            });
                            region.used += sectionSize;
                        }
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
                    }
				});
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

