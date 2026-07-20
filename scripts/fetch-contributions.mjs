import { mkdir, writeFile } from "node:fs/promises";

const username = "zx67834";
const today = new Date();
const start = new Date(today);
start.setFullYear(start.getFullYear() - 1);
const iso = value => value.toISOString().slice(0, 10);
const url = `https://github.com/users/${username}/contributions?from=${iso(start)}&to=${iso(today)}`;
const response = await fetch(url, {
  headers: { "User-Agent": "zxm-static-blog/1.0", Accept: "text/html" },
});
if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
const html = await response.text();
const days = [];
for (const match of html.matchAll(/<td[^>]*data-date="([^"]+)"[^>]*data-level="([0-4])"[^>]*>/g)) {
  days.push({ date: match[1], level: Number(match[2]) });
}
if (!days.length) throw new Error("No contribution cells found");
const totalMatch = html.match(/([0-9,]+)\s+contributions?/i);
const output = {
  source: "github",
  username,
  generatedAt: new Date().toISOString(),
  total: totalMatch ? Number(totalMatch[1].replaceAll(",", "")) : null,
  days,
};
await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
await writeFile(new URL("../public/data/github-contributions.json", import.meta.url), JSON.stringify(output, null, 2));
console.log(`Saved ${days.length} GitHub contribution cells.`);
