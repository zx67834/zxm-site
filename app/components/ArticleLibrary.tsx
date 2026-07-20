import Link from "next/link";
import { articles, getArticleFormat, getArticleHref } from "../data/articles";

export default function ArticleLibrary() {
  return <div className="library-grid">
    {articles.map((item, index) => (
      <Link className="library-card" key={item.slug} href={getArticleHref(item)}>
        <span className="library-index">{String(index + 1).padStart(2, "0")}</span>
        <span className={`library-kind library-kind--${item.kind}`}>{getArticleFormat(item)}</span>
        <h3>{item.title}</h3>
        <p>{item.summary}</p>
        <time>{item.publishedAt.slice(0, 7).replace("-", ".")}</time>
        <span className="library-open">进入独立阅读页 ↗</span>
      </Link>
    ))}
  </div>;
}
