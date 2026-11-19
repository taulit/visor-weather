// connectVisor(): connects a module extension to Visor (https://github.com/taulit/visor).
// Plain GJS ESM without dependencies. COPY this file into your extension, next to
// connect.d.ts, and call it from enable(). The home of this file is @taulit/visor-module.
//
// It registers `module` as soon as Visor is active, registers it again when Visor
// comes back after it was disabled, and never throws when Visor is missing.
import { ExtensionState } from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const VISOR_UUID = 'visor@taulit.github.io';

/**
 * @param {import('./index.js').ModuleOwner} extension the Extension object of the module's extension (`this`)
 * @param {import('./index.js').VisorModule} module
 * @returns {{ disconnect(): void }}
 */
export function connectVisor(extension, module) {
  const manager = Main.extensionManager;
  const token = {};
  let tried = null; // The API object of the Visor run we already dealt with.
  let registered = false;

  // The API of Visor, or null while Visor is not active.
  const currentApi = () => {
    const visor = manager.lookup(VISOR_UUID);
    return visor?.state === ExtensionState.ACTIVE ? (visor.stateObj?.api ?? null) : null;
  };

  const sync = () => {
    const api = currentApi();
    if (api === tried) return;
    // A new Visor run: the old one has already disabled and forgotten the module.
    tried = api;
    registered = false;
    if (!api) return;
    try {
      api.register(module, extension);
      registered = true;
    } catch (e) {
      log(`${extension.uuid}: Visor refused the module '${module.id}': ${e?.message ?? e}`);
    }
  };

  manager.connectObject(
    'extension-state-changed',
    (_manager, changed) => {
      if (changed.uuid === VISOR_UUID) sync();
    },
    token,
  );
  sync();

  return {
    disconnect() {
      manager.disconnectObject(token);
      try {
        if (registered && currentApi() === tried) tried.unregister(module.id);
      } catch (e) {
        // disable() of the module's extension must not fail because Visor did.
        log(
          `${extension.uuid}: Visor could not remove the module '${module.id}': ${e?.message ?? e}`,
        );
      }
      registered = false;
      tried = null;
    },
  };
}
