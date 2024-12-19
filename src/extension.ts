// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import * as fs from 'fs';

interface Region {
    name: string,
    startAddress: string;
    size: number;
    sections: Section[];
}

interface Section {
    name: string;
    startAddress: string;
    size: number;
    loadAddress: string;
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
            enableScripts: true, // Разрешаем выполнение скриптов
            
        };

		const projectPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        const elfFilePath = this.findElfFile(projectPath);
        const mapFilePath = this.findMapFile(projectPath);

        // Устанавливаем HTML-контент для Webview
        webviewView.webview.html = this.getHtmlContent(webviewView.webview, elfFilePath);

        webviewView.webview.onDidReceiveMessage(
            message => {
                console.log('Received message:', message);
                switch (message.command) {
                    case 'runObjdump':
                        this.runObjdumpCommand(elfFilePath)
                            .then(output => {
                                // Отправляем результат обратно в Webview
                                console.log(`showOutput showOutput showOutput showOutput showOutput `);
                                webviewView.webview.postMessage({ command: 'showOutput', output: output });
                            })
                            .catch(error => {
                                console.log(`showError showError showError showError showError showError `);
                                webviewView.webview.postMessage({ command: 'showError', error: error });
                            });
                        return;
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
	
	private runObjdumpCommand(elfPath: string): Promise<string> {
		return new Promise((resolve, reject) => {
            console.log('Running objdump command...');
			child_process.exec(`arm-none-eabi-objdump -h ${elfPath}`, (error, stdout, stderr) => {
				if (error) {
                    console.error('Error executing objdump:', stderr);
					reject(`Ошибка: ${stderr}`);
				} else {
                    console.log('Command output:', stdout); 
					resolve(stdout);
				}
			});
		});
	}

    
    private parseMapFile(mapFilePath: string): Section[] {
        const content = fs.readFileSync(mapFilePath, 'utf8');
        const lines = content.split('\n');
        const sections: Section[] = [];

        const sectionRegex = /^\s*(\.\w+)\s+(0x[\da-fA-F]+)\s+(0x[\da-fA-F]+)(?:\s+load address\s+(0x[\da-fA-F]+))?\s+(.*)$/;

        for (const line of lines) {
            const match = sectionRegex.exec(line);
            if (match) {
                const [, name, startAddress, sizeHex, loadAddress, module] = match;
                if(startAddress === "0x00000000" || parseInt(sizeHex, 16) === 0) {
                    continue;
                }
                sections.push({
                    name,
                    startAddress,
                    size: parseInt(sizeHex, 16),
                    loadAddress,
                    module: module.trim(),
                });
            }
        }
        return sections;
    }

	private analyzeElfFile(elfPath: string): string {
		const output = ``;
		
		const sections = output.split('\n').filter(line => line.includes('.'));
		const formatted = sections.map(line => {
			const parts = line.trim().split(/\s+/);
			return `Секция: ${parts[1]}, Адрес: ${parts[3]}, Размер: ${parseInt(parts[2], 16)} байт`;
		});

		return formatted.join('\n');
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
        </style>
        </head>
        <body>
            <h1>Добро пожаловать в Build Analyzer!</h1>
            <p>Это пример сложного HTML в Webview.</p>
            <div class="build-results">
                <p>Путь до файла: ${elfFilePath ? elfFilePath : 'Файл .elf не найден'}</p>
            </div>
			
			<button id="runCommand">Run objdump</button>
			<pre id="output"></pre>

			<script>
                const vscode = acquireVsCodeApi();
				document.getElementById('runCommand').addEventListener('click', () => {
					// Отправляем сообщение в основной процесс
                    console.log('Button clicked, sending message to extension...');
					vscode.postMessage({ command: 'parseMapFile' });
				});

                window.addEventListener('DOMContentLoaded', () => {
                    console.log('Webview opened, sending message to extension...');
					vscode.postMessage({ command: 'parseMapFile' });
                });

				// Обработчик сообщений от основного процесса
				window.addEventListener('message', (event) => {
					const message = event.data;
					if (message.command === 'showOutput') {
						document.getElementById('output').textContent = message.output;
					} else if (message.command === 'showError') {
						document.getElementById('output').textContent = message.error;
					} else if (message.command === 'showMapData') {
                        document.getElementById('output').textContent = 'i75rytfgvliuohl';
                        const output = document.getElementById('output');
                            output.innerHTML = '<table class="gray"><thead><tr><th>Section</th><th>Address</th><th>Size</th><th>LoadAddress</th><th>Module</th></tr></thead><tbody>' +
                            message.data.map(section => \`<tr>
                                <td>\${section.name}</td>
                                <td>\${section.startAddress}</td>
                                <td>\${section.size}</td>
                                <td>\${section.loadAddress}</td>
                                <td>\${section.module}</td>
                             </tr>\`).join('') +
                             '</tbody></table>';
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

