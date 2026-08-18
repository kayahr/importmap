/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Reads and parses a JSON file while adding its path to parsing errors.
 *
 * @param path - JSON file to read.
 * @returns The parsed JSON value.
 */
export async function readJSON<T>(path: string): Promise<T> {
    let source: string;
    try {
        source = await readFile(path, "utf-8");
    } catch (error) {
        throw new Error(`Unable to read ${path}: ${getErrorMessage(error)}`, { cause: error });
    }
    try {
        return JSON.parse(source) as T;
    } catch (error) {
        throw new Error(`Unable to parse ${path}: ${getErrorMessage(error)}`, { cause: error });
    }
}

/**
 * Resolves a string or file URL to an absolute directory path.
 *
 * @param value - Directory path or file URL to resolve.
 * @param base  - Base directory used for relative string paths.
 * @returns The absolute directory path.
 */
export function toDirectoryPath(value: string | URL, base = process.cwd()): string {
    if (value instanceof URL) {
        if (value.protocol !== "file:") {
            throw new Error(`Expected a file URL but got '${value.href}'`);
        }
        return resolve(fileURLToPath(value));
    }
    return resolve(base, value);
}

/**
 * Converts a file path to an import-map address relative to a base directory.
 *
 * @param baseDirectory - Directory against which the target is made relative.
 * @param target        - Absolute target path.
 * @param directory     - Whether the target is a directory and therefore requires a trailing slash.
 * @returns A relative import-map address, or an absolute file URL when no relative path is possible.
 */
export function toImportMapAddress(baseDirectory: string, target: string, directory: boolean): string {
    let path = relative(baseDirectory, target);
    if (path === "") {
        path = ".";
    }
    // A relative path can only be absolute between different Windows drives, which cannot be exercised on POSIX.
    /* node:coverage ignore next 3 */
    if (isAbsolute(path)) {
        return pathToFileURL(directory ? `${target}${sep}` : target).href;
    }
    path = path.split(sep).map(encodePathSegment).join("/");
    if (!path.startsWith(".")) {
        path = `./${path}`;
    }
    if (directory && !path.endsWith("/")) {
        path += "/";
    }
    return path;
}

/**
 * Returns a useful message for any caught value.
 *
 * @param error - Caught value to describe.
 * @returns The error message or string representation of the value.
 */
export function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Encodes one filesystem path segment for use in an import-map URL.
 *
 * @param segment - Path segment to encode.
 * @returns The URL-safe path segment.
 */
function encodePathSegment(segment: string): string {
    return segment === "." || segment === ".." ? segment : encodeURIComponent(segment).replaceAll("%40", "@");
}
