/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateImportMap } from "./generateImportMap.ts";
import type { ImportMap } from "./ImportMap.ts";
import { toDirectoryPath } from "./utils.ts";

/** Options for writing an import map. */
export interface WriteImportMapOptions {
    /** Directory containing the package.json. Defaults to the current working directory. */
    projectDirectory?: string | URL;

    /** Include the root package's development dependencies and prefer development exports. */
    dev?: boolean;
}

/**
 * Generates an import map and writes it as JSON or an executable browser script.
 *
 * @param outputFile - Destination ending in `.json` or `.js`. Relative paths are resolved against the project directory.
 * @param options    - Options controlling the project, dependencies and export conditions.
 */
export async function writeImportMap(outputFile: string | URL, options: WriteImportMapOptions = {}): Promise<void> {
    const projectDirectory = toDirectoryPath(options.projectDirectory ?? process.cwd());
    const outputPath = outputFile instanceof URL ? fileURLToPath(outputFile) : resolve(projectDirectory, outputFile);
    const extension = extname(outputPath);
    if (extension !== ".json" && extension !== ".js") {
        throw new Error(`Output file must end with '.json' or '.js': ${outputPath}`);
    }
    const importMap = await generateImportMap({
        projectDirectory,
        baseDirectory: dirname(outputPath),
        dev: options.dev
    });
    const output = extension === ".json" ? `${JSON.stringify(importMap, null, 4)}\n` : createImportMapScript(importMap);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output);
}

/**
 * Creates a classic browser script which rebases and injects an inline import map.
 *
 * @param importMap - Import map to embed.
 * @returns The executable JavaScript source.
 */
function createImportMapScript(importMap: ImportMap): string {
    const json = JSON.stringify(importMap, null, 4).replaceAll("\n", "\n    ");
    return `(() => {
    const currentScript = document.currentScript;
    if (currentScript == null) {
        throw new Error("document.currentScript is not available, cannot inject import map");
    }
    const baseUrl = new URL(".", currentScript.src);
    const importMap = ${json};
    const resolveMappings = mappings => Object.fromEntries(Object.entries(mappings).map(
        ([ specifier, address ]) => [ specifier, new URL(address, baseUrl).href ]
    ));
    const resolvedImportMap = {
        imports: resolveMappings(importMap.imports),
        scopes: Object.fromEntries(Object.entries(importMap.scopes).map(
            ([ scope, mappings ]) => [ new URL(scope, baseUrl).href, resolveMappings(mappings) ]
        ))
    };
    const script = document.createElement("script");
    script.type = "importmap";
    script.textContent = JSON.stringify(resolvedImportMap, null, 4);
    currentScript.after(script);
})();
`;
}
