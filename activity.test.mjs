import assert from "node:assert/strict";
import test from "node:test";
import { activitySubject } from "./activity.mjs";

test("system simulation actions do not require a selected panel", () => {
  assert.equal(activitySubject(null, [{ id: "R01-C01" }]), "SIMULATOR");
  assert.equal(activitySubject(0, [{ id: "R01-C01" }]), "R01-C01");
});
