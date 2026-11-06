/**
 * The picker's overlay: it renders the state from `picker.ts` and routes keys
 * to it. It owns no payload logic — `enter` hands the selected `PickerItem`
 * back to the command, which copies `payload(item)`.
 */

import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, parseKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
  createPicker,
  currentItem,
  eraseFilter,
  moveSelection,
  type PickerItem,
  pickerNotice,
  type PickerSource,
  type PickerState,
  switchTab,
  typeFilter,
  visibleItems,
} from "./picker.ts";

const MAX_ROWS = 12;

export interface PickerViewOptions {
  source: PickerSource;
  theme: Theme;
  keybindings: KeybindingsManager;
  requestRender: () => void;
  done: (item: PickerItem | undefined) => void;
}

export interface PickerView extends Component {
  invalidate(): void;
}

function printable(data: string): string | undefined {
  const key = parseKey(data);
  if (key === undefined) return undefined;
  if (key.length === 1) return key;
  return /^shift\+(.)$/s.exec(key)?.[1];
}

/** Window the list around the selection so long replies stay navigable. */
function windowStart(selected: number, count: number): number {
  if (count <= MAX_ROWS) return 0;
  return Math.min(Math.max(0, selected - MAX_ROWS + 1), count - MAX_ROWS);
}

export function createPickerView(options: PickerViewOptions): PickerView {
  const { source, theme, keybindings, requestRender, done } = options;
  let state: PickerState = createPicker(source);
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;

  const invalidate = () => {
    cachedWidth = undefined;
    cachedLines = undefined;
  };

  const update = (next: PickerState) => {
    state = next;
    invalidate();
    requestRender();
  };

  const toggleTab = () => {
    update(switchTab(state, state.tab === "handoff" ? "parsed" : "handoff"));
  };

  const tabLabel = (tab: "handoff" | "parsed", name: string, count: number) => {
    const text = `${name} ${count}`;
    return state.tab === tab ? theme.underline(theme.fg("accent", text)) : theme.fg("dim", text);
  };

  const render = (width: number): string[] => {
    if (cachedLines !== undefined && cachedWidth === width) return cachedLines;
    const line = (text: string) => truncateToWidth(text, width);
    const lines: string[] = [];

    lines.push(
      line(
        `${theme.bold("Copy")}  ${tabLabel("handoff", "Hand-off", source.handoff.length)}` +
          `  ${tabLabel("parsed", "Parsed", source.parsed.length)}`,
      ),
    );
    lines.push(line(theme.fg("dim", "─".repeat(Math.max(0, width)))));

    const filter = state.filter === "" ? theme.fg("dim", "type to filter") : state.filter;
    lines.push(line(`${theme.fg("dim", "Filter:")} ${filter}`));

    const items = visibleItems(source, state);
    if (items.length === 0) {
      const message = state.filter === "" ? "  Nothing to copy." : "  No item matches the filter.";
      lines.push(line(theme.fg("dim", message)));
    } else {
      const start = windowStart(state.selected, items.length);
      for (let offset = start; offset < Math.min(items.length, start + MAX_ROWS); offset += 1) {
        const item = items[offset]!;
        const caption = `${offset === state.selected ? "▸ " : "  "}${item.label}`;
        lines.push(line(offset === state.selected ? theme.fg("accent", caption) : caption));
      }
    }

    const notice = pickerNotice(source);
    if (notice !== undefined) lines.push(line(theme.fg("dim", notice)));

    lines.push(
      line(
        theme.fg("dim", "tab switch · 1/2 jump · ↑↓ move · type filter · enter copy · esc cancel"),
      ),
    );

    cachedWidth = width;
    cachedLines = lines;
    return lines;
  };

  return {
    render,
    handleInput(data: string): void {
      if (keybindings.matches(data, "tui.select.cancel")) {
        done(undefined);
        return;
      }
      if (matchesKey(data, "shift+tab") || matchesKey(data, "tab")) {
        toggleTab();
        return;
      }
      const key = parseKey(data);
      if (key === "1") {
        update(switchTab(state, "handoff"));
        return;
      }
      if (key === "2") {
        update(switchTab(state, "parsed"));
        return;
      }
      if (keybindings.matches(data, "tui.select.up")) {
        update(moveSelection(source, state, -1));
        return;
      }
      if (keybindings.matches(data, "tui.select.down")) {
        update(moveSelection(source, state, 1));
        return;
      }
      if (keybindings.matches(data, "tui.select.confirm")) {
        const item = currentItem(source, state);
        if (item !== undefined) done(item);
        return;
      }
      if (matchesKey(data, "backspace")) {
        update(eraseFilter(state));
        return;
      }
      const text = printable(data);
      if (text !== undefined) update(typeFilter(state, text));
    },
    invalidate,
  };
}
