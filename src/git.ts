/**
 * The repository and shell checks the tool depends on. Nothing here writes to
 * the target repository: the patch is checked, never applied.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TOOL_NAME } from "./handoff.ts";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], cwd?: string, input?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function existingDirectory(target: string): string {
  let current = target;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return statSync(current).isDirectory() ? current : dirname(current);
}

/** The repository root containing `target`, or an error naming the target. */
export async function repositoryRoot(target: string): Promise<string> {
  const directory = existingDirectory(target);
  const result = await run("git", ["-C", directory, "rev-parse", "--show-toplevel"]);
  const root = result.stdout.trim();
  if (result.code !== 0 || root === "") {
    throw new Error(
      `"${target}" is not inside a git repository. ${TOOL_NAME} only hands off changes that ` +
        `\`git apply\` can check, so initialize or move into a repository first.`,
    );
  }
  return root;
}

/** Ask git whether a patch applies to the working tree. */
export async function checkPatch(root: string, patch: string): Promise<void> {
  const result = await run("git", ["apply", "--check", "-p1"], root, patch);
  if (result.code !== 0) {
    throw new Error(result.stderr.trimEnd() || "git apply --check rejected the block.");
  }
}

/** Syntax-check a shell command with `bash -n` on a temporary file. */
export async function checkCommand(command: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pi-code-handoff-"));
  const file = join(directory, "command.sh");
  try {
    await writeFile(file, command, "utf8");
    const result = await run("bash", ["-n", file]);
    if (result.code !== 0) {
      throw new Error(`bash -n rejected the command:\n${result.stderr.trim()}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
