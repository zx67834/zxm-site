import Link from "next/link";
import NodeField from "../components/NodeField";
import SiteLogo from "../components/SiteLogo";
import ThemeToggle from "../components/ThemeToggle";
import { friendLinks } from "../data/links";

export default function LinksPage() {
  return <main className="subpage">
    <div className="subpage-background"><NodeField /></div>
    <nav className="subpage-nav preview-container preview-container--wide">
      <SiteLogo />
      <div><Link href="/">首页</Link><Link href="/articles">文章</Link><Link href="/terminal">终端</Link><ThemeToggle /></div>
    </nav>
    <section className="subpage-content preview-container">
      <p className="section-label">FRIENDS / LINKS</p>
      <h1>友情链接</h1>
      <p className="subpage-lead">常去看的站点。老师的博客也放在这里。</p>
      <ul className="friend-links">
        {friendLinks.map(link => <li key={link.href}>
          <a href={link.href} target="_blank" rel="noreferrer">
            <span>{link.kicker}</span>
            <strong>{link.name}</strong>
            <small>{link.note}</small>
            <em>{link.href.replace(/^https?:\/\//, "").replace(/\/$/, "")}</em>
            <b aria-hidden="true">↗</b>
          </a>
        </li>)}
      </ul>
    </section>
  </main>;
}
