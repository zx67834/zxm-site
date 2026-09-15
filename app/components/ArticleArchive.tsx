"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArticleCard, ArticleGroups } from "./ArticleLibrary";
import { articleCategories, articles, groupArticlesByCategory } from "../data/articles";

export default function ArticleArchive() {
  const [category, setCategory] = useState("");

  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("category") || "";
    setCategory(next);
  }, []);

  const select = (next: string) => {
    setCategory(next);
    const url = next ? `/articles/archive/?category=${encodeURIComponent(next)}` : "/articles/archive/";
    window.history.replaceState(null, "", url);
  };

  const filtered = useMemo(
    () => articles.filter(article => !category || article.category === category),
    [category],
  );
  const knownCategory = !category || articleCategories.some(item => item.name === category);

  return <div className="library-archive">
    <div className="library-toolbar">
      <nav className="library-filters" aria-label="文章分类">
        <button className={`library-filter${!category ? " is-active" : ""}`} type="button" onClick={() => select("")}>
          全部<b>{articles.length}</b>
        </button>
        {articleCategories.map(item => (
          <button
            className={`library-filter${category === item.name ? " is-active" : ""}`}
            type="button"
            onClick={() => select(item.name)}
            key={item.name}
          >
            {item.name}<b>{item.count}</b>
          </button>
        ))}
      </nav>
      <Link className="library-archive-meta" href="/articles/">全部文章 · 按日期</Link>
    </div>

    {!knownCategory || filtered.length === 0 ? <p className="library-empty">这个分类下暂时没有文章。</p> : category ? (
      <div className="library-grid">
        {filtered.map((item, index) => <ArticleCard item={item} index={index} key={item.slug} />)}
      </div>
    ) : (
      <ArticleGroups groups={groupArticlesByCategory(filtered).map(group => ({
        key: group.key,
        heading: group.key,
        items: group.items,
      }))} />
    )}
  </div>;
}
