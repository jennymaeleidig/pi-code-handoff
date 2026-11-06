import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scanFenceSpans } from "../src/fences.ts";
import { makeRepo, remove } from "./helpers.ts";

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

test("the real pi binary persists the spliced hand-off section", { timeout: 120_000 }, async () => {
  const extension = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const provider = fileURLToPath(new URL("./fixtures/scripted-provider.ts", import.meta.url));
  const repo = await makeRepo({ "a.txt": "one\n", "b.txt": "two\n" });
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
        "scripted",
        "--model",
        "scripted",
        "--no-builtin-tools",
        "--session-dir",
        sessions,
        "hand off the changes",
      ],
      {
        cwd: repo,
        env: { ...process.env, PI_CODING_AGENT_DIR: config },
        timeout: 100_000,
      },
    );
    assert.equal(code, 0, `pi exited ${code}:\n${stderr}\n${stdout}`);

    assert.match(stdout, /Both files are ready\./);
    assert.match(stdout, /## Hand-off/);

    const files = await readdir(sessions);
    const sessionFile = files.find((file) => file.endsWith(".jsonl"));
    assert.ok(sessionFile, "pi did not write a session file");
    const entries = (await readFile(join(sessions, sessionFile!), "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const assistants = entries.filter((entry) => {
      const message = entry.message as { role?: string } | undefined;
      return entry.type === "message" && message?.role === "assistant";
    });
    assert.ok(assistants.length > 0, "no assistant entry was persisted");

    const message = assistants[assistants.length - 1]!.message as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");

    const blocks = scanFenceSpans(text);
    assert.equal(blocks.length, 2, `expected two blocks in:\n${text}`);
    assert.deepEqual(
      blocks.map((block) => block.lang),
      ["diff", "diff"],
    );
    assert.match(blocks[0]!.body, /a\.txt/);
    assert.match(blocks[1]!.body, /b\.txt/);
    assert.ok(
      blocks[0]!.body.endsWith("\n"),
      "the whole-reply block must be a newline-terminated patch",
    );

    const aCaptions = text.match(/`a\.txt`/g) ?? [];
    const bCaptions = text.match(/`b\.txt`/g) ?? [];
    assert.equal(aCaptions.length, 1);
    assert.equal(bCaptions.length, 1);

    assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "one\n", "pi never wrote the target");
  } finally {
    await remove(repo);
    await remove(config);
    await remove(sessions);
  }
});
