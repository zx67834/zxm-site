"use client";

import { useEffect, useState } from "react";
import { articles, getArticleMeta } from "../data/articles";
import DocumentPage from "./DocumentPage";

export default function ArticleRoute() {
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    setSlug(new URLSearchParams(window.location.search).get("slug") || "");
  }, []);

  if (slug === null) {
    return <main className="document-page"><p className="document-status">正在打开文章…</p></main>;
  }

  const article = articles.find(item => item.slug === slug);
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
