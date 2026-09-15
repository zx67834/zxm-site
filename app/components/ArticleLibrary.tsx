import Link from "next/link";
import {
  articles,
  getArticleFormat,
  getArticleHref,
  groupArticlesByMonth,
  monthHeading,
  type Article,
} from "../data/articles";

function ArticleCard({ item, index }: { item: Article; index: number }) {
  return <Link className="library-card" href={getArticleHref(item)}>
    <span className="library-index">{String(index + 1).padStart(2, "0")}</span>
    <span className="library-kind" data-category={item.category}>{item.category}</span>
    <h3>{item.title}</h3>
    <p>{item.summary}</p>
    <time>{item.publishedAt.slice(0, 7).replace("-", ".")} · {getArticleFormat(item)}</time>
    <span className="library-open">进入独立阅读页 ↗</span>
  </Link>;
}

export function ArticleGroups({ groups }: { groups: { key: string; heading: string; items: Article[] }[] }) {
  return groups.map(group => (
    <section className="archive-group" key={group.key}>
      <header className="archive-group-head">
        <h2>{group.heading}</h2>
        <span>{String(group.items.length).padStart(2, "0")} 篇</span>
      </header>
      <div className="library-grid">
        {group.items.map((item, index) => <ArticleCard item={item} index={index} key={item.slug} />)}
      </div>
    </section>
  ));
}

export function ArticleDateList() {
  return <div className="library-archive">
    <ArticleGroups groups={groupArticlesByMonth(articles).map(group => ({
      key: group.key,
      heading: monthHeading(group.key),
      items: group.items,
    }))} />
  </div>;
}

export { ArticleCard };
