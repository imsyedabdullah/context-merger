import * as vscode from "vscode";
import * as path from "node:path";
import strip from "strip-comments";

import {COMMON_CODE_FILE_TYPES, DEFAULT_IGNORED_NAMES} from "./defaults";

// test
export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        "contextMerger.mergeSelection",
        async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            const targets = uris?.length ? uris : uri ? [uri] : [];
            const config = vscode.workspace.getConfiguration("contextMerger");
            const disableFileTypeFiltering = config.get<boolean>("disableFileTypeFiltering", false);
            const additionalFileTypes = config.get<string[]>("additionalFileTypes", []);
            const ignoredNames = normalizeIgnoredNames(
                config.get<string[]>("ignoredFilesFolders", DEFAULT_IGNORED_NAMES)
            );
            const allowedExtensions = disableFileTypeFiltering ? null : buildAllowedExtensions(additionalFileTypes);
            const skipExtraBlankLines = config.get<boolean>("skipExtraBlankLines", true);
            const removeComments = config.get<boolean>("removeComments", false);

            if (!targets.length) {
                vscode.window.showWarningMessage("No files or folders selected.");
                return;
            }

            const fileMap = new Map<string, vscode.Uri>();

            for (const target of targets) {
                const collected = await collectFiles(target, allowedExtensions, ignoredNames);
                for (const file of collected) {
                    const key = file.fsPath.toLowerCase();
                    fileMap.set(key, file);
                }
            }

            const files = Array.from(fileMap.values()).sort((a, b) => a.fsPath.localeCompare(b.fsPath));

            if (!files.length) {
                vscode.window.showWarningMessage("No valid files found.");
                return;
            }

			const chunks: string[] = [];
            for (const file of files) {
                const content = await vscode.workspace.fs.readFile(file);
                const text = Buffer.from(content).toString("utf8");
                const processedText = processFileContent(text, {
                    removeComments,
                    skipExtraBlankLines
                });

                const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);

                let relativePath: string;

                if (workspaceFolder) {
                    const workspaceName = workspaceFolder.name;
                    const workspaceRelativePath = vscode.workspace.asRelativePath(file, false);
                    relativePath = `${workspaceName}/${workspaceRelativePath}`;
                } else {
                    relativePath = file.fsPath;
                }

                chunks.push(`## ${relativePath}\n\n`);
                chunks.push("```text\n");
                chunks.push(processedText.trimEnd());
                chunks.push("\n```\n\n");
            }

            const output = chunks.join("");
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

async function collectFiles(
    uri: vscode.Uri,
    allowedExtensions: Set<string> | null,
    ignoredNames: Set<string>
): Promise<vscode.Uri[]> {
    const stat = await vscode.workspace.fs.stat(uri);

    if (stat.type === vscode.FileType.File) {
        return isAllowedFileType(uri, allowedExtensions) ? [uri] : [];
    }

    const entries = await vscode.workspace.fs.readDirectory(uri);
    const files: vscode.Uri[] = [];

    for (const [name, type] of entries) {
        if (ignoredNames.has(name.toLowerCase())) {
            continue;
        }

        const child = vscode.Uri.joinPath(uri, name);

        if (type === vscode.FileType.File) {
            if (isAllowedFileType(child, allowedExtensions)) {
                files.push(child);
            }
        }

        if (type === vscode.FileType.Directory) {
            const nested = await collectFiles(child, allowedExtensions, ignoredNames);
            files.push(...nested);
        }
    }

    return files;
}

function normalizeAllowedFileTypes(fileTypes: string[]): Set<string> {
    const normalized = new Set<string>();

    for (const fileType of fileTypes) {
        const trimmed = fileType.trim().toLowerCase();
        if (!trimmed) {
            continue;
        }

        normalized.add(trimmed.startsWith(".") ? trimmed : `.${trimmed}`);
    }

    return normalized;
}

function normalizeIgnoredNames(names: string[]): Set<string> {
    const normalized = new Set<string>();

    for (const name of names) {
        const trimmed = name.trim().toLowerCase();
        if (!trimmed) {
            continue;
        }

        normalized.add(trimmed);
    }

    return normalized;
}

function buildAllowedExtensions(additionalFileTypes: string[]): Set<string> {
    const presetExtensions = normalizeAllowedFileTypes(COMMON_CODE_FILE_TYPES);
    const customExtensions = normalizeAllowedFileTypes(additionalFileTypes);

    return new Set([...presetExtensions, ...customExtensions]);
}

function getFileExtension(uri: vscode.Uri): string {
    return path.extname(uri.fsPath).toLowerCase();
}

function isAllowedFileType(uri: vscode.Uri, allowedExtensions: Set<string> | null): boolean {
    if (!allowedExtensions) {
        return true;
    }

    const extension = getFileExtension(uri);
    return allowedExtensions.has(extension);
}

function processFileContent(text: string, options: {removeComments: boolean; skipExtraBlankLines: boolean}): string {
    let result = text;

    if (options.removeComments) {
        result = strip(result);
    }

    if (options.skipExtraBlankLines) {
        result = removeBlankLines(result);
    }

    return result;
}

function removeBlankLines(text: string): string {
    return text.replace(/\n\s*\n+/g, "\n");
}
