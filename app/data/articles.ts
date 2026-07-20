import articleManifest from "../../content/articles.json";

export type ArticleKind = "markdown" | "pdf";

export type Article = {
  slug: string;
  kind: ArticleKind;
  title: string;
  summary: string;
  publishedAt: string;
  category: string;
  source: string;
  pages?: number;
};

export const articles = (articleManifest as Article[])
  .slice()
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

export function getArticle(slug: string) {
  const article = articles.find(item => item.slug === slug);
  if (!article) throw new Error(`Unknown article: ${slug}`);
  return article;
}

export function getArticleHref(article: Article) {
  return `/articles/read?slug=${encodeURIComponent(article.slug)}`;
}

export function getArticleFormat(article: Article) {
  if (article.kind === "markdown") return "MARKDOWN";
  return `PDF${article.pages ? ` · ${article.pages} PAGES` : ""}`;
}

export function getArticleMeta(article: Article) {
  return `${getArticleFormat(article)} · ${article.publishedAt.slice(0, 7).replace("-", ".")}`;
}
