import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PAGE_SCRIPT } from "../src/page-script.ts";
import { renderPickup } from "../src/page.ts";

const source = readFileSync(new URL("../src/download-client.ts", import.meta.url), "utf8");

test("download page reads the content key from the fragment and posts only the code", () => {
  assert.match(source, /location\.hash/);
  assert.match(source, /JSON\.stringify\(\{ code \}\)/);
  assert.doesNotMatch(source, /LOCKER_HMAC_SECRET/);
  assert.doesNotMatch(source, /locker-pickup-v1/);
  assert.match(PAGE_SCRIPT, /\/api\//);
  assert.match(PAGE_SCRIPT, /\.hash/);
  const html = renderPickup("aB3dE6gH9k", "</script><script>alert(1)");
  assert.match(html, /data-slug="aB3dE6gH9k"/);
  assert.doesNotMatch(html, /<\/script><script>alert\(1\)/);
});