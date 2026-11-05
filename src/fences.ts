/**
 * Scanning for fenced code blocks in a Markdown message.
 *
 * CommonMark decides the boundaries: an opening fence is a run of three or
 * more backticks or tildes whose remainder is that block's info string, and a
 * backtick fence's info string may not contain a backtick. A fence may be
 * indented by up to three spaces — more, and the line is ordinary text — while
 * its body keeps whatever indentation the message gives it. The body runs to a
 * closing fence of the same character, at least as long, with nothing after it
 * but whitespace. Any other line — including one that opens a shorter fence —
 * is content, so a block demonstrating a longer fence cannot desynchronise the
 * scan.
 *
 * Tables, lists and blockquotes are not this module's business.
 */

export interface FencedBlock {
  /** The opening fence's info string, trimmed; empty when it has none. */
  lang: string;
  /** The lines between the fences, joined with newlines. */
  body: string;
  /** Whether a closing fence ended the block, rather than the end of the text. */
  terminated: boolean;
}

const OPENING = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSING = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function closes(line: string, fence: string): boolean {
  const run = CLOSING.exec(line)?.[1];
  return run !== undefined && run[0] === fence[0] && run.length >= fence.length;
}

export function scanFencedBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  let index = 0;

  while (index < lines.length) {
    const opening = OPENING.exec(lines[index]!);
    const fence = opening?.[1];
    const info = opening?.[2] ?? "";
    if (fence === undefined || (fence[0] === "`" && info.includes("`"))) {
      index += 1;
      continue;
    }

    const body: string[] = [];
    let terminated = false;
    index += 1;
    for (; index < lines.length; index += 1) {
      if (closes(lines[index]!, fence)) {
        terminated = true;
        index += 1;
        break;
      }
      body.push(lines[index]!);
    }
    // The newline that ends the text is a terminator, not a final empty line,
    // so an unterminated body does not end in one; a blank last line, which is
    // how a hand-off block carries its body's trailing newline, does.
    if (!terminated && body.at(-1) === "") body.pop();

    blocks.push({ lang: info.trim(), body: body.join("\n"), terminated });
  }

  return blocks;
}
