import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the blog homepage and navigation", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN"/);
  assert.match(html, /<title>zxm 的小站<\/title>/i);
  assert.match(
    html,
    /name="description" content="文章、笔记与小小的网络角落。"/,
  );
  assert.match(html, /href="\/favicon-zxm\.svg"/);
  assert.match(html, />01 \/ ABOUT</);
  assert.match(html, />02 \/ WRITING LOG</);
  assert.match(html, />03 \/ EXPLORE</);
  assert.match(html, />04 \/ 本地时间</);
  assert.match(html, /href="\/articles"/);
  assert.match(html, /href="\/terminal"/);
  assert.match(html, /过去 365 天共记录/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("keeps reading and accessibility refinements in place", async () => {
  const [reader, nodeField, home, css] = await Promise.all([
    readFile(
      new URL("../app/components/DocumentReader.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/NodeField.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(reader, /if \(line\.startsWith\("# "\)\) continue/);
  assert.match(reader, /className="article-toc-mobile"/);
  assert.match(reader, /aria-label="文章目录"/);
  assert.match(home, /className="heatmap" aria-hidden="true"/);
  assert.match(home, /className="sr-only"/);
  assert.match(nodeField, /prefers-reduced-motion: reduce/);
  assert.match(nodeField, /visibilitychange/);
  assert.match(css, /max-width:820px/);
  assert.match(css, /heatmap-scroll-hint/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
