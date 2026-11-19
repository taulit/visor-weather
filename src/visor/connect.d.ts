import type { ModuleOwner, VisorModule } from './index.js';

export interface VisorConnection {
  /** Unregisters the module (if Visor is still there) and stops watching Visor. */
  disconnect(): void;
}

/**
 * Registers `module` with Visor now or as soon as Visor is active, and again
 * whenever Visor comes back. `extension` is the Extension object of the module's
 * extension. Never throws when Visor is missing.
 */
export function connectVisor(extension: ModuleOwner, module: VisorModule): VisorConnection;
