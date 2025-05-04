import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';

interface Region {
    name: string;
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
    private _mapFilePath: string = "";
    private _elfFilePath: string = "";
    private _buildFolder: string = "";
    private _fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this.setupFileWatcher();
        this.updateFilePaths();
    }

    private setupFileWatcher(): void {
        if (this._fileWatcher) {
            this._fileWatcher.dispose();
        }
        
        this._fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{map,elf}');
        this._fileWatcher.onDidChange(() => {
            if (this._mapFilePath && this._elfFilePath) {
                this.refreshView();
            }
        });
        this._context.subscriptions.push(this._fileWatcher);
    }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'requestRefresh':
                    this.refreshView();
                    break;
                case 'openFile':
                    await this.openFileAtLine(message.filePath, message.lineNumber);
                    break;
                case 'refreshPaths':
                    await vscode.commands.executeCommand('stm32BuildAnalyzerEnhanced.refresh');
                    break;
            }
        });

        this.refreshView();
    }

    private refreshView(): void {
        if (this._view && this._mapFilePath && this._elfFilePath) {
            try {
                const regions = this.parseMapAndElfFile(this._mapFilePath, this._elfFilePath);
                this._view.webview.postMessage({
                    command: 'showMapData',
                    data: regions
                });
            } catch (error) {
                console.error('Error refreshing view:', error);
            }
        }
    }

    public async updateFilePaths(): Promise<void> {
        const config = vscode.workspace.getConfiguration('stm32BuildAnalyzer');

        try {
            const customMapPath = config.get<string>('mapFilePath');
            const customElfPath = config.get<string>('elfFilePath');

            // Jeśli ścieżki są ustawione ręcznie, użyj ich
            if (customMapPath && customElfPath && fs.existsSync(customMapPath) && fs.existsSync(customElfPath)) {
                this._mapFilePath = customMapPath;
                this._elfFilePath = customElfPath;
                this.refreshView();
                return;
            }

            // Znajdź foldery zawierające zarówno .map jak i .elf
            const buildFolders = await this.findBuildFolders();

            if (buildFolders.length === 0) {
                vscode.window.showErrorMessage("No folders found containing both .map and .elf files!");
                return;
            }

            let selectedFolder = buildFolders[0];

            // Jeśli wiele folderów, zapytaj użytkownika
            if (buildFolders.length > 1) {
                const items = buildFolders.map(folder => ({
                    label: path.basename(folder),
                    description: folder,
                    folderPath: folder
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Multiple build folders found. Select one:',
                    matchOnDescription: true
                });

                if (!selected) {return;}
                selectedFolder = selected.folderPath;
            }

            // Znajdź pliki w wybranym folderze
            const [mapFile, elfFile] = await Promise.all([
                this.findFileInFolder('.map', selectedFolder),
                this.findFileInFolder('.elf', selectedFolder)
            ]);

            if (mapFile && elfFile) {
                this._mapFilePath = mapFile;
                this._elfFilePath = elfFile;
                this.refreshView();
            } else {
                vscode.window.showErrorMessage(`No .map or .elf files found in selected folder: ${selectedFolder}`);
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Error updating file paths: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async findBuildFolders(): Promise<string[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {return [];}

        const rootPath = workspaceFolders[0].uri.fsPath;
        const buildFolders = new Set<string>();

        const findFilesRecursively = (dir: string): void => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                let hasMap = false;
                let hasElf = false;

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        findFilesRecursively(fullPath);
                    } else if (entry.name.endsWith('.map')) {
                        hasMap = true;
                    } else if (entry.name.endsWith('.elf')) {
                        hasElf = true;
                    }
                }

                if (hasMap && hasElf) {
                    buildFolders.add(dir);
                }
            } catch (error) {
                console.error(`Error scanning directory ${dir}:`, error);
            }
        };

        // Najpierw sprawdź typowe lokalizacje
        const commonLocations = [
            ...(this._buildFolder ? [path.join(rootPath, this._buildFolder)] : []),
            path.join(rootPath, 'build'),
            path.join(rootPath, 'Release'),
            path.join(rootPath, 'Debug'),
            path.join(rootPath, 'release'),
            path.join(rootPath, 'debug'),
            path.join(rootPath, 'out'),
            path.join(rootPath, 'output')
        ];

        for (const location of commonLocations) {
            if (fs.existsSync(location)) {
                findFilesRecursively(location);
            }
        }

        // Jeśli nie znaleziono w typowych lokalizacjach, przeszukaj cały projekt
        if (buildFolders.size === 0) {
            findFilesRecursively(rootPath);
        }

        return Array.from(buildFolders);
    }

    private async findFileInFolder(fileExt: string, folderPath: string): Promise<string> {
        try {
            if (!fs.existsSync(folderPath)) {return "";}

            const files = fs.readdirSync(folderPath);
            const matchingFiles = files.filter(file => file.endsWith(fileExt));

            if (matchingFiles.length === 0) {return "";}

            // Jeśli wiele plików, wybierz najbardziej prawdopodobny
            const prioritized = matchingFiles.sort((a, b) => {
                if (a.includes('Release')) {return -1;}
                if (b.includes('Release')) {return 1;}
                if (a.includes('Debug')) {return -1;}
                if (b.includes('Debug')) {return 1;}
                return 0;
            });

            const filePath = path.join(folderPath, prioritized[0]);
            
            // Sprawdź czy plik jest poprawny
            fs.accessSync(filePath, fs.constants.R_OK);
            if (fileExt === '.map' && fs.readFileSync(filePath, 'utf8').length === 0) {
                throw new Error("Map file is empty");
            }
            
            return filePath;
        } catch (error) {
            console.error(`Error searching for ${fileExt} files in ${folderPath}:`, error);
            return "";
        }
    }

    private parseMapAndElfFile(mapFilePath: string, elfFilePath: string): Region[] {
        const regions: Region[] = [];
        const regionRegex = /^\s*(\w+)\s+(0x[\da-fA-F]+)\s+(0x[\da-fA-F]+)\s+\w+/;
        const sectionRegex = /^\s*([\d]+)\s+([\.\w]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+/;
        const allocRegex = /\bALLOC\b/;
        const symbolRegex = /^([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)?\s*([a-zA-Z]+)\s+([\S]+)\s*([\S]*)?\s*/;
        const pathRegex = /(.*):(\d+)$/;

        let isRegion = false;

        // Parse MAP file for memory regions
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
            
            if (isRegion) {
                const match = regionRegex.exec(line);
                if (match) {
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

        // Parse ELF file sections using objdump
        try {
            const result = cp.spawnSync('arm-none-eabi-objdump', ['-h', elfFilePath]);
            if (result.error) {
                console.error('Error executing objdump:', result.error);
            } else {
                const lines = result.stdout.toString().split('\n');
                let prevLine: string = "";
                for (const line of lines) {
                    const allocMatch = allocRegex.exec(line);
                    if (!allocMatch) {
                        prevLine = line;
                        continue;
                    }
                    const match = sectionRegex.exec(prevLine);
                    if (!match) { continue; }
                    const [, , name, size, address, load] = match;
                    const sectionStart = parseInt(address, 16);
                    const sectionSize = parseInt(size, 16);
                    if (sectionSize === 0) { continue; }
                    const sectionLoadStart = parseInt(load, 16);
                    for (const region of regions) {
                        const regionStart = region.startAddress;
                        const regionEnd = regionStart + region.size;
                        if (sectionStart >= regionStart && sectionStart < regionEnd) {
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
                        if (sectionLoadStart >= regionStart && sectionLoadStart < regionEnd && name === '.data') {
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
            console.error('Error parsing ELF sections:', error);
        }

        // Parse ELF symbols using nm
        try {
            const result = cp.spawnSync('arm-none-eabi-nm', ['-C', '-S', '-n', '-l', '--defined-only', elfFilePath]);
            if (result.error) {
                console.error('Error executing nm:', result.error);
            } else {
                const lines = result.stdout.toString().split('\n');
                for (const line of lines) {
                    const match = symbolRegex.exec(line);
                    if (!match) { continue; }
                    const [, address, size, type, name, path] = match;
                    const symbolStart = parseInt(address, 16);
                    const symbolSize = Number.isNaN(parseInt(size, 16)) ? 0 : parseInt(size, 16);
                    const pathMatch = pathRegex.exec(path || "");
                    let filePath: string = "";
                    let fileRow: number = 0;
                    if (pathMatch) {
                        filePath = pathMatch[1];
                        const fileRowStr = pathMatch[2];
                        fileRow = parseInt(fileRowStr, 10);
                    }
                    for (const region of regions) {
                        const regionStart = region.startAddress;
                        const regionEnd = regionStart + region.size;
                        if (symbolStart < regionStart || symbolStart >= regionEnd) { continue; }
                        for (const section of region.sections) {
                            const sectionStart = section.startAddress;
                            const sectionEnd = sectionStart + section.size;
                            if (symbolStart < sectionStart || symbolStart >= sectionEnd) { continue; }
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
            console.error('Error parsing ELF symbols:', error);
        }

        return regions;
    }

    private async openFileAtLine(filePath: string, lineNumber: number): Promise<void> {
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
            vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
        }
    }

    private getHtmlContent(webview: vscode.Webview): string {
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
                <button id="refreshPathsButton" class="button">Select Build Folder</button>
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

                window.addEventListener('message', (event) => {
                    const message = event.data;
                    if (message.command === 'showMapData') {
                        fillTableRegions(message.data);
                    }
                    if (message.command === 'resetMapData') {
                        resetTableRegions();
                    }
                });
            </script>
        </body>
        </html>`;
    }

    dispose(): void {
        if (this._fileWatcher) {
            this._fileWatcher.dispose();
        }
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const provider = new BuildAnalyzerProvider(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('stm32BuildAnalyzerEnhanced.openTab', () => {
            // Otwórz panel analizatora
            vscode.commands.executeCommand('workbench.view.extension.buildAnalyzerEnhancedPanel');
        }),

        vscode.commands.registerCommand('stm32BuildAnalyzerEnhanced.refresh', () => {
            provider.updateFilePaths();
        }),
        provider
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "buildAnalyzerEnhanced",
            provider
        )
    );
}

export function deactivate(): void {}