/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { getErrorMessage } from "./utils.ts";
import { writeImportMap } from "./writeImportMap.ts";

/** Streams used by the command-line interface. */
export interface CommandIO {
    /** Stream receiving regular command output. */
    stdout: NodeJS.WritableStream;

    /** Stream receiving command diagnostics. */
    stderr: NodeJS.WritableStream;
}

const help = `Usage: importmap [OPTION]... <output.json|output.js>

Generate a browser import map for the current package and its installed runtime dependencies.

Options:
  --dev, -D      Include development dependencies and prefer development exports
  --help, -h     Display this help and exit
  --version, -V  Output version information and exit
`;

/**
 * Runs the importmap command.
 *
 * @param args - Command-line arguments without the executable and script path.
 * @param cwd  - Project directory from which the command is run.
 * @param io   - Output streams used for command output and diagnostics.
 * @returns Zero on success and one when argument parsing or import-map generation fails.
 */
export async function runCommand(args = process.argv.slice(2), cwd = process.cwd(), io: CommandIO = process): Promise<number> {
    try {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: {
                dev: { type: "boolean", short: "D" },
                help: { type: "boolean", short: "h" },
                version: { type: "boolean", short: "V" }
            }
        });
        if (values.help) {
            io.stdout.write(help);
            return 0;
        }
        if (values.version) {
            const packageJSON = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf-8")) as { version: string };
            io.stdout.write(`${packageJSON.version}\n`);
            return 0;
        }
        if (positionals.length !== 1) {
            throw new Error(positionals.length === 0 ? "Missing output file" : "Too many output files");
        }
        await writeImportMap(positionals[0], { projectDirectory: cwd, dev: values.dev });
        return 0;
    } catch (error) {
        io.stderr.write(`importmap: ${getErrorMessage(error)}\n`);
        return 1;
    }
}
