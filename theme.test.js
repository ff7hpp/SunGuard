import assert from "node:assert/strict";
import test from "node:test";
import { themes, validTheme } from "./theme.js";

test("the dashboard supports dark, calm, and light themes", () => {
  assert.deepEqual(themes, ["dark", "calm", "light"]);
  assert.equal(validTheme("calm"), "calm");
  assert.equal(validTheme("unsupported"), "dark");
});
