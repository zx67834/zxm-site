import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const projectRoot = process.cwd();
const publicRoot = path.join(projectRoot, "public");
const contentRoot = path.join(publicRoot, "content");

const markdownFiles = (await fs.readdir(contentRoot, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith(".md"))
  .map(entry => path.join(contentRoot, entry.name));

const markdown = new Map();
const imageRefs = new Set();
const imagePattern = /\/content\/[^\s)>]+\.png/gi;

for (const file of markdownFiles) {
  const source = await fs.readFile(file, "utf8");
  markdown.set(file, source);
  for (const match of source.matchAll(imagePattern)) imageRefs.add(match[0]);
}

const replacements = new Map();
let sourceBytes = 0;
let outputBytes = 0;

for (const reference of imageRefs) {
  const sourcePath = path.join(publicRoot, ...reference.split("/").filter(Boolean));
  const outputReference = reference.replace(/\.png$/i, ".webp");
  const outputPath = path.join(publicRoot, ...outputReference.split("/").filter(Boolean));
  const temporaryPath = `${outputPath}.tmp`;
  const sourceStat = await fs.stat(sourcePath);

  await sharp(sourcePath).webp({ lossless: true, effort: 6 }).toFile(temporaryPath);
  const outputStat = await fs.stat(temporaryPath);

  if (outputStat.size >= sourceStat.size) {
    await fs.unlink(temporaryPath);
    continue;
  }

  await fs.rename(temporaryPath, outputPath);
  replacements.set(reference, outputReference);
  sourceBytes += sourceStat.size;
  outputBytes += outputStat.size;
}

for (const [file, source] of markdown) {
  let next = source;
  for (const [from, to] of replacements) next = next.split(from).join(to);
  if (next !== source) await fs.writeFile(file, next, "utf8");
}

for (const reference of replacements.keys()) {
  const sourcePath = path.join(publicRoot, ...reference.split("/").filter(Boolean));
  await fs.unlink(sourcePath);
}

const savedBytes = sourceBytes - outputBytes;
console.log(`Optimized ${replacements.size} images.`);
console.log(`Saved ${(savedBytes / 1024 / 1024).toFixed(2)} MB (${sourceBytes ? Math.round(savedBytes / sourceBytes * 100) : 0}%).`);
