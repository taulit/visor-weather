# src/visor

`connect.js`, `connect.d.ts` and `index.d.ts` are copies of the files of the npm package
[`@taulit/visor-module`](https://www.npmjs.com/package/@taulit/visor-module) (source: the `sdk/` directory of
[taulit/visor](https://github.com/taulit/visor)). A GNOME extension has no `node_modules` at run time and no bundler,
so the helper is copied into the module. Do not edit these files; update them with `pnpm run sync:sdk`.

- `connect.js`: `connectVisor(extension, module)` registers your module with Visor now or when Visor starts, and again when Visor comes back.
- `index.d.ts`: the types of the module API (`VisorModule`, `ModuleContext`, …).
