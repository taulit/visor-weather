// Types of the Visor module API, version 1.
// Generated from src/api.ts of https://github.com/taulit/visor by scripts/gen-sdk.sh. Do not edit.
/**
 * Visor module API, version 1.
 *
 * Built-in modules and modules from other extensions use exactly this API.
 * A module takes one place: rows in "Now", a section in "Up Next", or an icon
 * in the dock with its own view.
 */
import type Gio from 'gi://Gio';
import type Soup from 'gi://Soup?version=3.0';
import type St from 'gi://St';
export declare const API_VERSION = 1;
export type Slot = 'now' | 'ahead' | 'dock';
export interface VisorModule {
  /** Unique, lower case letters, digits and dashes: 'notes'. */
  id: string;
  /** Translated name: title of the module's view, entry in the Modules view, accessible name of the dock icon. */
  name: string;
  /** Symbolic icon name. */
  icon: string;
  slot: Slot;
  /** Called when the module is registered and not turned off, and again when the user turns it back on. */
  enable(ctx: ModuleContext): void;
  /** Calls that change something through the context do nothing after this. Visor removes rows, chip, badge, section and view of the module itself. Must cope with an enable() that threw halfway. */
  disable(): void;
  /**
   * Slot 'ahead': called once per enable(): the first time the panel opens, or at once if it has been open before.
   * Visor owns the returned widget and destroys it when the module is disabled.
   * A hidden widget leaves a gap; the right column stays.
   */
  buildSection?(): St.Widget;
  /**
   * Slot 'dock': called once per enable(), on the first click on the dock icon.
   * The view is shown below a header with a back button and the module name.
   * Visor owns the returned widget and destroys it when the module is disabled.
   */
  buildView?(): St.Widget;
  /**
   * Slot 'dock': buttons on the right of the header of the view, such as
   * 'Open in app' or 'New'. Read every time the view is shown.
   */
  viewActions?: Action[];
  /** Results of this module in the search. */
  search?: SearchSource;
  /** Commands such as 'note <text>'. */
  commands?: Command[];
  /** Desktop id whose GNOME search provider is hidden because this module searches the same content. */
  replacesSearchProvider?: string;
}
export interface ModuleContext {
  kit: Kit;
  /** Slot 'now': the rows of this module. Rows are matched by id, so set() can be called often. */
  now: {
    set(rows: NowRow[]): void;
    clear(): void;
  };
  /** The chip of this module in the peek state. flash() also shows the peek state for three seconds, unless the user turned that off, Do Not Disturb is on or a window is in fullscreen. */
  peek: {
    set(chip: PeekChip | null): void;
    flash(chip: PeekChip): void;
  };
  /** Number on the dock icon, null removes it. */
  badge(count: number | null): void;
  /** Dot next to the clock while this module has something unread or waiting. */
  attention(kind: 'unread' | 'waiting' | null): void;
  /** Settings of the extension that owns the module, null if it has no schema. */
  settings: Gio.Settings | null;
  /** Shared HTTP session. Modules never create their own. */
  http: Soup.Session;
  /** True while the panel is open. Live updates (progress, countdowns) run only then. */
  readonly isOpen: boolean;
  /** Calls back when the panel opens or closes. Returns a function that removes the callback. */
  onOpenChanged(callback: (open: boolean) => void): () => void;
  /** Opens the panel, optionally on the view of the dock module with this id. */
  open(view?: string): void;
  close(): void;
  /** gettext of the extension that owns the module. */
  t: (s: string) => string;
}
export interface Action {
  /** Text of the button, or accessible name of an icon button. */
  label: string;
  /**
   * Symbolic icon name. With an icon and no style (or 'filled') the action is
   * a round icon button; with an icon and another style the icon sits before the text.
   */
  icon?: string;
  /**
   * 'primary' is the accent button, 'ghost' has no background, 'link' is accent
   * text without a background, 'filled' is the round play button.
   */
  style?: 'default' | 'primary' | 'ghost' | 'link' | 'filled';
  run(): void;
}
/** One row. Every field can change in KitRow.update(); the row is changed in place. */
export interface RowProps {
  /**
   * Symbolic icon name, or an image such as an app icon or cover art.
   * A row has an icon, a `lead` text, or neither.
   */
  icon?: string | Gio.Icon;
  /**
   * How the icon is drawn: 'symbolic' (17 px in the text colour, the default
   * for names), 'app' (28 px, the default for a Gio.Icon) or 'cover'
   * (a 36 px picture with round corners; needs a Gio.FileIcon).
   */
  iconStyle?: 'symbolic' | 'app' | 'cover';
  /** Short text in place of the icon, in a column of its own: a time or a day, such as '15:00'. */
  lead?: string;
  title: string;
  subtitle?: string;
  /** One line in monospace after the subtitle, such as the command an agent asks about. */
  detail?: string;
  /** Small quiet text on the right, such as a time or a size. Makes room for `actions` while they show. */
  meta?: string;
  /** Large number on the right, such as the remaining time of a timer. */
  value?: string;
  /** 'waiting' tints the row amber: it waits for the user. 'done' makes it quieter. */
  status?: 'normal' | 'waiting' | 'done';
  /** Click on the row, or Enter while it has the focus. */
  activate?: () => void;
  /** The main button, always visible on the right. Enter runs it when the row has no `activate`. */
  primary?: Action;
  /** Always visible on the right, before `primary`: media controls, or a ghost button such as 'Deny'. */
  controls?: Action[];
  /** Appear on hover or keyboard focus of the row. */
  actions?: Action[];
  /**
   * Content shown below the row when it is expanded. Built on first expand.
   * A row without `activate` and `toggle` expands on click; every expandable row has an arrow that does it. Pass the same function on every update(), a new one rebuilds the content.
   */
  expand?: () => St.Widget;
  /** 0..1 draws a thin line under the text, 'indeterminate' a small spinner when the end is unknown. */
  progress?: number | 'indeterminate';
  /** Colour of the progress line. */
  progressTone?: 'muted' | 'accent';
  /**
   * A switch at the very end of the row. A click on a row without `activate`
   * and `primary`, or Enter while it has the focus, flips it as well.
   * onChange gets the new state; the switch shows `active` of the last update().
   */
  toggle?: {
    active: boolean;
    onChange(active: boolean): void;
  };
}
/** A row in "Now". Rows are matched by id between two calls of now.set(). */
export interface NowRow extends RowProps {
  id: string;
}
export interface PeekChip {
  icon: string | Gio.Icon;
  text: string;
  /** 'accent' marks a new event, 'waiting' is amber. */
  tone?: 'normal' | 'accent' | 'waiting';
  /** Higher comes first. At most four chips are shown. */
  priority: number;
}
export interface Result {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string | Gio.Icon;
  /** Short hint on the right, such as 'Enter copies'. */
  hint?: string;
  /** Enter. */
  activate(): void;
  /** Ctrl+Enter, such as 'Open in app'. */
  alternate?: () => void;
}
export interface SearchSource {
  id: string;
  title: string;
  search(query: string, cancellable: Gio.Cancellable): Promise<Result[]>;
}
export interface Command {
  /** Words that trigger the command, in every supported language: ['timer']. */
  keyword: string[];
  /** Example shown while the arguments are incomplete: 'timer 25m Pizza'. */
  hint: string;
  /**
   * Called while the user types, so it must not change anything. Returns what
   * Enter would do for these arguments as results, each with its own
   * activate(). An empty list means the arguments are incomplete; then the
   * hint is shown.
   */
  resolve(args: string): Result[] | Promise<Result[]>;
}
/** UI building blocks. Modules use only these, so everything follows the theme. */
export interface Kit {
  /**
   * `toggle` puts a switch with its label at the right end of the header. Unlike
   * the links it is always visible, such as 'Do Not Disturb' for notifications.
   */
  section(props: { title: string; links?: Action[]; toggle?: ToggleProps }): KitSection;
  row(props: RowProps): KitRow;
  button(action: Action): St.Widget;
  iconButton(
    action: Action & {
      icon: string;
    },
  ): St.Widget;
  /** A switch without visible text; `label` is its accessible name. */
  toggle(props: ToggleProps): KitToggle;
  progress(props: { value: number | 'indeterminate'; tone?: 'muted' | 'accent' }): KitProgress;
  /** Quiet line for a section without content, such as 'No new notifications'. */
  empty(text: string): St.Widget;
  chip(chip: PeekChip): St.Widget;
}
export interface ToggleProps {
  label: string;
  active: boolean;
  /** The user moved the switch. */
  onChange(active: boolean): void;
}
export interface KitSection {
  actor: St.Widget;
  /** Add rows and other content here. */
  body: St.Widget;
  /** Links on the right of the title; they appear on hover or keyboard focus of the section. */
  setLinks(links: Action[]): void;
  /** The switch in the header, null when the section was built without `toggle`. */
  readonly toggle: KitToggle | null;
}
export interface KitRow {
  actor: St.Widget;
  /** Changes the row in place: hover, focus and the expanded state stay. */
  update(props: RowProps): void;
}
export interface KitToggle {
  actor: St.Widget;
  /** Setting it moves the switch without calling onChange. */
  active: boolean;
}
export interface KitProgress {
  actor: St.Widget;
  set(value: number | 'indeterminate'): void;
}
/** The object other extensions reach through `stateObj.api` of the Visor extension. */
export interface VisorApi {
  readonly version: number;
  /**
   * Adds a module. `owner` is the Extension object of the module's extension;
   * its settings and translations end up in the module context.
   * Throws when the id is taken or the module was built for another API version.
   */
  register(module: VisorModule, owner?: ModuleOwner): void;
  unregister(id: string): void;
}
/** The part of an Extension object Visor uses. */
export interface ModuleOwner {
  uuid: string;
  metadata: Record<string, unknown>;
  getSettings(schema?: string): Gio.Settings;
  gettext(s: string): string;
}
