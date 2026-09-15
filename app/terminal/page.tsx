import Link from "next/link";
import NodeField from "../components/NodeField";
import SiteLogo from "../components/SiteLogo";
import Terminal from "../components/Terminal";
import ThemeToggle from "../components/ThemeToggle";

export default function TerminalPage() {
  return <main className="subpage subpage--terminal">
    <div className="subpage-background"><NodeField /></div>
    <nav className="subpage-nav preview-container preview-container--wide">
      <SiteLogo />
      <div><Link href="/">首页</Link><Link href="/articles">文章</Link><ThemeToggle /></div>
    </nav>
    <section className="subpage-content preview-container">
      <p className="section-label">INTERFACE / PSEUDO TERMINAL</p>
      <h1>不连接任何机器的终端</h1>
      <p className="subpage-lead">没有 SSH，也不连靶机。help 看能干什么，whoami 是名片，ls -a 和 cat .secret 会再漏一点出来。</p>
      <Terminal />
    </section>
  </main>;
}
