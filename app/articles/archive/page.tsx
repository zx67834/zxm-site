import Link from "next/link";
import ArticleArchive from "../../components/ArticleArchive";
import NodeField from "../../components/NodeField";
import SiteLogo from "../../components/SiteLogo";
import ThemeToggle from "../../components/ThemeToggle";

export default function ArticlesArchivePage() {
  return <main className="subpage">
    <div className="subpage-background"><NodeField /></div>
    <nav className="subpage-nav preview-container preview-container--wide">
      <SiteLogo />
      <div><Link href="/">首页</Link><Link href="/articles">全部文章</Link><Link href="/terminal">终端</Link><ThemeToggle /></div>
    </nav>
    <section className="subpage-content preview-container">
      <p className="section-label">TAXONOMY / ARCHIVE</p>
      <h1>分类和归档</h1>
      <p className="subpage-lead">生活、HackMyVM、春秋和渗透测试分开收着。时间线在全部文章。</p>
      <ArticleArchive />
    </section>
  </main>;
}
