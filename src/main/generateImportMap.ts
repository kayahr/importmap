/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { GenerateImportMapOptions, ImportMap } from "./ImportMap.ts";
import { readJSON, toDirectoryPath, toImportMapAddress } from "./utils.ts";

/** Package manifest fields used while building the dependency graph and mappings. */
interface PackageJSON {
    /** Package name used as the root module specifier. */
    name?: string;

    /** Public package entry points and their conditional targets. */
    exports?: unknown;

    /** Private package import mappings. */
    imports?: unknown;

    /** Legacy browser entry point. */
    browser?: unknown;

    /** Legacy module entry point. */
    module?: unknown;

    /** Legacy jsnext module entry point. */
    "jsnext:main"?: unknown;

    /** Legacy default package entry point. */
    main?: unknown;

    /** Required runtime dependencies. */
    dependencies?: Record<string, string>;

    /** Runtime dependencies which may be missing. */
    optionalDependencies?: Record<string, string>;

    /** Peer dependencies required by the package. */
    peerDependencies?: Record<string, string>;

    /** Additional peer dependency metadata. */
    peerDependenciesMeta?: Record<string, PeerDependencyMeta>;

    /** Development dependencies of the root package. */
    devDependencies?: Record<string, string>;
}

/** Metadata controlling how a peer dependency is resolved. */
interface PeerDependencyMeta {
    /** Whether the peer dependency may be missing. */
    optional?: boolean;
}

/** Installed package participating in the dependency graph. */
interface PackageNode {
    /** Absolute package directory. */
    directory: string;

    /** Parsed package manifest. */
    json: PackageJSON;

    /** Whether this node represents the project package. */
    root: boolean;
}

/** Dependency declaration collected from a package manifest. */
interface Dependency {
    /** Dependency package name. */
    name: string;

    /** Whether the installed package may be missing. */
    optional: boolean;
}

/** Resolved dependency relationship between two installed packages. */
interface DependencyEdge {
    /** Package declaring the dependency. */
    importer: PackageNode;

    /** Installed package satisfying the dependency. */
    dependency: PackageNode;

    /** Dependency name used by the importing package. */
    name: string;
}

/** Absolute target of an import-map module specifier. */
interface MappingTarget {
    /** Absolute filesystem path of the target. */
    path: string;

    /** Whether the target is a directory prefix. */
    directory: boolean;
}

/** Mapping targets indexed by module specifier. */
type Mappings = Map<string, MappingTarget>;

/**
 * Generates an import map for the installed dependencies of a Node.js package.
 *
 * @param options - Options controlling the project, URL base, dependency set and export conditions.
 * @returns The generated import map.
 */
export async function generateImportMap(options: GenerateImportMapOptions = {}): Promise<ImportMap> {
    const projectDirectory = toDirectoryPath(options.projectDirectory ?? process.cwd());
    const baseDirectory = toDirectoryPath(options.baseDirectory ?? projectDirectory, projectDirectory);
    const packageFile = join(projectDirectory, "package.json");
    const root: PackageNode = {
        directory: projectDirectory,
        json: await readJSON<PackageJSON>(packageFile),
        root: true
    };
    const graph = await createPackageGraph(root, options.dev ?? false);
    const conditions = new Set([ ...(options.dev ? [ "development" ] : []), "browser", "import", "default" ]);
    const mappingsCache = new Map<string, Promise<Mappings>>();

    /**
     * Returns and caches the public mappings for a package under a specific package name.
     *
     * @param pkg  - Package to map.
     * @param name - Module specifier name under which the package is mapped.
     * @returns Public mappings for the package.
     */
    const getPublicMappings = (pkg: PackageNode, name: string): Promise<Mappings> => {
        const cacheKey = `${pkg.directory}\0${name}`;
        let mappings = mappingsCache.get(cacheKey);
        if (mappings == null) {
            mappings = createPublicMappings(pkg, name, conditions);
            mappingsCache.set(cacheKey, mappings);
        }
        return mappings;
    };

    const imports: Mappings = new Map();
    if (root.json.name != null) {
        addMappings(imports, await getPublicMappings(root, root.json.name));
    }
    addMappings(imports, createPrivateMappings(root, conditions));

    const rootEdges = graph.edges.filter(edge => edge.importer === root).sort(compareEdges);
    for (const edge of rootEdges) {
        addMappings(imports, await getPublicMappings(edge.dependency, edge.name));
    }

    const sortedPackages = graph.packages.filter(pkg => !pkg.root).sort(comparePackages);
    for (const pkg of sortedPackages) {
        const names = new Set<string>();
        if (pkg.json.name != null) {
            names.add(pkg.json.name);
        }
        for (const edge of graph.edges) {
            if (edge.dependency === pkg) {
                names.add(edge.name);
            }
        }
        for (const name of [ ...names ].sort()) {
            addMappings(imports, await getPublicMappings(pkg, name));
        }
    }

    const scopedMappings = new Map<string, Mappings>();
    for (const pkg of sortedPackages) {
        const mappings = getOrCreate(scopedMappings, pkg.directory);
        if (pkg.json.name != null) {
            addMappings(mappings, await getPublicMappings(pkg, pkg.json.name));
        }
        addMappings(mappings, createPrivateMappings(pkg, conditions));
    }
    for (const edge of graph.edges.filter(edge => !edge.importer.root).sort(compareEdges)) {
        addMappings(getOrCreate(scopedMappings, edge.importer.directory), await getPublicMappings(edge.dependency, edge.name));
    }

    return createImportMap(imports, scopedMappings, baseDirectory);
}

/**
 * Traverses the installed dependency tree and records packages and dependency edges.
 *
 * @param root - Root package of the project.
 * @param dev  - Whether root development dependencies are included.
 * @returns All reachable packages and the dependency edges between them.
 */
async function createPackageGraph(root: PackageNode, dev: boolean): Promise<{ packages: PackageNode[], edges: DependencyEdge[] }> {
    const packages: PackageNode[] = [];
    const edges: DependencyEdge[] = [];
    const packagesByDirectory = new Map<string, PackageNode>([ [ root.directory, root ] ]);
    const visited = new Set<string>();

    /**
     * Traverses a package and all of its installed dependencies.
     *
     * @param pkg - Package to traverse.
     */
    const visit = async (pkg: PackageNode): Promise<void> => {
        if (visited.has(pkg.directory)) {
            return;
        }
        visited.add(pkg.directory);
        packages.push(pkg);

        for (const dependency of getDependencies(pkg.json, pkg.root && dev)) {
            const directory = await findDependency(pkg.directory, root.directory, dependency.name);
            if (directory == null) {
                if (dependency.optional) {
                    continue;
                }
                throw new Error(`Unable to find dependency '${dependency.name}' required by ${join(pkg.directory, "package.json")}`);
            }
            let dependencyPackage = packagesByDirectory.get(directory);
            if (dependencyPackage == null) {
                dependencyPackage = {
                    directory,
                    json: await readJSON<PackageJSON>(join(directory, "package.json")),
                    root: false
                };
                packagesByDirectory.set(directory, dependencyPackage);
            }
            edges.push({ importer: pkg, dependency: dependencyPackage, name: dependency.name });
            await visit(dependencyPackage);
        }
    };

    await visit(root);
    return { packages, edges };
}

/**
 * Collects runtime dependencies from a package manifest.
 *
 * @param json - Package manifest to inspect.
 * @param dev  - Whether development dependencies are included.
 * @returns The dependency names and whether they are optional.
 */
function getDependencies(json: PackageJSON, dev: boolean): Dependency[] {
    const dependencies = new Map<string, Dependency>();

    /**
     * Adds dependency declarations to the result.
     *
     * @param values      - Dependency declarations to add.
     * @param optional    - Whether missing packages are allowed.
     * @param onlyMissing - Whether existing declarations are preserved.
     */
    const add = (values: Record<string, string> | undefined, optional: boolean, onlyMissing = false): void => {
        for (const name of Object.keys(values ?? {}).sort()) {
            if (!onlyMissing || !dependencies.has(name)) {
                dependencies.set(name, { name, optional });
            }
        }
    };

    add(json.dependencies, false);
    add(json.optionalDependencies, true);
    for (const name of Object.keys(json.peerDependencies ?? {}).sort()) {
        if (!dependencies.has(name)) {
            dependencies.set(name, { name, optional: json.peerDependenciesMeta?.[name]?.optional ?? false });
        }
    }
    if (dev) {
        add(json.devDependencies, false, true);
    }
    return [ ...dependencies.values() ];
}

/**
 * Resolves a dependency using Node.js-style upward `node_modules` lookup within the project.
 *
 * @param packageDirectory - Directory of the importing package.
 * @param projectDirectory - Root directory which limits the lookup.
 * @param name             - Package name to resolve.
 * @returns The installed package directory, or `null` when it is not installed.
 */
async function findDependency(packageDirectory: string, projectDirectory: string, name: string): Promise<string | null> {
    validatePackageName(name);
    let currentDirectory = packageDirectory;
    while (isInside(projectDirectory, currentDirectory)) {
        const candidate = join(currentDirectory, "node_modules", name);
        if (await isFile(join(candidate, "package.json"))) {
            return candidate;
        }
        if (currentDirectory === projectDirectory) {
            break;
        }
        currentDirectory = resolve(currentDirectory, "..");
    }
    return null;
}

/**
 * Validates a package name before it is used to construct filesystem paths.
 *
 * @param name - Package name to validate.
 */
function validatePackageName(name: string): void {
    if (!/^(?:@(?!\.{1,2}\/)[^/\\]+\/)?(?!\.{1,2}$)[^/\\]+$/.test(name)) {
        throw new Error(`Invalid package name '${name}' in package.json`);
    }
}

/**
 * Tests whether a path is equal to or lexically contained in a parent path.
 *
 * @param parent - Potential parent path.
 * @param child  - Potential child path.
 * @returns `true` when the child does not escape the parent.
 */
function isInside(parent: string, child: string): boolean {
    const path = relative(parent, child);
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

/**
 * Creates public import mappings for a package.
 *
 * @param pkg        - Package to map.
 * @param name       - Module specifier name under which the package is mapped.
 * @param conditions - Enabled package-export conditions.
 * @returns Public mappings for the package.
 */
async function createPublicMappings(pkg: PackageNode, name: string, conditions: Set<string>): Promise<Mappings> {
    if (Object.hasOwn(pkg.json, "exports")) {
        return createExportsMappings(pkg, name, conditions);
    }

    const mappings: Mappings = new Map();
    mappings.set(`${name}/`, { path: pkg.directory, directory: true });
    const entry = await findLegacyEntry(pkg);
    if (entry != null) {
        mappings.set(name, { path: entry, directory: false });
    }
    return mappings;
}

/**
 * Converts a package's `exports` declaration into import-map mappings.
 *
 * @param pkg        - Package containing the declaration.
 * @param name       - Module specifier name under which the package is mapped.
 * @param conditions - Enabled package-export conditions.
 * @returns Mappings created from the package exports.
 */
function createExportsMappings(pkg: PackageNode, name: string, conditions: Set<string>): Mappings {
    const mappings: Mappings = new Map();
    const packageExports = pkg.json.exports;
    if (isRecord(packageExports) && Object.keys(packageExports).some(key => key.startsWith("."))) {
        const keys = Object.keys(packageExports);
        if (keys.some(key => !key.startsWith("."))) {
            throw new Error(`Invalid mixed exports in ${join(pkg.directory, "package.json")}`);
        }
        for (const key of keys.sort()) {
            addPackageTarget(mappings, name, key, resolveConditionalTarget(packageExports[key], conditions), pkg.directory);
        }
    } else {
        addPackageTarget(mappings, name, ".", resolveConditionalTarget(packageExports, conditions), pkg.directory);
    }
    return mappings;
}

/**
 * Converts relative entries from a package's `imports` declaration into private mappings.
 *
 * @param pkg        - Package containing the declaration.
 * @param conditions - Enabled package-import conditions.
 * @returns Private mappings for the package scope.
 */
function createPrivateMappings(pkg: PackageNode, conditions: Set<string>): Mappings {
    const mappings: Mappings = new Map();
    if (!isRecord(pkg.json.imports)) {
        return mappings;
    }
    for (const key of Object.keys(pkg.json.imports).filter(key => key.startsWith("#")).sort()) {
        addTarget(mappings, key, resolveConditionalTarget(pkg.json.imports[key], conditions), pkg.directory);
    }
    return mappings;
}

/**
 * Resolves a string, array or conditional package target.
 *
 * @param value      - Package target value to resolve.
 * @param conditions - Enabled package conditions.
 * @returns The selected target, `null` for an explicitly disabled target, or `undefined` when no target matches.
 */
function resolveConditionalTarget(value: unknown, conditions: Set<string>): string | null | undefined {
    if (typeof value === "string" || value === null) {
        return value;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const target = resolveConditionalTarget(item, conditions);
            if (target !== undefined) {
                return target;
            }
        }
        return undefined;
    }
    if (isRecord(value)) {
        for (const [ condition, targetValue ] of Object.entries(value)) {
            if (condition === "default" || conditions.has(condition)) {
                const target = resolveConditionalTarget(targetValue, conditions);
                if (target !== undefined) {
                    return target;
                }
            }
        }
    }
    return undefined;
}

/**
 * Normalizes a package-export key and adds its target to a mapping collection.
 *
 * @param mappings         - Mapping collection to update.
 * @param name             - Package name which prefixes the export key.
 * @param key              - Package-export key.
 * @param target           - Resolved package target.
 * @param packageDirectory - Directory containing the package.
 */
function addPackageTarget(mappings: Mappings, name: string, key: string, target: string | null | undefined, packageDirectory: string): void {
    let specifier: string | null = null;
    if (key === ".") {
        specifier = name;
    } else if (key.startsWith("./")) {
        specifier = `${name}/${key.slice(2)}`;
    }
    if (specifier != null) {
        addTarget(mappings, specifier, target, packageDirectory);
    }
}

/**
 * Adds a resolved package target to a mapping collection when browser import maps can represent it.
 *
 * @param mappings         - Mapping collection to update.
 * @param specifier        - Module specifier to map.
 * @param target           - Relative package target.
 * @param packageDirectory - Directory containing the package.
 */
function addTarget(mappings: Mappings, specifier: string, target: string | null | undefined, packageDirectory: string): void {
    if (target == null || !target.startsWith("./")) {
        return;
    }
    const specifierStars = count(specifier, "*");
    const targetStars = count(target, "*");
    if (specifierStars !== 0 || targetStars !== 0) {
        if (specifierStars !== 1 || targetStars !== 1 || !specifier.endsWith("*") || !target.endsWith("*")) {
            return;
        }
        mappings.set(specifier.slice(0, -1), {
            path: resolvePackageTarget(packageDirectory, target.slice(0, -1)),
            directory: true
        });
        return;
    }
    mappings.set(specifier, { path: resolvePackageTarget(packageDirectory, target), directory: target.endsWith("/") });
}

/**
 * Resolves a relative package target while preventing it from escaping the package directory.
 *
 * @param packageDirectory - Directory containing the package.
 * @param target           - Relative package target.
 * @returns The absolute target path.
 */
function resolvePackageTarget(packageDirectory: string, target: string): string {
    const path = resolve(packageDirectory, target);
    if (!isInside(packageDirectory, path)) {
        throw new Error(`Package target '${target}' escapes ${packageDirectory}`);
    }
    return path;
}

/**
 * Resolves a package entry from legacy package fields and conventional index filenames.
 *
 * @param pkg - Package whose entry point is resolved.
 * @returns The resolved entry path, or `null` when the package has no module entry.
 */
async function findLegacyEntry(pkg: PackageNode): Promise<string | null> {
    const entry = [ pkg.json.module, pkg.json["jsnext:main"], pkg.json.browser, pkg.json.main ]
        .find(value => typeof value === "string");
    if (entry === "") {
        return null;
    }
    const target = resolvePackageTarget(pkg.directory, entry ?? "./index");
    const candidates = [
        target,
        `${target}.js`,
        `${target}.mjs`,
        `${target}.cjs`,
        `${target}.json`,
        `${target}.node`,
        join(target, "index.js"),
        join(target, "index.mjs"),
        join(target, "index.cjs"),
        join(target, "index.json"),
        join(target, "index.node")
    ];
    for (const candidate of candidates) {
        if (await isFile(candidate)) {
            return candidate;
        }
    }
    return entry == null ? null : target;
}

/**
 * Tests whether a path points to a regular file.
 *
 * @param path - Path to test.
 * @returns `true` when the path points to a regular file.
 */
async function isFile(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch (error) {
        if (isErrorWithCode(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
            return false;
        }
        throw error;
    }
}

/**
 * Converts absolute mapping targets into a deterministic browser import map.
 *
 * @param imports        - Top-level mappings.
 * @param scopedMappings - Package-directory mappings which may override top-level mappings.
 * @param baseDirectory  - Directory against which addresses are made relative.
 * @returns The final browser import map.
 */
function createImportMap(imports: Mappings, scopedMappings: Map<string, Mappings>, baseDirectory: string): ImportMap {
    const importsResult = convertMappings(imports, baseDirectory);
    const scopesResult: Record<string, Record<string, string>> = {};
    for (const [ scopePath, mappings ] of [ ...scopedMappings.entries() ].sort(([ left ], [ right ]) => left.localeCompare(right))) {
        const filtered = new Map([ ...mappings ].filter(([ key, value ]) => !sameTarget(value, imports.get(key))));
        if (filtered.size !== 0) {
            scopesResult[toImportMapAddress(baseDirectory, scopePath, true)] = convertMappings(filtered, baseDirectory);
        }
    }
    return { imports: importsResult, scopes: scopesResult };
}

/**
 * Converts absolute mapping targets to sorted addresses relative to a base directory.
 *
 * @param mappings      - Absolute mappings to convert.
 * @param baseDirectory - Directory against which addresses are made relative.
 * @returns A sorted import-map mapping object.
 */
function convertMappings(mappings: Mappings, baseDirectory: string): Record<string, string> {
    return Object.fromEntries([ ...mappings.entries() ]
        .sort(([ left ], [ right ]) => left.localeCompare(right))
        .map(([ key, value ]) => [ key, toImportMapAddress(baseDirectory, value.path, value.directory) ]));
}

/**
 * Adds mappings without replacing entries already present in the target.
 *
 * @param target - Mapping collection to update.
 * @param source - Mappings to add.
 */
function addMappings(target: Mappings, source: Mappings): void {
    for (const [ key, value ] of source) {
        if (!target.has(key)) {
            target.set(key, value);
        }
    }
}

/**
 * Returns the mapping collection stored under a key, creating it when necessary.
 *
 * @param map - Map containing mapping collections.
 * @param key - Collection key.
 * @returns The existing or newly created mapping collection.
 */
function getOrCreate(map: Map<string, Mappings>, key: string): Mappings {
    let value = map.get(key);
    if (value == null) {
        value = new Map();
        map.set(key, value);
    }
    return value;
}

/**
 * Tests whether two mapping targets refer to the same path and target kind.
 *
 * @param left  - First mapping target.
 * @param right - Optional second mapping target.
 * @returns `true` when both targets are equivalent.
 */
function sameTarget(left: MappingTarget, right: MappingTarget | undefined): boolean {
    return right != null && left.path === right.path && left.directory === right.directory;
}

/**
 * Compares packages by directory depth and path for deterministic ordering.
 *
 * @param left  - First package.
 * @param right - Second package.
 * @returns A value suitable for `Array.sort`.
 */
function comparePackages(left: PackageNode, right: PackageNode): number {
    const depthDifference = left.directory.split(sep).length - right.directory.split(sep).length;
    return depthDifference === 0 ? left.directory.localeCompare(right.directory) : depthDifference;
}

/**
 * Compares dependency edges by importer path and dependency name for deterministic ordering.
 *
 * @param left  - First dependency edge.
 * @param right - Second dependency edge.
 * @returns A value suitable for `Array.sort`.
 */
function compareEdges(left: DependencyEdge, right: DependencyEdge): number {
    const importerDifference = left.importer.directory.localeCompare(right.importer.directory);
    return importerDifference === 0 ? left.name.localeCompare(right.name) : importerDifference;
}

/**
 * Counts non-overlapping occurrences of a substring.
 *
 * @param value  - String to inspect.
 * @param search - Substring to count.
 * @returns The number of occurrences.
 */
function count(value: string, search: string): number {
    return value.split(search).length - 1;
}

/**
 * Tests whether a value is a non-array object with string keys.
 *
 * @param value - Value to test.
 * @returns `true` when the value is a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Tests whether a caught value is an error with a Node.js error code.
 *
 * @param error - Caught value to test.
 * @returns `true` when the value exposes an error code.
 */
function isErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}
