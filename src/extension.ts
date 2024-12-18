// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

class MyTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (!element) {
            return Promise.resolve([
                new vscode.TreeItem('Моя HTML вкладка')
            ]);
        }
        return Promise.resolve([]);
    }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Extension "STM32 Build Analyzer" is now active!');

	const myTreeDataProvider = new MyTreeDataProvider();

	const view = vscode.window.createTreeView('buildAnalyzer', {
        treeDataProvider: myTreeDataProvider
    });
	console.log('view created');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('stm32-build-analyzer.openTab', () => {
		/*const panel = vscode.window.createWebviewPanel(
            'buildAnalyzer', // Идентификатор панели
            'Build Analyzer', // Заголовок вкладки
            vscode.ViewColumn.One, // Колонка, где будет отображаться вкладка
            {
                enableScripts: true, // Разрешаем выполнение скриптов
            }
        );

        // HTML-контент для отображения в webview
        panel.webview.html = getWebviewContent();*/
	});
	console.log('command registered');

	context.subscriptions.push(disposable);
}

function getWebviewContent() {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Моя вкладка</title>
    </head>
    <body>
        <h1>Привет, это моя вкладка!</h1>
        <p>Здесь можно отобразить любой контент.</p>
    </body>
    </html>
    `;
}

// This method is called when your extension is deactivated
export function deactivate() {}
