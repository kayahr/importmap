/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as exports from "../main/index.ts";
import { writeImportMap } from "../main/writeImportMap.ts";

describe("index", () => {
    it("exports the public API and nothing more", () => {
        assert.deepEqual({ ...exports }, {
            writeImportMap
        });
    });
});
