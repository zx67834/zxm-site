import Link from "next/link";
import ArticleLibrary from "../components/ArticleLibrary";
import NodeField from "../components/NodeField";
import SiteLogo from "../components/SiteLogo";

export default function ArticlesPage() {
  return <main className="subpage">
    <div className="subpage-background"><NodeField /></div>
    <nav className="subpage-nav preview-container preview-container--wide">
      <SiteLogo />
      <div><Link href="/">Home</Link><Link href="/terminal">Terminal</Link></div>
    </nav>
    <section className="subpage-content preview-container">
      <p className="section-label">ARTICLES / MARKDOWN & PDF</p>
      <h1>文章与笔记</h1>
      <p className="subpage-lead">写下仍然值得被记住的东西。点击文章，在浏览器里安静地读完。</p>
      <ArticleLibrary />
    </section>
  </main>;
}
