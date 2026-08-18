/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { getErrorMessage, readJSON, toDirectoryPath, toImportMapAddress } from "../main/utils.ts";
import { createTemporaryProject } from "./fixtures.ts";

describe("readJSON", () => {
    it("reports read and parse errors with the file path", async context => {
        const directory = await createTemporaryProject(context);
        const missingFile = join(directory, "missing.json");
        const malformedFile = join(directory, "malformed.json");
        await writeFile(malformedFile, "{");

        await assert.rejects(readJSON(missingFile), new RegExp(`Unable to read ${missingFile}`));
        await assert.rejects(readJSON(malformedFile), new RegExp(`Unable to parse ${malformedFile}`));
    });
});

describe("toDirectoryPath", () => {
    it("resolves relative paths and file URLs", () => {
        assert.equal(toDirectoryPath("child", "/base"), "/base/child");
        assert.equal(toDirectoryPath(pathToFileURL("/base/child")), "/base/child");
    });

    it("rejects non-file URLs", () => {
        assert.throws(() => toDirectoryPath(new URL("https://example.test/project/")), /Expected a file URL/);
    });
});

describe("toImportMapAddress", () => {
    it("creates relative URL addresses for files and directories", () => {
        assert.equal(toImportMapAddress("/project", "/project", false), ".");
        assert.equal(toImportMapAddress("/project", "/project", true), "./");
        assert.equal(toImportMapAddress("/project", "/project/node_modules/@scope/a file", false), "./node_modules/@scope/a%20file");
        assert.equal(toImportMapAddress("/project/lib", "/project/index.js", false), "../index.js");
    });
});

describe("getErrorMessage", () => {
    it("returns messages from errors and arbitrary thrown values", () => {
        assert.equal(getErrorMessage(new Error("failure")), "failure");
        assert.equal(getErrorMessage("failure"), "failure");
    });
});
