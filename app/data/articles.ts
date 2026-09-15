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

const categoryOrder = ["渗透测试", "HackMyVM", "春秋", "生活", "文章"];

export const articleCategories = categoryOrder
  .filter(name => articles.some(article => article.category === name))
  .concat([...new Set(articles.map(article => article.category))].filter(name => !categoryOrder.includes(name)))
  .map(name => ({ name, count: articles.filter(article => article.category === name).length }));

export const articleYears = [...new Set(articles.map(article => article.publishedAt.slice(0, 4)))]
  .sort((a, b) => b.localeCompare(a));

export function monthHeading(key: string) {
  const [year, month] = key.split("-");
  return `${year} · ${Number(month)}月`;
}

export function groupArticlesByMonth(items: Article[]) {
  return items.reduce<{ key: string; items: Article[] }[]>((groups, article) => {
    const key = article.publishedAt.slice(0, 7);
    const current = groups.at(-1);
    if (current?.key === key) current.items.push(article);
    else groups.push({ key, items: [article] });
    return groups;
  }, []);
}

export function groupArticlesByCategory(items: Article[]) {
  return articleCategories
    .map(category => ({ key: category.name, items: items.filter(article => article.category === category.name) }))
    .filter(group => group.items.length > 0);
}

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
