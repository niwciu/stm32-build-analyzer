// Build Analyzer Webview Script
// This script runs inside the VS Code webview

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

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
    symbols: Symbol[];
}

interface Symbol {
    name: string;
    startAddress: number;
    size: number;
    path: string;
    row: number;
}

interface IconUris {
    icon1Uri: string;
    icon2Uri: string;
    icon3Uri: string;
}

type ViewMode = 'classic' | 'table';

interface ViewTableConfig {
    view: ViewMode;
    container: HTMLElement | null;
    table: HTMLTableElement | null;
    body: HTMLTableSectionElement | null;
    head: HTMLElement | null;
}

interface SortState {
    field: string | null;
    isAscending: boolean;
}

const vscode = acquireVsCodeApi();

const viewConfigs: Record<ViewMode, ViewTableConfig> = {
    classic: {
        view: 'classic',
        container: document.getElementById('classicView'),
        table: document.getElementById('regionsTable') as HTMLTableElement | null,
        body: document.getElementById('regionsBody') as HTMLTableSectionElement | null,
        head: document.getElementById('regionsHead')
    },
    table: {
        view: 'table',
        container: document.getElementById('tableView'),
        table: document.getElementById('regionsTableModern') as HTMLTableElement | null,
        body: document.getElementById('regionsBodyModern') as HTMLTableSectionElement | null,
        head: document.getElementById('regionsHeadModern')
    }
};

const sortStates: Record<ViewMode, SortState> = {
    classic: { field: null, isAscending: true },
    table: { field: null, isAscending: true }
};

let currentView: ViewMode = 'classic';
let lastRegions: Region[] = [];
const expandedKeys = new Set<string>();
let selectedRowKey: string | null = null;
const selectedKeys = new Set<string>();
let showSelectedOnly = false;

// Get icon URIs from data attributes on body
function getIconUris(): IconUris {
    const body = document.body;
    return {
        icon1Uri: body.dataset.icon1Uri || '',
        icon2Uri: body.dataset.icon2Uri || '',
        icon3Uri: body.dataset.icon3Uri || ''
    };
}

function formatBytes(bytes: number, decimals = 2): string {
    if (bytes <= 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));
    return `${value} ${sizes[i]}`;
}

function resetTableRegions(tableBody: HTMLTableSectionElement | null): void {
    if (tableBody) {
        tableBody.innerHTML = '';
    }
}

function buildRegionKey(region: Region): string {
    return `region:${region.name}`;
}

function buildSectionKey(region: Region, section: Section): string {
    return `section:${region.name}::${section.name}`;
}

function fillTableRegions(regions: Region[], tableBody: HTMLTableSectionElement, icons: IconUris): void {
    tableBody.innerHTML = '';

    let id = 0;

    regions.forEach(region => {
        id++;
        const regionId = id;
        const regionKey = buildRegionKey(region);
        const percent = region.used / region.size * 100;

        const tableTr = document.createElement('tr');
        tableTr.className = 'toggleTr level-1';
        tableTr.setAttribute('data-level', '1');
        tableTr.setAttribute('data-id', regionId.toString());
        tableTr.setAttribute('data-key', regionKey);

        const tableTd1 = document.createElement('td');
        const plus = document.createElement('span');
        plus.className = 'toggle';
        plus.textContent = '+';
        tableTd1.appendChild(plus);

        const bar = document.createElement('div');
        bar.className = 'bar';
        const progress = document.createElement('div');
        progress.setAttribute('style', `
            width: ${percent}%; 
            background-color: ${percent > 95 ? 'var(--vscode-minimap-errorHighlight)' : 
                             percent > 75 ? 'var(--vscode-minimap-warningHighlight)' : 
                             'var(--vscode-minimap-infoHighlight)'}; 
            height: 100%;
            color: ${percent > 50 ? 'white' : 'black'};
            text-align: center;
            font-size: 0.85em;
            line-height: 1.4em;
        `);
        progress.textContent = `${percent.toFixed(2)}%`;
        bar.appendChild(progress);
        tableTd1.appendChild(bar);

        const tableTd2 = document.createElement('td');
        const img = document.createElement('img');
        img.src = icons.icon1Uri;
        img.alt = 'Icon';
        img.style.width = '16px';
        img.style.height = '16px';
        img.style.verticalAlign = 'middle';
        img.style.marginRight = '5px';
        tableTd2.appendChild(img); 
        tableTd2.appendChild(document.createTextNode(` ${region.name} `));

        const tableTd3 = document.createElement('td');
        tableTd3.appendChild(document.createTextNode(`0x${region.startAddress.toString(16).padStart(8,'0')}`));

        const tableTd4 = document.createElement('td');
        tableTd4.className = 'right-align';
        tableTd4.appendChild(document.createTextNode(formatBytes(region.size)));

        const tableTd5 = document.createElement('td');
        tableTd5.className = 'right-align';
        tableTd5.appendChild(document.createTextNode(formatBytes(region.used)));

        const tableTd6 = document.createElement('td');
        tableTd6.className = 'right-align';
        tableTd6.appendChild(document.createTextNode(formatBytes(region.size - region.used)));

        const tableTdSelect = document.createElement('td');
        tableTdSelect.className = 'selection-cell';

        tableTr.appendChild(tableTd1);
        tableTr.appendChild(tableTdSelect);
        tableTr.appendChild(tableTd2);
        tableTr.appendChild(tableTd3);
        tableTr.appendChild(tableTd4);
        tableTr.appendChild(tableTd5);
        tableTr.appendChild(tableTd6);
        tableBody.appendChild(tableTr);

        region.sections.forEach(section => {
            id++;
            const sectionId = id;
            const sectionKey = buildSectionKey(region, section);
            const sectionTr = document.createElement('tr');
            sectionTr.className = 'toggleTr level-2';
            sectionTr.setAttribute('data-level', '2');
            sectionTr.setAttribute('data-id', sectionId.toString());
            sectionTr.setAttribute('data-parent', regionId.toString());
            sectionTr.setAttribute('data-key', sectionKey);
            sectionTr.style.display = 'none';

            const sectionTd1 = document.createElement('td');
            const sectionPlus = document.createElement('span');
            sectionPlus.className = 'toggle';
            sectionPlus.textContent = '+';
            sectionTd1.appendChild(sectionPlus);

            const sectionTd2 = document.createElement('td');
            const sectionImg = document.createElement('img');
            sectionImg.src = icons.icon2Uri;
            sectionImg.alt = 'Icon';
            sectionImg.style.width = '16px';
            sectionImg.style.height = '16px';
            sectionImg.style.verticalAlign = 'middle';
            sectionImg.style.marginRight = '5px';
            sectionTd2.appendChild(sectionImg);
            sectionTd2.appendChild(document.createTextNode(` ${section.name} `));
            sectionTd2.style.paddingLeft = '15px';

            const sectionTd3 = document.createElement('td');
            sectionTd3.appendChild(document.createTextNode(`0x${section.startAddress.toString(16).padStart(8,'0')}`));

            const sectionTd4 = document.createElement('td');
            sectionTd4.className = 'right-align';
            sectionTd4.appendChild(document.createTextNode(formatBytes(section.size)));

            const sectionTd5 = document.createElement('td');
            sectionTd5.className = 'right-align';
            const sectionTd6 = document.createElement('td');
            sectionTd6.className = 'right-align';

            const sectionTdSelect = document.createElement('td');
            sectionTdSelect.className = 'selection-cell';

            sectionTr.appendChild(sectionTd1);
            sectionTr.appendChild(sectionTdSelect);
            sectionTr.appendChild(sectionTd2);
            sectionTr.appendChild(sectionTd3);
            sectionTr.appendChild(sectionTd4);
            sectionTr.appendChild(sectionTd5);
            sectionTr.appendChild(sectionTd6);
            tableBody.appendChild(sectionTr);

            let symbolIndex = 0;
            section.symbols.forEach(symbol => {
                id++;
                symbolIndex++;
                const pointTr = document.createElement('tr');
                pointTr.className = 'toggleTr level-3';
                pointTr.setAttribute('data-level', '3');
                pointTr.setAttribute('data-id', id.toString());
                pointTr.setAttribute('data-parent', sectionId.toString());
                pointTr.setAttribute('data-original-index', symbolIndex.toString());
                pointTr.setAttribute('data-key', `${sectionKey}::${symbol.name}::${symbol.startAddress}`);
                pointTr.style.display = 'none';

                const pointTd1 = document.createElement('td');
                const pointTd2 = document.createElement('td');
                pointTd2.setAttribute('title', `${symbol.path}:${symbol.row}`);

                const symbolImg = document.createElement('img');
                symbolImg.src = icons.icon3Uri;
                symbolImg.alt = 'Icon';
                symbolImg.style.width = '16px';
                symbolImg.style.height = '16px';
                symbolImg.style.verticalAlign = 'middle';
                symbolImg.style.marginRight = '5px';
                pointTd2.appendChild(symbolImg); 

                if (symbol.path === '') {
                    pointTd2.appendChild(document.createTextNode(` ${symbol.name} `));
                } else {
                    const link = document.createElement('a');
                    link.className = 'source-link';
                    link.href = '#';
                    link.dataset.file = symbol.path;
                    link.dataset.line = symbol.row.toString();
                    link.appendChild(document.createTextNode(` ${symbol.name} `));
                    pointTd2.appendChild(link);
                }
                pointTd2.style.paddingLeft = '25px';

                const pointTd3 = document.createElement('td');
                pointTd3.appendChild(document.createTextNode(`0x${symbol.startAddress.toString(16).padStart(8,'0')}`));

                const pointTd4 = document.createElement('td');
                pointTd4.className = 'right-align';
                pointTd4.appendChild(document.createTextNode(`${symbol.size} B`));

                const pointTd5 = document.createElement('td');
                pointTd5.className = 'right-align';
                const pointTd6 = document.createElement('td');
                pointTd6.className = 'right-align';

                const pointTdSelect = document.createElement('td');
                pointTdSelect.className = 'selection-cell';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'row-select';
                checkbox.dataset.key = pointTr.getAttribute('data-key') || '';
                checkbox.checked = checkbox.dataset.key ? selectedKeys.has(checkbox.dataset.key) : false;
                pointTdSelect.appendChild(checkbox);

                pointTr.appendChild(pointTd1);
                pointTr.appendChild(pointTdSelect);
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

function parseSizeToBytes(sizeText: string): number {
    const match = sizeText.match(/([\d.]+)\s*(B|KB|MB|GB|TB)?/i);
    if (!match) {
      return 0;
    }

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();
    const multipliers: Record<string, number> = { 
        'B': 1, 
        'KB': 1024, 
        'MB': 1024 * 1024, 
        'GB': 1024 * 1024 * 1024, 
        'TB': 1024 * 1024 * 1024 * 1024 
    };
    return value * (multipliers[unit] || 1);
}

function getColumnSelector(view: ViewMode, field: 'name' | 'address' | 'size'): string {
    if (view === 'table') {
        if (field === 'name') {
            return 'td:nth-child(3)';
        }
        if (field === 'address') {
            return 'td:nth-child(4)';
        }
        return 'td:nth-child(5)';
    }
    if (field === 'name') {
        return 'td:nth-child(3)';
    }
    if (field === 'address') {
        return 'td:nth-child(4)';
    }
    return 'td:nth-child(5)';
}

function performSearch(query: string, table: HTMLTableElement): void {
    const searchMatchCount = document.getElementById('searchMatchCount');
    const allRows = table.querySelectorAll<HTMLTableRowElement>('.toggleTr');
    const caseSensitiveBtn = document.getElementById('caseSensitive');
    const wholeWordBtn = document.getElementById('wholeWord');
    const useRegexBtn = document.getElementById('useRegex');

    const caseSensitive = caseSensitiveBtn?.classList.contains('active') ?? false;
    const wholeWord = wholeWordBtn?.classList.contains('active') ?? false;
    const useRegex = useRegexBtn?.classList.contains('active') ?? false;

    table.querySelectorAll<HTMLElement>('.search-highlight').forEach((el: HTMLElement) => {
        el.classList.remove('search-highlight');
    });

    let matchCount = 0;
    const normalizedQuery = query.trim();
    const hasQuery = normalizedQuery.length > 0;
    const isTableViewTable = table === viewConfigs.table.table;
    const hasSelectionFilter = showSelectedOnly;
    const currentViewMode: ViewMode = isTableViewTable ? 'table' : 'classic';
    const nameSelector = getColumnSelector(currentViewMode, 'name');

    if (!hasQuery && !hasSelectionFilter) {
        syncExpandedState();
        if (searchMatchCount) {
            searchMatchCount.textContent = '';
        }
        return;
    }

    let matcher: (text: string) => boolean;
    try {
        if (useRegex) {
            const flags = caseSensitive ? '' : 'i';
            const pattern = wholeWord ? '\\b' + normalizedQuery + '\\b' : normalizedQuery;
            const regex = new RegExp(pattern, flags);
            matcher = (text: string) => regex.test(text);
        } else {
            const searchQuery = caseSensitive ? normalizedQuery : normalizedQuery.toLowerCase();
            if (wholeWord) {
                matcher = (text: string) => {
                    const searchIn = caseSensitive ? text : text.toLowerCase();
                    const idx = searchIn.indexOf(searchQuery);
                    if (idx === -1) {
                      return false;
                    }
                    const before = idx === 0 || !/[a-zA-Z0-9_]/.test(searchIn[idx - 1]);
                    const after = idx + searchQuery.length >= searchIn.length || !/[a-zA-Z0-9_]/.test(searchIn[idx + searchQuery.length]);
                    return before && after;
                };
            } else {
                matcher = (text: string) => {
                    const searchIn = caseSensitive ? text : text.toLowerCase();
                    return searchIn.includes(searchQuery);
                };
            }
        }
    } catch (e) {
        if (searchMatchCount) {
          searchMatchCount.textContent = 'Invalid regex';
        }
        return;
    }

    const parentsToShow = new Set<string>();

    const matchesSelection = (row: HTMLTableRowElement): boolean => {
        if (!hasSelectionFilter || hasQuery) {
            return true;
        }
        const rowKey = row.getAttribute('data-key') || '';
        return rowKey ? selectedKeys.has(rowKey) : false;
    };

    allRows.forEach((row: HTMLTableRowElement) => {
        const htmlRow = row as HTMLElement;
        const level = parseInt(htmlRow.getAttribute('data-level') || '0', 10);
        if (level === 3) {
            const nameCell = htmlRow.querySelector(nameSelector);
            const symbolName = nameCell ? nameCell.textContent?.trim() || '' : '';
            const matchesQuery = hasQuery ? matcher(symbolName) : true;
            if (matchesQuery && matchesSelection(row)) {
                matchCount++;
                htmlRow.style.display = '';
                if (hasQuery) {
                    nameCell?.classList.add('search-highlight');
                }

                const sectionId = htmlRow.getAttribute('data-parent');
                if (sectionId) {
                  parentsToShow.add(sectionId);
                }

                const sectionRow = table.querySelector(`tr[data-id="${sectionId}"]`);
                if (sectionRow) {
                    const regionId = sectionRow.getAttribute('data-parent');
                    if (regionId) {
                      parentsToShow.add(regionId);
                    }
                }
            } else {
                htmlRow.style.display = 'none';
            }
        }
    });

    allRows.forEach((row: HTMLTableRowElement) => {
        const htmlRow = row as HTMLElement;
        const level = parseInt(htmlRow.getAttribute('data-level') || '0', 10);
        const id = htmlRow.getAttribute('data-id') || '';
        const toggle = htmlRow.querySelector('.toggle');

        if (level === 1) {
            if (parentsToShow.has(id)) {
                htmlRow.style.display = '';
                if (toggle) {
                  toggle.textContent = '−';
                }
            } else {
                htmlRow.style.display = 'none';
                if (toggle) {
                  toggle.textContent = '+';
                }
            }
        } else if (level === 2) {
            if (parentsToShow.has(id)) {
                htmlRow.style.display = '';
                if (toggle) {
                  toggle.textContent = '−';
                }
            } else {
                htmlRow.style.display = 'none';
                if (toggle) {
                  toggle.textContent = '+';
                }
            }
        }
    });

    if (searchMatchCount) {
        if (hasQuery) {
            searchMatchCount.textContent = matchCount > 0
                ? 'Found: ' + matchCount + ' symbols'
                : 'No matches';
        } else if (hasSelectionFilter) {
            searchMatchCount.textContent = matchCount > 0
                ? 'Selected: ' + matchCount + ' symbols'
                : 'No matches';
        } else {
            searchMatchCount.textContent = '';
        }
    }
}

let tooltipTimeout: ReturnType<typeof setTimeout> | null = null;

function showTemporaryTooltip(anchor: HTMLElement, message: string, timeoutMs = 3000): void {
    let tooltip = document.getElementById('selectionTooltip') as HTMLDivElement | null;
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'selectionTooltip';
        tooltip.className = 'tooltip-bubble';
        document.body.appendChild(tooltip);
    }

    tooltip.textContent = message;
    tooltip.classList.add('is-visible');

    const anchorRect = anchor.getBoundingClientRect();
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;

    tooltip.style.left = `${anchorRect.left + scrollX}px`;
    tooltip.style.top = `${anchorRect.bottom + scrollY + 6}px`;

    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
    }
    tooltipTimeout = setTimeout(() => {
        tooltip?.classList.remove('is-visible');
    }, timeoutMs);
}

function applySorting(field: string, isAscending: boolean, tableBody: HTMLTableSectionElement, view: ViewMode): void {
    const allRows = Array.from(tableBody.querySelectorAll<HTMLTableRowElement>('.toggleTr'));
    const nameSelector = getColumnSelector(view, 'name');
    const addressSelector = getColumnSelector(view, 'address');
    const sizeSelector = getColumnSelector(view, 'size');

    interface RegionGroup {
        row: HTMLTableRowElement;
        sections: SectionGroup[];
    }
    interface SectionGroup {
        row: HTMLTableRowElement;
        symbols: HTMLTableRowElement[];
    }

    const regions: RegionGroup[] = [];
    let currentRegion: RegionGroup | null = null;
    let currentSection: SectionGroup | null = null;

    allRows.forEach((row: HTMLTableRowElement) => {
        const level = parseInt(row.getAttribute('data-level') || '0', 10);
        if (level === 1) {
            currentRegion = { row: row, sections: [] };
            regions.push(currentRegion);
            currentSection = null;
        } else if (level === 2 && currentRegion) {
            currentSection = { row: row, symbols: [] };
            currentRegion.sections.push(currentSection);
        } else if (level === 3 && currentSection) {
            currentSection.symbols.push(row);
        }
    });

    regions.forEach(region => {
        region.sections.forEach(section => {
            section.symbols.sort((a, b) => {
                if (field === 'original') {
                    const valA = parseInt(a.getAttribute('data-original-index') || '0', 10);
                    const valB = parseInt(b.getAttribute('data-original-index') || '0', 10);
                    return valA - valB;
                }
                if (field === 'name') {
                    const valA = (a.querySelector(nameSelector)?.textContent?.trim() || '').toLowerCase();
                    const valB = (b.querySelector(nameSelector)?.textContent?.trim() || '').toLowerCase();
                    return isAscending ? valA.localeCompare(valB) : valB.localeCompare(valA);
                }
                if (field === 'address') {
                    const addrTextA = a.querySelector(addressSelector)?.textContent?.trim() || '';
                    const addrTextB = b.querySelector(addressSelector)?.textContent?.trim() || '';
                    const valA = parseInt(addrTextA, 16) || 0;
                    const valB = parseInt(addrTextB, 16) || 0;
                    return isAscending ? valA - valB : valB - valA;
                }
                if (field === 'size') {
                    const sizeTextA = a.querySelector(sizeSelector)?.textContent?.trim() || '';
                    const sizeTextB = b.querySelector(sizeSelector)?.textContent?.trim() || '';
                    const valA = parseSizeToBytes(sizeTextA);
                    const valB = parseSizeToBytes(sizeTextB);
                    return isAscending ? valA - valB : valB - valA;
                }
                return 0;
            });
        });
    });

    tableBody.innerHTML = '';
    let newId = 0;
    regions.forEach(region => {
        newId++;
        const regionId = newId;
        region.row.setAttribute('data-id', regionId.toString());
        tableBody.appendChild(region.row);

        region.sections.forEach(section => {
            newId++;
            const sectionId = newId;
            section.row.setAttribute('data-id', sectionId.toString());
            section.row.setAttribute('data-parent', regionId.toString());
            tableBody.appendChild(section.row);

            section.symbols.forEach(symbol => {
                newId++;
                symbol.setAttribute('data-id', newId.toString());
                symbol.setAttribute('data-parent', sectionId.toString());
                tableBody.appendChild(symbol);
            });
        });
    });
}

function applyExpandedState(table: HTMLTableElement): void {
    const rows = table.querySelectorAll<HTMLTableRowElement>('.toggleTr');
    const regionExpandedById = new Map<string, boolean>();
    const sectionExpandedById = new Map<string, boolean>();

    rows.forEach((row: HTMLTableRowElement) => {
        const level = parseInt(row.getAttribute('data-level') || '0', 10);
        const rowId = row.getAttribute('data-id') || '';
        const rowKey = row.getAttribute('data-key') || '';
        const toggle = row.querySelector('.toggle');

        if (level === 1) {
            const isExpanded = rowKey ? expandedKeys.has(rowKey) : false;
            regionExpandedById.set(rowId, isExpanded);
            row.style.display = '';
            if (toggle) {
                toggle.textContent = isExpanded ? '−' : '+';
            }
        } else if (level === 2) {
            const parentId = row.getAttribute('data-parent') || '';
            const parentExpanded = regionExpandedById.get(parentId) ?? false;
            const isExpanded = parentExpanded && (rowKey ? expandedKeys.has(rowKey) : false);
            sectionExpandedById.set(rowId, isExpanded);
            row.style.display = parentExpanded ? '' : 'none';
            if (toggle) {
                toggle.textContent = isExpanded ? '−' : '+';
            }
        } else if (level === 3) {
            const parentId = row.getAttribute('data-parent') || '';
            const parentExpanded = sectionExpandedById.get(parentId) ?? false;
            row.style.display = parentExpanded ? '' : 'none';
        }
    });
}

function syncExpandedState(): void {
    (Object.keys(viewConfigs) as ViewMode[]).forEach(view => {
        const table = viewConfigs[view].table;
        if (table) {
            applyExpandedState(table);
        }
    });
}

function clearRowSelection(): void {
    (Object.keys(viewConfigs) as ViewMode[]).forEach(view => {
        const table = viewConfigs[view].table;
        if (!table) {
            return;
        }
        table.querySelectorAll<HTMLTableRowElement>('tr.row-selected').forEach(row => {
            row.classList.remove('row-selected');
        });
    });
    selectedRowKey = null;
}

function syncSelectionCheckboxes(): void {
    (Object.keys(viewConfigs) as ViewMode[]).forEach(view => {
        const table = viewConfigs[view].table;
        if (!table) {
            return;
        }
        table.querySelectorAll<HTMLInputElement>('input.row-select').forEach(input => {
            const rowKey = input.dataset.key;
            input.checked = rowKey ? selectedKeys.has(rowKey) : false;
        });
    });
}

function setRowSelection(row: HTMLTableRowElement | null): void {
    clearRowSelection();
    if (!row) {
        return;
    }
    row.classList.add('row-selected');
    selectedRowKey = row.getAttribute('data-key') || null;
}

function syncRowSelection(): void {
    if (!selectedRowKey) {
        return;
    }
    (Object.keys(viewConfigs) as ViewMode[]).forEach(view => {
        const table = viewConfigs[view].table;
        if (!table) {
            return;
        }
        const row = table.querySelector<HTMLTableRowElement>(`tr[data-key="${selectedRowKey}"]`);
        if (row) {
            row.classList.add('row-selected');
        }
    });
}

function updateSortIndicators(view: ViewMode, sortState: SortState): void {
    const config = viewConfigs[view];
    const table = config.table;
    if (!table) {
        return;
    }

    table.querySelectorAll<HTMLElement>('.sort-indicator').forEach((indicator: HTMLElement) => {
        indicator.textContent = '↕';
        indicator.classList.remove('active');
    });

    table.querySelectorAll<HTMLButtonElement>('.sort-button').forEach((button: HTMLButtonElement) => {
        button.dataset.active = 'false';
        button.textContent = '⇅';
    });

    if (sortState.field) {
        const indicator = table.querySelector<HTMLElement>('#sort-' + sortState.field);
        if (indicator) {
            indicator.textContent = sortState.isAscending ? '↑' : '↓';
            indicator.classList.add('active');
        }

        const button = table.querySelector<HTMLButtonElement>(`.sort-button[data-sort-key="${sortState.field}"]`);
        if (button) {
            button.dataset.active = 'true';
            button.textContent = sortState.isAscending ? '▲' : '▼';
        }
    }
}

function attachTableHandlers(view: ViewMode): void {
    const config = viewConfigs[view];
    const table = config.table;
    const body = config.body;
    const head = config.head;

    if (!table || !body || !head) {
        return;
    }

    head.querySelectorAll<HTMLElement>('.sortable-header').forEach((header: HTMLElement) => {
        header.addEventListener('click', () => {
            const field = header.getAttribute('data-sort');
            if (!field) {
              return;
            }

            const sortState = sortStates[view];
            if (sortState.field === field) {
                if (sortState.isAscending) {
                    sortState.isAscending = false;
                } else {
                    sortState.field = null;
                    sortState.isAscending = true;
                    updateSortIndicators(view, sortState);
                    applySorting('original', sortState.isAscending, body, view);
                    return;
                }
            } else {
                sortState.field = field;
                sortState.isAscending = true;
            }

            updateSortIndicators(view, sortState);
            applySorting(field, sortState.isAscending, body, view);
        });
    });

    table.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const sourceLink = target.closest('.source-link') as HTMLAnchorElement | null;
        const clickedRow = target.closest('tr.toggleTr') as HTMLTableRowElement | null;
        const selectionInput = target.closest('input.row-select') as HTMLInputElement | null;

        if (clickedRow) {
            setRowSelection(clickedRow);
            syncRowSelection();
        }

        if (sourceLink) {
            e.preventDefault();
            const scrollContainer = document.getElementById('scroll-container') as HTMLElement;
            const scrollTop = scrollContainer.scrollTop;
            vscode.postMessage({
                command: 'openFile',
                filePath: sourceLink.dataset.file,
                lineNumber: parseInt(sourceLink.dataset.line || '0', 10),
                scrollTop: scrollTop
            });
            return;
        }

        if (selectionInput) {
            const rowKey = selectionInput.dataset.key;
            if (rowKey) {
                if (selectionInput.checked) {
                    selectedKeys.add(rowKey);
                } else {
                    selectedKeys.delete(rowKey);
                }
            }
            syncSelectionCheckboxes();
            if (showSelectedOnly) {
                const tableElement = viewConfigs[currentView].table;
                if (tableElement) {
                    const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
                    performSearch(searchInput?.value ?? '', tableElement);
                }
            }
        }

        const toggleSpan = target.closest('.toggle');
        const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;

        if (searchInput && searchInput.value) {
            return;
        }

        if (toggleSpan) {
            const tr = toggleSpan.closest('tr');
            if (!tr) {
              return;
            }

            const parentId = tr.getAttribute('data-id');
            const rowKey = tr.getAttribute('data-key') || '';
            const rowLevel = parseInt(tr.getAttribute('data-level') || '0', 10);
            const childRows = table.querySelectorAll<HTMLTableRowElement>(`tr[data-parent="${parentId}"]`);

            childRows.forEach((child: HTMLTableRowElement) => {
                const htmlChild = child as HTMLElement;
                htmlChild.style.display = htmlChild.style.display === 'none' ? '' : 'none';
                
                if (htmlChild.style.display === 'none') {
                    const toggle = htmlChild.querySelector('.toggle');
                    if (toggle) {
                      toggle.textContent = '+';
                    }
                }

                const childId = child.getAttribute('data-id');
                const childLevel = parseInt(child.getAttribute('data-level') || '0', 10);

                if (htmlChild.style.display === 'none' && childLevel === 2) {
                    const grandChildRows = table.querySelectorAll<HTMLTableRowElement>(`tr[data-parent="${childId}"]`);
                    grandChildRows.forEach((grandChild: HTMLTableRowElement) => {
                        const htmlGrandChild = grandChild as HTMLElement;
                        if (htmlGrandChild.style.display !== 'none') {
                            htmlGrandChild.style.display = 'none';
                        }
                    });
                }
            });

            toggleSpan.textContent = toggleSpan.textContent === '+' ? '−' : '+';
            if (rowKey && rowLevel <= 2) {
                if (toggleSpan.textContent === '−') {
                    expandedKeys.add(rowKey);
                } else {
                    expandedKeys.delete(rowKey);
                }
                syncExpandedState();
            }
        }
    });
}

function setView(nextView: ViewMode): void {
    currentView = nextView;
    document.body.classList.toggle('classic-view', currentView === 'classic');
    document.body.classList.toggle('table-view', currentView === 'table');
    viewConfigs.classic.container?.classList.toggle('is-hidden', currentView !== 'classic');
    viewConfigs.table.container?.classList.toggle('is-hidden', currentView !== 'table');

    const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
    if (searchInput && searchInput.value) {
        const table = viewConfigs[currentView].table;
        if (table) {
            performSearch(searchInput.value.trim(), table);
        }
    } else if (currentView === 'table') {
        const table = viewConfigs.table.table;
        if (table) {
            performSearch('', table);
        }
    }
    syncRowSelection();
    syncSelectionCheckboxes();
}

function renderTables(regions: Region[]): void {
    const icons = getIconUris();

    (Object.keys(viewConfigs) as ViewMode[]).forEach(view => {
        const config = viewConfigs[view];
        if (!config.body) {
            return;
        }
        resetTableRegions(config.body);
        fillTableRegions(regions, config.body, icons);
        updateSortIndicators(view, sortStates[view]);
    });
    syncExpandedState();
    syncRowSelection();
    syncSelectionCheckboxes();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    vscode.postMessage({ command: 'requestRefresh' });

    const refreshButton = document.getElementById('refreshButton');
    const refreshPathsButton = document.getElementById('refreshPathsButton');
    const viewSelect = document.getElementById('viewSelect') as HTMLSelectElement | null;
    const toggleSelectionButton = document.getElementById('toggleSelectionButton') as HTMLButtonElement | null;
    const clearSelectionButton = document.getElementById('clearSelectionButton') as HTMLButtonElement | null;
    const clearSelectionButtonClassic = document.getElementById('clearSelectionButtonClassic') as HTMLButtonElement | null;

    refreshButton?.addEventListener('click', () => {
        vscode.postMessage({ command: 'requestRefresh' });
    });

    refreshPathsButton?.addEventListener('click', () => {
        vscode.postMessage({ command: 'refreshPaths' });
    });

    viewSelect?.addEventListener('change', () => {
        const nextView = (viewSelect.value as ViewMode) || 'classic';
        setView(nextView);
    });

    const updateSelectionToggleLabel = () => {
        if (!toggleSelectionButton) {
            return;
        }
        toggleSelectionButton.textContent = showSelectedOnly ? 'Show All' : 'Show Selected';
    };

    toggleSelectionButton?.addEventListener('click', () => {
        const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
        const hasSearchQuery = (searchInput?.value ?? '').trim().length > 0;

        if (!showSelectedOnly) {
            if (hasSearchQuery) {
                if (toggleSelectionButton) {
                    showTemporaryTooltip(toggleSelectionButton, 'Clear the search box to show selected items.');
                }
                return;
            }
            if (selectedKeys.size === 0) {
                if (toggleSelectionButton) {
                    showTemporaryTooltip(toggleSelectionButton, 'Select at least one item in the Sel column to use Show Selected.');
                }
                return;
            }
        }

        showSelectedOnly = !showSelectedOnly;
        updateSelectionToggleLabel();
        const table = viewConfigs[currentView].table;
        if (table) {
            performSearch(searchInput?.value ?? '', table);
        }
    });

    const clearSelection = () => {
        selectedKeys.clear();
        const table = viewConfigs.table.table;
        if (table) {
            table.querySelectorAll<HTMLInputElement>('input.row-select').forEach(input => {
                input.checked = false;
            });
        }
        syncSelectionCheckboxes();
        if (showSelectedOnly) {
            const tableElement = viewConfigs[currentView].table;
            if (tableElement) {
                const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
                performSearch(searchInput?.value ?? '', tableElement);
            }
        }
    };

    clearSelectionButton?.addEventListener('click', clearSelection);
    clearSelectionButtonClassic?.addEventListener('click', clearSelection);

    const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
    const caseSensitiveBtn = document.getElementById('caseSensitive');
    const wholeWordBtn = document.getElementById('wholeWord');
    const useRegexBtn = document.getElementById('useRegex');

    let searchTimeout: ReturnType<typeof setTimeout>;

    searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            if (showSelectedOnly && searchInput.value.trim().length > 0) {
                showSelectedOnly = false;
                updateSelectionToggleLabel();
            }
            const table = viewConfigs[currentView].table;
            if (table) {
                performSearch(searchInput.value.trim(), table);
            }
        }, 200);
    });

    searchInput?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            const table = viewConfigs[currentView].table;
            if (table) {
                performSearch('', table);
            }
        }
    });

    [caseSensitiveBtn, wholeWordBtn, useRegexBtn].forEach(btn => {
        btn?.addEventListener('click', () => {
            btn.classList.toggle('active');
            if (searchInput) {
              const table = viewConfigs[currentView].table;
              if (table) {
                performSearch(searchInput.value.trim(), table);
              }
            }
        });
    });

    attachTableHandlers('classic');
    attachTableHandlers('table');
    setView(currentView);
    updateSelectionToggleLabel();

    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('table')) {
            return;
        }
        clearRowSelection();
    });
});

// Handle messages from extension
window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data;

    switch (message.command) {
        case 'showMapData':
            lastRegions = message.data || [];
            selectedKeys.clear();
            showSelectedOnly = false;
            renderTables(lastRegions);
            if (message.currentBuildFolderRelativePath) {
                const folderDiv = document.getElementById('buildFolderPath');
                if (folderDiv) {
                    folderDiv.textContent = message.currentBuildFolderRelativePath;
                }
            }
            const toggleSelectionButton = document.getElementById('toggleSelectionButton') as HTMLButtonElement | null;
            if (toggleSelectionButton) {
                toggleSelectionButton.textContent = 'Show Selected';
            }
            const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
            if (searchInput && searchInput.value) {
                const table = viewConfigs[currentView].table;
                if (table) {
                    performSearch(searchInput.value.trim(), table);
                }
            }
            break;
        case 'restoreScroll':
            const scrollContainer = document.getElementById('scroll-container') as HTMLElement;
            scrollContainer.scrollTo(0, message.scrollTop);
            break;
    }
});
