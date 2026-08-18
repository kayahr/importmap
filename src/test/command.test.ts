/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";

import packageJSON from "../../package.json" with { type: "json" };
import { createPackage, createTemporaryProject } from "./fixtures.ts";

const execFileAsync = promisify(execFile);
const cli = new URL("../main/cli.js", import.meta.url);

describe("importmap command", () => {
    it("prints help and version information", async () => {
        const help = await execFileAsync(process.execPath, [ cli.pathname, "--help" ]);
        const version = await execFileAsync(process.execPath, [ cli.pathname, "--version" ]);

        assert.match(help.stdout, /^Usage: importmap/);
        assert.equal(help.stderr, "");
        assert.equal(version.stdout, `${packageJSON.version}\n`);
        assert.equal(version.stderr, "");
    });

    it("writes runtime dependencies by default and development dependencies with --dev", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, {
            name: "example",
            exports: "./index.js",
            dependencies: {
                runtime: "1.0.0"
            },
            devDependencies: {
                development: "1.0.0"
            }
        }, [ "index.js" ]);
        await createPackage(join(project, "node_modules/runtime"), { name: "runtime", exports: "./index.js" }, [ "index.js" ]);
        await createPackage(join(project, "node_modules/development"), { name: "development", exports: "./index.js" }, [ "index.js" ]);

        const runtimeResult = await execFileAsync(process.execPath, [ cli.pathname, "lib/runtime.json" ], { cwd: project });
        const devResult = await execFileAsync(process.execPath, [ cli.pathname, "--dev", "lib/dev.json" ], { cwd: project });
        const runtime = JSON.parse(await readFile(join(project, "lib/runtime.json"), "utf-8")) as { imports: Record<string, string> };
        const development = JSON.parse(await readFile(join(project, "lib/dev.json"), "utf-8")) as { imports: Record<string, string> };

        assert.equal(runtimeResult.stdout, "");
        assert.equal(runtimeResult.stderr, "");
        assert.equal(devResult.stdout, "");
        assert.equal(devResult.stderr, "");
        assert.equal(runtime.imports.runtime, "../node_modules/runtime/index.js");
        assert.equal(runtime.imports.development, undefined);
        assert.equal(development.imports.development, "../node_modules/development/index.js");
    });

    it("reports command-line errors", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, { name: "example" });

        await assert.rejects(execFileAsync(process.execPath, [ cli.pathname ], { cwd: project }), error => {
            assert.equal((error as { code?: number }).code, 1);
            assert.match((error as { stderr?: string }).stderr ?? "", /Missing output file/);
            return true;
        });
        await assert.rejects(execFileAsync(process.execPath, [ cli.pathname, "importmap.txt" ], { cwd: project }), error => {
            assert.equal((error as { code?: number }).code, 1);
            assert.match((error as { stderr?: string }).stderr ?? "", /must end with '.json' or '.js'/);
            return true;
        });
        await assert.rejects(execFileAsync(process.execPath, [ cli.pathname, "one.json", "two.json" ], { cwd: project }), error => {
            assert.equal((error as { code?: number }).code, 1);
            assert.match((error as { stderr?: string }).stderr ?? "", /Too many output files/);
            return true;
        });
    });
});
