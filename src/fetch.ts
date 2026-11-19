// One GET request, read as text. No St, Clutter or Gtk here, so the module in
// the shell and the settings window can both load it.
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import type Gio from 'gi://Gio';

/**
 * Asks `url` and gives the body of a plain 200 answer of at most `maxBytes`,
 * null for everything else: no network, another status, a redirect (not
 * followed), too large, cancelled. Never rejects.
 */
export function fetchText(
  http: Soup.Session,
  url: string,
  maxBytes: number,
  cancellable: Gio.Cancellable,
): Promise<string | null> {
  return new Promise(resolve => {
    let message: Soup.Message | null = null;
    try {
      message = Soup.Message.new('GET', url);
    } catch {
      // Not an address.
    }
    if (!message) {
      resolve(null);
      return;
    }
    const request = message;
    request.add_flags(Soup.MessageFlags.NO_REDIRECT);
    http.send_and_read_async(request, GLib.PRIORITY_DEFAULT, cancellable, (_source, result) => {
      try {
        const data = http.send_and_read_finish(result).get_data();
        const ok =
          request.get_status() === Soup.Status.OK && data !== null && data.length <= maxBytes;
        resolve(ok ? new TextDecoder().decode(data) : null);
      } catch {
        resolve(null);
      }
    });
  });
}
