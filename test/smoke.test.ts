import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../src/index.ts";

test("the default export is an extension factory", () => {
  assert.equal(typeof extension, "function");
});
