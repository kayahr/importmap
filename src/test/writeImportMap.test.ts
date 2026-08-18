/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

import { writeImportMap } from "../main/writeImportMap.ts";
import { createPackage, createTemporaryProject } from "./fixtures.ts";

/** Minimal script element representation used by the generated-script test. */
interface ScriptElement {
    /** Created HTML tag name. */
    tagName: string;

    /** Text assigned to the script element. */
    textContent?: string;

    /** Script type assigned to the element. */
    type?: string;
}

describe("writeImportMap", () => {
    it("accepts an output file URL and defaults to the current project", async context => {
        const directory = await createTemporaryProject(context);
        const outputFile = join(directory, "importmap.json");

        await writeImportMap(pathToFileURL(outputFile));

        const output = JSON.parse(await readFile(outputFile, "utf-8")) as { imports: Record<string, string> };
        assert.match(output.imports["@kayahr/importmap"], /^\.\.\//);
    });

    it("writes JSON and creates the output directory", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, {
            name: "example",
            exports: "./lib/index.js"
        }, [ "lib/index.js" ]);

        await writeImportMap("build/maps/importmap.json", { projectDirectory: project });

        const output = await readFile(join(project, "build/maps/importmap.json"), "utf-8");
        assert.ok(output.endsWith("\n"));
        assert.deepEqual(JSON.parse(output), {
            imports: {
                example: "../../lib/index.js"
            },
            scopes: {}
        });
    });

    it("writes a browser script which rebases and injects the import map", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, {
            name: "example",
            exports: "./lib/index.js"
        }, [ "lib/index.js" ]);
        await writeImportMap("build/maps/importmap.js", { projectDirectory: project });

        const output = await readFile(join(project, "build/maps/importmap.js"), "utf-8");
        let injected: ScriptElement | undefined;
        const currentScript = {
            src: "https://example.test/build/maps/importmap.js",
            after: (script: ScriptElement) => { injected = script; }
        };
        const document = {
            currentScript,
            createElement: (tagName: string): ScriptElement => ({ tagName })
        };
        vm.runInNewContext(output, { document, URL });

        assert.equal(injected?.tagName, "script");
        assert.equal(injected?.type, "importmap");
        assert.deepEqual(JSON.parse(injected?.textContent ?? ""), {
            imports: {
                example: "https://example.test/lib/index.js"
            },
            scopes: {}
        });
    });

    it("rejects unsupported output formats", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, { name: "example" });

        await assert.rejects(writeImportMap("importmap.html", { projectDirectory: project }), /must end with '.json' or '.js'/);
    });
});
