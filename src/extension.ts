import * as vscode from "vscode";

const IGNORED_NAMES = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        "contextMerger.mergeSelection",
        async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            const targets = uris?.length ? uris : uri ? [uri] : [];

            if (!targets.length) {
                vscode.window.showWarningMessage("No files or folders selected.");
                return;
            }

            const fileMap = new Map<string, vscode.Uri>();

            for (const target of targets) {
                const collected = await collectFiles(target);
                for (const file of collected) {
                    const key = file.fsPath.toLowerCase();
                    fileMap.set(key, file);
                }
            }

            const files = Array.from(fileMap.values());

            if (!files.length) {
                vscode.window.showWarningMessage("No valid files found.");
                return;
            }

            let output = "";

            for (const file of files) {
                const content = await vscode.workspace.fs.readFile(file);
                const text = Buffer.from(content).toString("utf8");

                const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);

                let relativePath: string;

                if (workspaceFolder) {
                    const workspaceName = workspaceFolder.name;
                    const workspaceRelativePath = vscode.workspace.asRelativePath(file, false);
                    relativePath = `${workspaceName}/${workspaceRelativePath}`;
                } else {
                    relativePath = file.fsPath;
                }

                output += `## ${relativePath}\n\n`;
                output += "```text\n";
                output += text.trimEnd();
                output += "\n```\n\n";
            }

            const totalFiles = files.length;
            const totalCharacters = output.length;
            const estimatedTokens = Math.ceil(totalCharacters / 4);

            const document = await vscode.workspace.openTextDocument({
                content: output.trimEnd(),
                language: "markdown"
            });

            await vscode.window.showTextDocument(document, {
                preview: false
            });

            vscode.window.showInformationMessage(
                `Context Merger complete\n` +
                    `Total files: ${totalFiles}\n` +
                    `Total characters: ${totalCharacters.toLocaleString()}\n` +
                    `Estimated tokens (1/4th): ~${estimatedTokens.toLocaleString()}`,
                {modal: true}
            );
        }
    );

    context.subscriptions.push(disposable);
}

export function deactivate() {}

async function collectFiles(uri: vscode.Uri): Promise<vscode.Uri[]> {
    const stat = await vscode.workspace.fs.stat(uri);

    if (stat.type === vscode.FileType.File) {
        return [uri];
    }

    const entries = await vscode.workspace.fs.readDirectory(uri);
    const files: vscode.Uri[] = [];

    for (const [name, type] of entries) {
        if (IGNORED_NAMES.has(name)) continue;

        const child = vscode.Uri.joinPath(uri, name);

        if (type === vscode.FileType.File) {
            files.push(child);
        }

        if (type === vscode.FileType.Directory) {
            const nested = await collectFiles(child);
            files.push(...nested);
        }
    }

    return files;
}
