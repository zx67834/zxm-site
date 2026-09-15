"use client";

import { useEffect } from "react";
import { articles, getArticleMeta } from "../data/articles";
import DocumentPage from "./DocumentPage";

export default function ArticleRoute({ slug }: { slug: string }) {
  const article = articles.find(item => item.slug === slug);

  useEffect(() => {
    if (!article) return;
    document.title = `${article.title} · zxm 的小站`;
    return () => { document.title = "zxm 的小站"; };
  }, [article]);

  if (!article) {
    return <main className="document-page"><p className="document-status">没有找到这篇文章。</p></main>;
  }

  return <DocumentPage
    kind={article.kind}
    title={article.title}
    meta={getArticleMeta(article)}
    source={article.source}
  />;
}
