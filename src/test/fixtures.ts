/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

/**
 * Creates a temporary test project which is automatically deleted after the test.
 *
 * @param context - Current test context used to register cleanup.
 * @returns The temporary project directory.
 */
export async function createTemporaryProject(context: TestContext): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "kayahr-importmap-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

/**
 * Creates a package and optional files in a test project.
 *
 * @param directory   - Directory in which the package is created.
 * @param packageJSON - Package manifest to write.
 * @param files       - Relative package files to create.
 */
export async function createPackage(directory: string, packageJSON: object, files: string[] = []): Promise<void> {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "package.json"), `${JSON.stringify(packageJSON, null, 4)}\n`);
    for (const file of files) {
        const path = join(directory, file);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, "export {};\n");
    }
}
