/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

/** A browser import map. */
export interface ImportMap {
    /** Top-level module specifier mappings. */
    imports: Record<string, string>;

    /** Module specifier mappings which only apply below a specific URL. */
    scopes: Record<string, Record<string, string>>;
}

/** Options for generating an import map. */
export interface GenerateImportMapOptions {
    /** Directory containing the package.json. Defaults to the current working directory. */
    projectDirectory?: string | URL;

    /** Directory against which generated URLs are made relative. Defaults to the project directory. */
    baseDirectory?: string | URL;

    /** Include the root package's development dependencies and prefer development exports. */
    dev?: boolean;
}
