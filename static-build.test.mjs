import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildStaticSite } from "./scripts/build.mjs";

test("production build creates one deployable static directory", async () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "heliopulse-build-"));

  try {
    await buildStaticSite({ outputDirectory });

    assert.equal(existsSync(join(outputDirectory, "index.html")), true);
    assert.equal(existsSync(join(outputDirectory, "style.css")), true);
    assert.equal(existsSync(join(outputDirectory, "app.js")), true);
    assert.match(readFileSync(join(outputDirectory, "index.html"), "utf8"), /src="\.\/app\.js"/);
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("Vercel deploys the production static directory", () => {
  const config = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8"));
  assert.equal(config.buildCommand, "npm run setup");
  assert.equal(config.outputDirectory, "dist");
});
