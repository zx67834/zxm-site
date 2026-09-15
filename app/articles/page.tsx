import Link from "next/link";
import { ArticleDateList } from "../components/ArticleLibrary";
import NodeField from "../components/NodeField";
import SiteLogo from "../components/SiteLogo";
import ThemeToggle from "../components/ThemeToggle";
import { articles } from "../data/articles";

export default function ArticlesPage() {
  return <main className="subpage">
    <div className="subpage-background"><NodeField /></div>
    <nav className="subpage-nav preview-container preview-container--wide">
      <SiteLogo />
      <div><Link href="/">首页</Link><Link href="/articles/archive">归档</Link><Link href="/terminal">终端</Link><ThemeToggle /></div>
    </nav>
    <section className="subpage-content preview-container">
      <p className="section-label">ALL ARTICLES / BY DATE</p>
      <h1>全部文章</h1>
      <p className="subpage-lead">一共 {articles.length} 篇，按月份从新到旧。要按类型翻，去归档。</p>
      <ArticleDateList />
    </section>
  </main>;
}
