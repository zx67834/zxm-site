"use client";

import { useEffect, useSyncExternalStore } from "react";
import { articles, getArticleMeta } from "../data/articles";
import DocumentPage from "./DocumentPage";

export default function ArticleRoute() {
  const slug = useSyncExternalStore(
    callback => {
      window.addEventListener("popstate", callback);
      return () => window.removeEventListener("popstate", callback);
    },
    () => new URLSearchParams(window.location.search).get("slug") || "",
    () => null,
  );

  const article = slug ? articles.find(item => item.slug === slug) : undefined;

  useEffect(() => {
    if (!article) return;
    document.title = `${article.title} · zxm 的小站`;
    return () => { document.title = "zxm 的小站"; };
  }, [article]);

  if (slug === null) {
    return <main className="document-page"><p className="document-status">正在打开文章…</p></main>;
  }

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
