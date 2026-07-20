import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "content", "articles.json");
const articles = JSON.parse(await readFile(manifestPath, "utf8"));
const required = ["slug", "kind", "title", "summary", "publishedAt", "category", "source"];
const slugs = new Set();
const errors = [];

if (!Array.isArray(articles)) {
  throw new Error("content/articles.json 必须是一个数组。");
}

for (const [index, article] of articles.entries()) {
  const label = `第 ${index + 1} 篇`;
  for (const field of required) {
    if (!article[field]) errors.push(`${label}缺少 ${field}`);
  }
  if (!/^[a-z0-9-]+$/.test(article.slug || "")) errors.push(`${label}的 slug 只能使用小写字母、数字和连字符`);
  if (slugs.has(article.slug)) errors.push(`slug 重复：${article.slug}`);
  slugs.add(article.slug);
  if (!["markdown", "pdf"].includes(article.kind)) errors.push(`${article.slug} 的 kind 只能是 markdown 或 pdf`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(article.publishedAt || "")) errors.push(`${article.slug} 的 publishedAt 必须是 YYYY-MM-DD`);
  if (!article.source?.startsWith("/content/")) errors.push(`${article.slug} 的 source 必须位于 /content/`);
  if (article.kind === "pdf" && article.pages !== undefined && (!Number.isInteger(article.pages) || article.pages < 1)) {
    errors.push(`${article.slug} 的 pages 必须是正整数`);
  }

  if (article.source?.startsWith("/")) {
    try {
      await access(resolve(root, "public", article.source.slice(1)));
    } catch {
      errors.push(`${article.slug} 找不到文件：public${article.source}`);
    }
  }
}

if (errors.length) {
  console.error(`文章清单校验失败：\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`文章清单校验通过：${articles.length} 篇，热力图将记录 ${articles.length} 次更新。`);
