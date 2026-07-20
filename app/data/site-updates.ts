import { articles } from "./articles";

export const siteUpdates = articles.map(article => ({
  date: article.publishedAt,
  count: 1,
  type: article.category,
  label: article.title,
  summary: article.summary,
}));
