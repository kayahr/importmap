# Importmap

[GitHub] | [NPM] | [API doc]

A small tool which generates browser import maps from the packages installed in `node_modules`.

## Features

* Maps the current package and all installed runtime dependencies, including transitive dependencies.
* Also maps the current package's installed development dependencies when `--dev` option is used.
* Adds import-map scopes when nested `node_modules` contain different package versions.
* Supports package `exports`, relative package `imports`, trailing-wildcard subpaths and the legacy `module`, `jsnext:main`, `browser` and `main` fields.
* Selects `browser`, `import` and `default` export conditions, plus `development` when `--dev` option is used.
* Writes either plain JSON or a browser script which injects the import map with correctly rebased URLs.
* Has no runtime dependencies.

## Usage

Install the tool as a development dependency:

```sh
npm install --save-dev @kayahr/importmap
```

Generate a JavaScript import map for the runtime dependencies of the package in the current directory:

```sh
npx @kayahr/importmap lib/importmap.js
```

The output format is selected from the filename. Use `.json` for plain JSON:

```sh
npx @kayahr/importmap lib/importmap.json
```

Add `--dev` (or `-D`) to include development dependencies:

```sh
npx @kayahr/importmap --dev lib/importmap.js
```

A typical `package.json` script looks like this:

```json
{
    "scripts": {
        "build:importmap": "importmap lib/importmap.js"
    }
}
```

JavaScript output can be loaded directly before the first module script. It injects an inline import map immediately after itself:

```html
<script src="lib/importmap.js"></script>
<script type="module" src="lib/main.js"></script>
```

Unfortunately, browsers currently support import maps only as inline JSON inside `<script type="importmap">`; they cannot load an external JSON import map through `src`. This is exactly why the JavaScript output uses an injection wrapper: The wrapper can be loaded as a classic external script, rebases the mappings to its own URL and injects the embedded JSON as an inline import map. Plain JSON output contains the same mappings without this wrapper and is primarily intended for tooling or manual inline embedding. All addresses are relative to the generated file.

## API

The same functionality is available as an ESM API:

```ts
import { writeImportMap } from "@kayahr/importmap";

await writeImportMap("lib/importmap.json", {
    projectDirectory: ".",
    dev: false
});
```

[GitHub]: https://github.com/kayahr/importmap
[NPM]: https://www.npmjs.com/package/@kayahr/importmap
[API Doc]: https://kayahr.github.io/importmap/
