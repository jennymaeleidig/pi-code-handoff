/**
 * The picker's testable core: what the two tabs contain, what `enter` copies,
 * and the selection state a key sequence moves.
 *
 * Rendering and key routing live outside this module. Everything here is pure,
 * so the acceptance-critical promise — the hand-off tab copies `block.body`
 * byte for byte — is checked by unit tests rather than by hand.
 */

import { blockBadge, type HandoffBlock, plural } from "./handoff.ts";
import { parseMarkdownBlocks } from "./markdown.ts";
import { type HandoffMemory, lastReply, replyBlocks, type SessionEntryLike } from "./session.ts";

export type PickerTab = "handoff" | "parsed";

export interface PickerItem {
  /** The human's label. Never part of the payload. */
  label: string;
  /** The exact text `enter` puts on the clipboard. */
  body: string;
  /** The bytes live in the block, not in this tag; the tag only names them for the list. */
  badge?: string;
}

export interface PickerSource {
  handoff: PickerItem[];
  parsed: PickerItem[];
}

export interface PickerState {
  tab: PickerTab;
  filter: string;
  /** Index into the filtered items of the active tab. */
  selected: number;
}

/** The hand-off tab: the validated blocks, labelled by their captions. */
export function handoffItems(blocks: readonly HandoffBlock[]): PickerItem[] {
  return blocks.map((block) => ({
    label: block.caption,
    body: block.body,
    badge: blockBadge(block),
  }));
}

/** The Agent reply tab: the reply's own markdown blocks, copied as raw markdown. */
export function parsedItems(text: string): PickerItem[] {
  const blocks = parseMarkdownBlocks(text).map((block) => ({
    label: block.label,
    body: block.body,
  }));
  if (text.trim() === "") return blocks;
  // Last, so the blocks themselves stay the first thing under the cursor; this
  // is the way out when nothing else on offer is the thing you want.
  const lines = (text.endsWith("\n") ? text.slice(0, -1) : text).split(/\r\n|\r|\n/).length;
  return [...blocks, { label: `[md] — full response, ${plural(lines, "line")}`, body: text }];
}

export function pickerSource(blocks: readonly HandoffBlock[], text: string): PickerSource {
  return { handoff: handoffItems(blocks), parsed: parsedItems(text) };
}

/** The picker for the last reply on the branch, or undefined without one. */
export function pickerFor(
  branch: readonly SessionEntryLike[],
  memory: HandoffMemory | undefined,
): PickerSource | undefined {
  const reply = lastReply(branch);
  if (reply === undefined) return undefined;
  return pickerSource(replyBlocks(branch, reply, memory), reply.text);
}

/** Open on hand-off when it has something; on parsed when it does not. */
export function createPicker(source: PickerSource): PickerState {
  return {
    tab: source.handoff.length > 0 ? "handoff" : "parsed",
    filter: "",
    selected: 0,
  };
}

export function tabItems(source: PickerSource, tab: PickerTab): PickerItem[] {
  return tab === "handoff" ? source.handoff : source.parsed;
}

function matches(item: PickerItem, needle: string): boolean {
  return item.label.toLowerCase().includes(needle) || item.body.toLowerCase().includes(needle);
}

/** The active tab's items after the filter, in source order. */
export function visibleItems(source: PickerSource, state: PickerState): PickerItem[] {
  const needle = state.filter.trim().toLowerCase();
  const items = tabItems(source, state.tab);
  return needle === "" ? items : items.filter((item) => matches(item, needle));
}

export function currentItem(source: PickerSource, state: PickerState): PickerItem | undefined {
  return visibleItems(source, state)[state.selected];
}

/** What `enter` copies: the body alone, never the label. */
export function payload(item: PickerItem): string {
  return item.body;
}

export function switchTab(state: PickerState, tab: PickerTab): PickerState {
  return { tab, filter: state.filter, selected: 0 };
}

export function typeFilter(state: PickerState, text: string): PickerState {
  return { ...state, filter: state.filter + text, selected: 0 };
}

export function eraseFilter(state: PickerState): PickerState {
  if (state.filter === "") return state;
  return { ...state, filter: state.filter.slice(0, -1), selected: 0 };
}

export function moveSelection(
  source: PickerSource,
  state: PickerState,
  delta: number,
): PickerState {
  const count = visibleItems(source, state).length;
  if (count === 0) return state.selected === 0 ? state : { ...state, selected: 0 };
  const selected = (((state.selected + delta) % count) + count) % count;
  return { ...state, selected };
}

/** What the picker says when a tab has nothing, or the reply has nothing at all. */
export function pickerNotice(source: PickerSource): string | undefined {
  if (source.handoff.length === 0 && source.parsed.length === 0) {
    return "No blocks in this reply; nothing to copy.";
  }
  if (source.handoff.length === 0) {
    return "No hand-off blocks in this reply; showing the reply's own markdown.";
  }
  return undefined;
}
