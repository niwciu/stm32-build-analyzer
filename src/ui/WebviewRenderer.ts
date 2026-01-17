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
                .button-container {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 10px;
                }
                #refreshButton,
                #refreshPathsButton {
                    padding: 5px 10px;
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
                #showSelectedButton {
                    padding: 5px 10px;
                    cursor: pointer;
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-secondaryBorder);
                    border-radius: 2px;
                }
                #showSelectedButton:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                #searchInput {
                    width: 220px;
                    padding: 4px 6px;
                    border-radius: 2px;
                    border: 1px solid var(--vscode-input-border);
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                }
                #searchInput::placeholder {
                    color: var(--vscode-input-placeholderForeground);
                }
                .case-toggle {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 2px 6px;
                    border-radius: 2px;
                    border: 1px solid var(--vscode-button-secondaryBorder);
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    cursor: pointer;
                    user-select: none;
                    font-size: 12px;
                }
                .case-toggle input {
                    margin: 0;
                }
                .sortable-header {
                    cursor: pointer;
                    user-select: none;
                }
                .sort-button {
                    margin-left: 6px;
                    padding: 0 4px;
                    border: 1px solid var(--vscode-button-secondaryBorder);
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border-radius: 2px;
                    font-size: 10px;
                    line-height: 1.2;
                    vertical-align: middle;
                }
                .sort-button[data-active="true"] {
                    border-color: var(--vscode-focusBorder);
                }
                .message-banner {
                    display: none;
                    margin-bottom: 10px;
                    padding: 6px 8px;
                    border-radius: 2px;
                    border: 1px solid var(--vscode-editorWidget-border);
                    background: var(--vscode-editorWidget-background);
                    color: var(--vscode-editorWidget-foreground);
                    font-size: 12px;
                }
                .message-banner.visible {
                    display: block;
                }
                .row-select {
                    margin-right: 6px;
                }
            </style>
        </head>
        <body>
            <div class="button-container">
                <button id="refreshButton" class="button">Refresh Analyze</button>
                <button id="refreshPathsButton" class="button">Change Build Folder</button>
                <button id="showSelectedButton" class="button" title="Show only selected objects">Show Selected</button>
                <input id="searchInput" type="text" placeholder="Search symbols..." />
                <label class="case-toggle" title="Case sensitive search">
                    <input type="checkbox" id="caseSensitiveToggle" />
                    Aa
                </label>
            </div>
            <div id="messageBanner" class="message-banner" role="status" aria-live="polite"></div>
            <div class="current-build-folder-path-container">
                <label><strong>Current Build Folder:</strong></label>
                <div id="buildFolderPath" style="margin-bottom: 10px;"></div>
            </div>

            <table id="regionsTable">
                <thead id="regionsHead">
                    <tr>
                        <td></td>
                        <td class="sortable-header" data-sort-key="name" title="Sort symbols by name">
                            Name <button class="sort-button" data-sort-key="name" data-active="false" aria-label="Sort by name">⇅</button>
                        </td>
                        <td class="sortable-header" data-sort-key="address" title="Sort symbols by address">
                            Address <button class="sort-button" data-sort-key="address" data-active="false" aria-label="Sort by address">⇅</button>
                        </td>
                        <td class="sortable-header" data-sort-key="size" title="Sort symbols by size">
                            Size <button class="sort-button" data-sort-key="size" data-active="false" aria-label="Sort by size">⇅</button>
                        </td>
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

                function cloneRegions(regions) {
                    return regions.map(region => ({
                        ...region,
                        sections: region.sections.map(section => ({
                            ...section,
                            symbols: [...section.symbols]
                        }))
                    }));
                }

                function compareSymbols(a, b, key, direction) {
                    let diff = 0;
                    if (key === 'name') {
                        diff = a.name.localeCompare(b.name);
                    } else if (key === 'address') {
                        diff = a.startAddress - b.startAddress;
                    } else if (key === 'size') {
                        diff = a.size - b.size;
                    }
                    return direction === 'asc' ? diff : -diff;
                }

                function sortSymbolsOnly(regions, sortState) {
                    const sortedRegions = cloneRegions(regions);
                    if (!sortState.key) {
                        return sortedRegions;
                    }
                    sortedRegions.forEach(region => {
                        region.sections.forEach(section => {
                            section.symbols.sort((a, b) => compareSymbols(a, b, sortState.key, sortState.direction));
                        });
                    });
                    return sortedRegions;
                }

                function normalizeText(value, caseSensitive) {
                    if (!value) {return '';}
                    return caseSensitive ? value : value.toLowerCase();
                }

                function includesText(value, query, caseSensitive) {
                    if (!query) {return true;}
                    return normalizeText(value, caseSensitive).includes(normalizeText(query, caseSensitive));
                }

                function getRegionKey(region) {
                    return 'region:' + region.name;
                }

                function getSectionKey(region, section) {
                    return 'section:' + region.name + '::' + section.name;
                }

                function getSymbolKey(region, section, symbol) {
                    return 'symbol:' + region.name + '::' + section.name + '::' + symbol.name + '::' + symbol.startAddress;
                }

                function filterRegions(regions, filterState) {
                    if (!filterState.query) {
                        return {
                            regions,
                            expanded: { regions: new Set(), sections: new Set() },
                            isFiltering: false
                        };
                    }

                    const expanded = { regions: new Set(), sections: new Set() };
                    const filtered = [];

                    regions.forEach(region => {
                        const regionKey = 'region:' + region.name;
                        const regionMatch = includesText(region.name, filterState.query, filterState.caseSensitive);
                        const filteredSections = [];

                        region.sections.forEach(section => {
                            const sectionKey = 'section:' + region.name + '::' + section.name;
                            const sectionMatch = includesText(section.name, filterState.query, filterState.caseSensitive);
                            const filteredSymbols = section.symbols.filter(symbol => {
                                const symbolMatch = includesText(symbol.name, filterState.query, filterState.caseSensitive);
                                const pathMatch = includesText(symbol.path, filterState.query, filterState.caseSensitive);
                                return symbolMatch || pathMatch;
                            });

                            if (sectionMatch || filteredSymbols.length > 0) {
                                if (filteredSymbols.length > 0) {
                                    expanded.sections.add(sectionKey);
                                }
                                filteredSections.push({
                                    ...section,
                                    symbols: filteredSymbols.length > 0 || sectionMatch
                                        ? filteredSymbols
                                        : []
                                });
                            }
                        });

                        if (regionMatch || filteredSections.length > 0) {
                            expanded.regions.add(regionKey);
                            filtered.push({
                                ...region,
                                sections: filteredSections
                            });
                        }
                    });

                    return { regions: filtered, expanded, isFiltering: true };
                }

                function filterSelectedRegions(regions) {
                    const filtered = [];

                    regions.forEach(region => {
                        const regionKey = getRegionKey(region);
                        const regionSelected = selectedState.has(regionKey);
                        const selectedSections = [];

                        region.sections.forEach(section => {
                            const sectionKey = getSectionKey(region, section);
                            const sectionSelected = selectedState.has(sectionKey);
                            const selectedSymbols = section.symbols.filter(symbol => {
                                return selectedState.has(getSymbolKey(region, section, symbol));
                            });

                            if (sectionSelected || selectedSymbols.length > 0) {
                                selectedSections.push({
                                    ...section,
                                    symbols: sectionSelected ? section.symbols : selectedSymbols
                                });
                            }
                        });

                        if (regionSelected || selectedSections.length > 0) {
                            filtered.push({
                                ...region,
                                sections: regionSelected ? region.sections : selectedSections
                            });
                        }
                    });

                    return filtered;
                }

                function buildExpandedState(regions) {
                    const expanded = { regions: new Set(), sections: new Set() };
                    regions.forEach(region => {
                        expanded.regions.add(getRegionKey(region));
                        region.sections.forEach(section => {
                            expanded.sections.add(getSectionKey(region, section));
                        });
                    });
                    return expanded;
                }
                    
                function fillTableRegions(regions, sortState, expandedState) {
                    const tableBody = document.getElementById('regionsBody');
                    tableBody.innerHTML = '';

                    let id = 0;

                    const displayRegions = sortSymbolsOnly(regions, sortState);

                    displayRegions.forEach(region => {
                        id++;
                        const regionKey = getRegionKey(region);
                        const percent = region.used / region.size * 100;
                        const isRegionExpanded = expandedState.regions.has(regionKey);

                        const tableTr = document.createElement('tr');
                        tableTr.className = 'toggleTr level-1';
                        tableTr.setAttribute('data-level', '1');
                        tableTr.setAttribute('data-id', regionKey);
                        
                        const tableTd1 = document.createElement('td');
                        tableTd1.appendChild(createSelectionCheckbox(regionKey));
                        const plus = document.createElement('span');
                        plus.className = 'toggle';
                        plus.textContent = isRegionExpanded ? '−' : '+';
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
                            const sectionKey = getSectionKey(region, section);
                            const isSectionExpanded = expandedState.sections.has(sectionKey);
                            const sectionTr = document.createElement('tr');
                            sectionTr.className = 'toggleTr level-2';
                            sectionTr.setAttribute('data-level', '2');
                            sectionTr.setAttribute('data-id', sectionKey);
                            sectionTr.setAttribute('data-parent', regionKey);
                            sectionTr.style.display = isRegionExpanded ? '' : 'none';

                            const sectionTd1 = document.createElement('td');
                            sectionTd1.appendChild(createSelectionCheckbox(sectionKey));
                            const plus = document.createElement('span');
                            plus.className = 'toggle';
                            plus.textContent = isSectionExpanded ? '−' : '+';
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
                                const symbolKey = getSymbolKey(region, section, symbol);
                                const pointTr = document.createElement('tr');
                                pointTr.className = 'toggleTr level-3';
                                pointTr.setAttribute('data-level', '3');
                                pointTr.setAttribute('data-id', symbolKey);
                                pointTr.setAttribute('data-parent', sectionKey);
                                pointTr.style.display = isRegionExpanded && isSectionExpanded ? '' : 'none';
                                
                                const pointTd1 = document.createElement('td');
                                pointTd1.appendChild(createSelectionCheckbox(symbolKey));
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
                    document.getElementById('showSelectedButton').addEventListener('click', () => {
                        const query = filterState.query.trim();
                        if (query) {
                            showMessage('Aby użyć „Show Selected”, wyczyść pole wyszukiwania „Search symbols...” i spróbuj ponownie.');
                            return;
                        }
                        if (selectedState.size === 0) {
                            showMessage('Aby użyć „Show Selected”, zaznacz co najmniej jeden obiekt w tabeli (kolumna z checkboxami po lewej).');
                            return;
                        }
                        isShowingSelected = !isShowingSelected;
                        updateShowSelectedButton();
                        renderRegions();
                    });

                    document.getElementById('searchInput').addEventListener('input', (event) => {
                        filterState.query = event.target.value ?? '';
                        if (filterState.query.trim() && isShowingSelected) {
                            isShowingSelected = false;
                            updateShowSelectedButton();
                        }
                        renderRegions();
                    });

                    document.getElementById('caseSensitiveToggle').addEventListener('change', (event) => {
                        filterState.caseSensitive = event.target.checked;
                        renderRegions();
                    });
                });

                let lastRegions = [];
                let sortState = { key: null, direction: 'asc' };
                const expandedState = { regions: new Set(), sections: new Set() };
                const filterState = { query: '', caseSensitive: false };
                const selectedState = new Set();
                let isShowingSelected = false;
                const messageBanner = document.getElementById('messageBanner');
                let messageTimer;

                function showMessage(text) {
                    messageBanner.textContent = text;
                    messageBanner.classList.add('visible');
                    if (messageTimer) {
                        clearTimeout(messageTimer);
                    }
                    messageTimer = setTimeout(() => {
                        messageBanner.classList.remove('visible');
                    }, 5000);
                }

                function updateShowSelectedButton() {
                    const button = document.getElementById('showSelectedButton');
                    button.textContent = isShowingSelected ? 'Show All' : 'Show Selected';
                    button.title = isShowingSelected ? 'Show all objects' : 'Show only selected objects';
                }

                function createSelectionCheckbox(rowId) {
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'row-select';
                    checkbox.dataset.rowId = rowId;
                    checkbox.checked = selectedState.has(rowId);
                    checkbox.setAttribute('aria-label', 'Select row');
                    checkbox.addEventListener('click', (event) => {
                        event.stopPropagation();
                    });
                    checkbox.addEventListener('change', () => {
                        if (checkbox.checked) {
                            selectedState.add(rowId);
                        } else {
                            selectedState.delete(rowId);
                        }
                        if (isShowingSelected) {
                            renderRegions();
                        }
                    });
                    return checkbox;
                }

                document.getElementById('regionsTable').addEventListener('click', (e) => {
                    const toggleSpan = e.target.closest('.toggle');
                    if (toggleSpan) {
                        const tr = toggleSpan.closest('tr');
                        const level = parseInt(tr.getAttribute('data-level'), 10);
                        const parentId = tr.getAttribute('data-id');

                        const childRows = document.querySelectorAll('tr[data-parent="' + parentId + '"]');
                        childRows.forEach(child => {
                            child.style.display = child.style.display === 'none' ? '' : 'none';
                            const childId = child.getAttribute('data-id');
                            const childLevel = parseInt(child.getAttribute('data-level'), 10);
                            if (child.style.display === 'none' && childLevel === 2) {
                                const grandChildRows = document.querySelectorAll('tr[data-parent="' + childId + '"]');
                                grandChildRows.forEach(grandChild => {
                                    if (grandChild.style.display !== 'none') {
                                        grandChild.style.display = 'none';
                                    }
                                });
                            }
                        });

                        const isExpanded = toggleSpan.textContent === '+';
                        toggleSpan.textContent = isExpanded ? '−' : '+';
                        if (level === 1) {
                            if (isExpanded) {
                                expandedState.regions.add(parentId);
                            } else {
                                expandedState.regions.delete(parentId);
                                const sectionRows = document.querySelectorAll('tr[data-parent="' + parentId + '"][data-level="2"]');
                                sectionRows.forEach(row => expandedState.sections.delete(row.getAttribute('data-id')));
                            }
                        }
                        if (level === 2) {
                            if (isExpanded) {
                                expandedState.sections.add(parentId);
                            } else {
                                expandedState.sections.delete(parentId);
                            }
                        }
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

                function renderRegions() {
                    let regionsToRender = lastRegions;
                    let expandedToUse = expandedState;

                    if (isShowingSelected) {
                        regionsToRender = filterSelectedRegions(lastRegions);
                        expandedToUse = buildExpandedState(regionsToRender);
                    } else {
                        const { regions, expanded, isFiltering } = filterRegions(lastRegions, filterState);
                        regionsToRender = regions;
                        expandedToUse = isFiltering
                            ? expanded
                            : expandedState;
                    }

                    resetTableRegions();
                    fillTableRegions(regionsToRender, sortState, expandedToUse);
                    updateSortIndicators();
                }

                function updateSortIndicators() {
                    document.querySelectorAll('.sort-button').forEach(button => {
                        const key = button.dataset.sortKey;
                        const isActive = sortState.key === key;
                        button.dataset.active = isActive ? 'true' : 'false';
                        if (!isActive) {
                            button.textContent = '⇅';
                            return;
                        }
                        button.textContent = sortState.direction === 'asc' ? '▲' : '▼';
                    });
                }

                document.getElementById('regionsHead').addEventListener('click', (event) => {
                    const header = event.target.closest('.sortable-header');
                    if (!header) {return;}
                    const key = header.dataset.sortKey;
                    if (!key) {return;}
                    if (sortState.key === key) {
                        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        sortState = { key, direction: 'asc' };
                    }
                    updateSortIndicators();
                    if (lastRegions.length > 0) {
                        renderRegions();
                    }
                });

                window.addEventListener('message', event => {
                    const message = event.data;

                    switch (message.command) {
                        case 'showMapData':
                            lastRegions = message.data ?? [];
                            selectedState.clear();
                            isShowingSelected = false;
                            updateShowSelectedButton();
                            renderRegions();
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
