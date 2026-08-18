/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { generateImportMap } from "../main/generateImportMap.ts";
import { createPackage, createTemporaryProject } from "./fixtures.ts";

describe("generateImportMap", () => {
    it("uses the current working directory by default", async () => {
        const importMap = await generateImportMap();

        assert.equal(importMap.imports["@kayahr/importmap"], "./lib/main/index.js");
    });

    it("maps the root package and transitive runtime dependencies", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, {
            name: "example",
            exports: {
                ".": "./lib/index.js",
                "./feature": "./lib/feature.js"
            },
            dependencies: {
                dependency: "1.0.0"
            },
            optionalDependencies: {
                missingOptional: "1.0.0"
            },
            devDependencies: {
                development: "1.0.0"
            }
        }, [ "lib/index.js", "lib/feature.js" ]);
        await createPackage(join(project, "node_modules/dependency"), {
            name: "dependency",
            exports: {
                ".": {
                    development: "./development.js",
                    browser: "./browser.js",
                    import: "./module.js",
                    default: "./default.js"
                },
                "./feature": "./feature.js",
                "./features/*": "./features/*"
            },
            dependencies: {
                transitive: "1.0.0"
            }
        }, [ "browser.js", "development.js", "module.js", "default.js", "feature.js", "features/one.js" ]);
        await createPackage(join(project, "node_modules/transitive"), {
            name: "transitive",
            module: "./esm.js",
            dependencies: {
                dataOnly: "1.0.0"
            }
        }, [ "esm.js" ]);
        await createPackage(join(project, "node_modules/dataOnly"), {
            name: "dataOnly"
        }, [ "data.json" ]);
        await createPackage(join(project, "node_modules/development"), {
            name: "development",
            exports: "./index.js"
        }, [ "index.js" ]);

        const importMap = await generateImportMap({ projectDirectory: project, baseDirectory: join(project, "lib") });

        assert.deepEqual(importMap, {
            imports: {
                dependency: "../node_modules/dependency/browser.js",
                "dependency/feature": "../node_modules/dependency/feature.js",
                "dependency/features/": "../node_modules/dependency/features/",
                "dataOnly/": "../node_modules/dataOnly/",
                example: "./index.js",
                "example/feature": "./feature.js",
                transitive: "../node_modules/transitive/esm.js",
                "transitive/": "../node_modules/transitive/"
            },
            scopes: {}
        });
    });

    it("includes development dependencies and prefers development exports", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, {
            name: "example",
            exports: "./index.js",
            dependencies: {
                dependency: "1.0.0"
            },
            devDependencies: {
                development: "1.0.0"
            }
        }, [ "index.js" ]);
        await createPackage(join(project, "node_modules/dependency"), {
            name: "dependency",
            exports: {
                development: "./development.js",
                browser: "./browser.js"
            }
        }, [ "browser.js", "development.js" ]);
        await createPackage(join(project, "node_modules/development"), {
            name: "development",
            exports: "./index.js"
        }, [ "index.js" ]);

        const importMap = await generateImportMap({ projectDirectory: project, dev: true });

        assert.equal(importMap.imports.dependency, "./node_modules/dependency/development.js");
        assert.equal(importMap.imports.development, "./node_modules/development/index.js");
    });

    it("creates scopes for nested dependency versions and package imports", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, {
            name: "example",
            exports: "./index.js",
            dependencies: {
                alpha: "1.0.0",
                beta: "1.0.0",
                shared: "1.0.0"
            }
        }, [ "index.js" ]);
        await createPackage(join(project, "node_modules/alpha"), {
            name: "alpha",
            exports: "./index.js",
            dependencies: {
                shared: "1.0.0"
            }
        }, [ "index.js" ]);
        await createPackage(join(project, "node_modules/beta"), {
            name: "beta",
            exports: "./index.js",
            imports: {
                "#internal": "./internal.js"
            },
            dependencies: {
                shared: "2.0.0"
            }
        }, [ "index.js", "internal.js" ]);
        await createPackage(join(project, "node_modules/shared"), {
            name: "shared",
            exports: "./v1.js"
        }, [ "v1.js" ]);
        await createPackage(join(project, "node_modules/beta/node_modules/shared"), {
            name: "shared",
            exports: "./v2.js"
        }, [ "v2.js" ]);

        const importMap = await generateImportMap({ projectDirectory: project });

        assert.equal(importMap.imports.shared, "./node_modules/shared/v1.js");
        assert.deepEqual(importMap.scopes["./node_modules/beta/"], {
            "#internal": "./node_modules/beta/internal.js",
            shared: "./node_modules/beta/node_modules/shared/v2.js"
        });
        assert.deepEqual(importMap.scopes["./node_modules/beta/node_modules/shared/"], {
            shared: "./node_modules/beta/node_modules/shared/v2.js"
        });
        assert.equal(importMap.scopes["./node_modules/alpha/"], undefined);
    });

    it("reports missing required dependencies", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, {
            name: "example",
            dependencies: {
                missing: "1.0.0"
            }
        });

        await assert.rejects(generateImportMap({ projectDirectory: project }), /Unable to find dependency 'missing'/);
    });

    it("handles peer dependencies, scoped packages and conditional export fallbacks", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, {
            name: "example",
            exports: {
                ".": [ 42, { node: "./node.js" }, "./index.js" ],
                "./disabled": null,
                "./external": "external-package",
                "./unmatched": [ 42, { node: "./node.js" } ]
            },
            dependencies: {
                "@scope/dependency": "1.0.0",
                duplicate: "1.0.0"
            },
            peerDependencies: {
                duplicate: "1.0.0",
                optionalPeer: "1.0.0",
                peer: "1.0.0"
            },
            peerDependenciesMeta: {
                optionalPeer: { optional: true }
            }
        }, [ "index.js" ]);
        await createPackage(join(project, "node_modules/@scope/dependency"), {
            name: "@scope/dependency",
            exports: "./index.js"
        }, [ "index.js" ]);
        await createPackage(join(project, "node_modules/duplicate"), {
            name: "duplicate",
            exports: "./index.js"
        }, [ "index.js" ]);
        await createPackage(join(project, "node_modules/peer"), {
            name: "peer",
            exports: "./index.js"
        }, [ "index.js" ]);

        const importMap = await generateImportMap({ projectDirectory: project });

        assert.equal(importMap.imports.example, "./index.js");
        assert.equal(importMap.imports["example/disabled"], undefined);
        assert.equal(importMap.imports["example/external"], undefined);
        assert.equal(importMap.imports["example/unmatched"], undefined);
        assert.equal(importMap.imports["@scope/dependency"], "./node_modules/@scope/dependency/index.js");
        assert.equal(importMap.imports.duplicate, "./node_modules/duplicate/index.js");
        assert.equal(importMap.imports.peer, "./node_modules/peer/index.js");
        assert.equal(importMap.imports.optionalPeer, undefined);
    });

    it("rejects invalid dependency package names", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, {
            name: "example",
            dependencies: {
                "../outside": "1.0.0"
            }
        });

        await assert.rejects(generateImportMap({ projectDirectory: project }), /Invalid package name '\.\.\/outside'/);
    });

    it("rejects package targets escaping their package", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, {
            name: "example",
            exports: "./../outside.js"
        });

        await assert.rejects(generateImportMap({ projectDirectory: project }), /Package target '.+' escapes/);
    });

    it("preserves declared legacy entries even when the target is not installed", async context => {
        const project = await createTemporaryProject(context);
        await createPackage(project, {
            name: "example",
            main: "",
            dependencies: {
                declared: "1.0.0"
            }
        });
        await createPackage(join(project, "node_modules/declared"), {
            name: "declared",
            main: "./missing.js"
        });

        const importMap = await generateImportMap({ projectDirectory: project });

        assert.equal(importMap.imports.example, undefined);
        assert.equal(importMap.imports["example/"], "./");
        assert.equal(importMap.imports.declared, "./node_modules/declared/missing.js");
    });
});
