/**
 * The picker's overlay: it renders the state from `picker.ts` and routes keys
 * to it. It owns no payload logic — `enter` hands the selected `PickerItem`
 * back to the command, which copies `payload(item)`.
 *
 * The rendering is a pure function of source, state, width and theme. It is
 * proven by the live run, not by a test: the parent spec allows one seam, the
 * extension's boundary.
 */

import type { KeybindingsManager, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  matchesKey,
  parseKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
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

/** A pane tall enough to browse, short enough to sit inside 80% of a terminal. */
const MAX_ROWS = 10;
const PREVIEW_LINES = 5;

/** The slice of `Theme` the overlay draws with. */
interface PickerTheme {
  fg(color: ThemeColor, text: string): string;
  bold(text: string): string;
  underline(text: string): string;
}

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

/** A labelled rule: the frame's top edge, or a divider between sections. */
function centredRule(
  label: string,
  innerWidth: number,
  theme: PickerTheme,
  edge: { open: string; close: string },
  colour: ThemeColor,
): string {
  const text = ` ${label} `;
  const width = visibleWidth(text);
  // A label wider than the frame would push the edge past the right border, so
  // the rule wins and the label is dropped.
  if (width > innerWidth)
    return theme.fg("border", edge.open + "─".repeat(innerWidth) + edge.close);
  const left = Math.max(0, Math.floor((innerWidth - width) / 2));
  const right = Math.max(0, innerWidth - width - left);
  return (
    theme.fg("border", edge.open + "─".repeat(left)) +
    theme.fg(colour, theme.bold(text)) +
    theme.fg("border", "─".repeat(right) + edge.close)
  );
}

const FRAME_TOP = { open: "╭", close: "╮" };
const SECTION = { open: "├", close: "┤" };

function midBorder(innerWidth: number, theme: PickerTheme): string {
  return theme.fg("border", SECTION.open + "─".repeat(innerWidth) + SECTION.close);
}

function bottomBorder(innerWidth: number, theme: PickerTheme): string {
  return theme.fg("border", "╰" + "─".repeat(innerWidth) + "╯");
}

/** A bordered row, padded to the frame's inner width so text cannot bleed through. */
function row(content: string, innerWidth: number, theme: PickerTheme): string {
  // One column of gutter on the right: a truncated line ends in `…`, and an
  // ellipsis pressed against the border reads as part of the frame.
  const text = truncateToWidth(content, Math.max(0, innerWidth - 1), "…", true) + " ";
  return theme.fg("border", "│") + text + theme.fg("border", "│");
}

function tabLabels(state: PickerState, source: PickerSource, theme: PickerTheme): string {
  // The count trails the name, so a bare digit is never read as a key to press.
  const label = (tab: "handoff" | "parsed", name: string, count: number) => {
    const text = `${name} ${count}`;
    return state.tab === tab
      ? theme.underline(theme.fg("accent", theme.bold(text)))
      : theme.fg("dim", text);
  };
  return `${label("handoff", "Hand-off", source.handoff.length)}  ${label(
    "parsed",
    "Agent reply",
    source.parsed.length,
  )}`;
}

function itemRow(item: PickerItem, selected: boolean, theme: PickerTheme): string {
  const arrow = selected ? theme.fg("accent", "→") : " ";
  const badge = item.badge === undefined ? "" : ` ${renderBadge(item.badge, selected, theme)}`;
  const label = selected
    ? theme.fg("accent", theme.bold(item.label))
    : theme.fg("text", item.label);
  return `${arrow}${badge} ${label}`;
}

function renderBadge(badge: string, selected: boolean, theme: PickerTheme): string {
  const text = `[${badge}]`;
  return selected ? theme.fg("accent", theme.bold(text)) : theme.fg("dim", text);
}

/** The body's text lines, without the trailing newline a block carries. */
function bodyLines(body: string): string[] {
  const text = body.endsWith("\n") ? body.slice(0, -1) : body;
  return text.split(/\r\n|\r|\n/);
}

function previewLines(item: PickerItem, innerWidth: number, theme: PickerTheme): string[] {
  const all = bodyLines(item.body);
  const shown = all.slice(0, PREVIEW_LINES);
  const lines = shown.map((line) => row(` ${theme.fg("muted", line)}`, innerWidth, theme));
  if (all.length > PREVIEW_LINES) {
    const more = all.length - PREVIEW_LINES;
    lines.push(
      row(` ${theme.fg("dim", `… ${more} more line${more === 1 ? "" : "s"}`)}`, innerWidth, theme),
    );
  }
  return lines;
}

const HINTS: { key: string; text: string }[] = [
  { key: "↑↓", text: "move" },
  { key: "tab", text: "switch" },
  { key: "enter", text: "copy" },
  { key: "esc", text: "cancel" },
];

/** The key hints that fit the frame; the rarest ones are dropped first. */
function helpLine(theme: PickerTheme, innerWidth: number): string {
  const sets = [
    HINTS,
    HINTS.filter((hint) => hint.key !== "tab"),
    HINTS.filter((hint) => hint.key === "enter" || hint.key === "esc"),
  ];
  for (const set of sets) {
    const text = set.map((hint) => `${theme.fg("accent", hint.key)} ${hint.text}`).join("  ·  ");
    if (visibleWidth(text) <= innerWidth - 2) return text;
  }
  return "";
}

/** Every line the overlay shows, at this width. */
function renderPicker(
  source: PickerSource,
  state: PickerState,
  width: number,
  theme: PickerTheme,
): string[] {
  const innerWidth = Math.max(1, width - 2);
  const lines: string[] = [
    centredRule("Copy", innerWidth, theme, FRAME_TOP, "accent"),
    row("", innerWidth, theme),
  ];

  lines.push(row(` ${tabLabels(state, source, theme)}`, innerWidth, theme));
  lines.push(row("", innerWidth, theme));

  const items = visibleItems(source, state);
  if (items.length === 0) {
    const message = state.filter === "" ? "Nothing to copy." : `Nothing matches “${state.filter}”.`;
    lines.push(row(` ${theme.fg("warning", message)}`, innerWidth, theme));
  } else {
    const start = windowStart(state.selected, items.length);
    const end = Math.min(items.length, start + MAX_ROWS);
    for (let offset = start; offset < end; offset += 1) {
      const item = items[offset]!;
      lines.push(row(` ${itemRow(item, offset === state.selected, theme)}`, innerWidth, theme));
    }
    if (items.length > 1) {
      const counter = `${state.selected + 1}/${items.length}`;
      const gap = " ".repeat(Math.max(0, innerWidth - 2 - visibleWidth(counter)));
      lines.push(row(` ${gap}${theme.fg("dim", counter)}`, innerWidth, theme));
    }
  }

  const notice = pickerNotice(source);
  if (notice !== undefined) lines.push(row(` ${theme.fg("dim", notice)}`, innerWidth, theme));

  const current = currentItem(source, state);
  if (current !== undefined) {
    const count = bodyLines(current.body).length;
    lines.push(
      centredRule(
        `Preview · ${count} line${count === 1 ? "" : "s"}`,
        innerWidth,
        theme,
        SECTION,
        "dim",
      ),
    );
    lines.push(...previewLines(current, innerWidth, theme));
  }

  lines.push(midBorder(innerWidth, theme));
  const filter =
    state.filter === ""
      ? theme.fg("dim", "type to filter · e.g. src, diff, table")
      : `${theme.fg("muted", "filter:")} ${theme.fg("accent", state.filter)}`;
  lines.push(row(` ${filter}`, innerWidth, theme));
  lines.push(row(` ${helpLine(theme, innerWidth)}`, innerWidth, theme));
  lines.push(bottomBorder(innerWidth, theme));
  return lines;
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

  const render = (width: number): string[] => {
    if (cachedLines !== undefined && cachedWidth === width) return cachedLines;
    const lines = renderPicker(source, state, width, theme);
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
