import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPicker, currentItem, payload, pickerFor, switchTab } from "../src/picker.ts";
import { lastReply, type SessionEntryLike } from "../src/session.ts";
import { makeRepo, remove } from "./helpers.ts";
import { NOTES } from "./fixtures/fenced-body-provider.ts";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeout);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

test(
  "the real binary persists blocks the hand-off tab copies byte for byte",
  { timeout: 120_000 },
  async () => {
    const extension = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    const provider = fileURLToPath(new URL("./fixtures/fenced-body-provider.ts", import.meta.url));
    const repo = await makeRepo({ "README.md": "hi\n" });
    const config = await mkdtemp(join(tmpdir(), "pi-copy-paste-config-"));
    const sessions = await mkdtemp(join(tmpdir(), "pi-copy-paste-sessions-"));

    try {
      const { stdout, stderr, code } = await run(
        "pi",
        [
          "-p",
          "-e",
          extension,
          "-e",
          provider,
          "--provider",
          "fenced-body",
          "--model",
          "fenced-body",
          "--no-builtin-tools",
          "--session-dir",
          sessions,
          "hand off notes.md",
        ],
        {
          cwd: repo,
          env: { ...process.env, PI_CODING_AGENT_DIR: config },
          timeout: 100_000,
        },
      );
      assert.equal(code, 0, `pi exited ${code}:\n${stderr}\n${stdout}`);
      assert.match(stdout, /Notes are ready\./);

      const files = await readdir(sessions);
      const sessionFile = files.find((file) => file.endsWith(".jsonl"));
      assert.ok(sessionFile, "pi did not write a session file");
      const entries = (await readFile(join(sessions, sessionFile!), "utf8"))
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as SessionEntryLike);

      const source = pickerFor(entries, undefined);
      assert.ok(source, "no assistant reply was persisted");
      const reply = lastReply(entries)!;
      assert.equal(source.handoff.length, 1);
      assert.equal(source.handoff[0]!.body, NOTES, "the persisted block body changed");

      let state = createPicker(source);
      assert.equal(state.tab, "handoff", "the picker should open on the hand-off tab");
      assert.equal(currentItem(source, state)?.label, "`notes.md` — new file, 7 lines");
      assert.equal(payload(currentItem(source, state)!), NOTES);

      // The rendered section fences the body with four backticks, because the
      // body carries a three-backtick fence of its own.
      assert.match(reply.text, /````md\n# Notes/);
      assert.ok(reply.text.includes(NOTES), "the spliced text is not the block body");

      // The Agent reply tab sees the same block; it is tagged md, so its fences stay
      // around a body that is the file's text, the hand-off tab's payload exactly.
      state = switchTab(state, "parsed");
      const parsed = currentItem(source, state)!;
      assert.equal(parsed.body, "````md\n" + NOTES + "\n````");
      assert.ok(parsed.body.includes("```sh\necho hi\n```"));
    } finally {
      await remove(repo);
      await remove(config);
      await remove(sessions);
    }
  },
);
