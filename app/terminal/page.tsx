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
      <header className="terminal-intro">
        <div>
          <p className="section-label">INTERFACE / PSEUDO TERMINAL</p>
          <h1>不连接任何机器的终端</h1>
          <p className="subpage-lead">它只运行在浏览器里，不连接 SSH，也不碰真实机器。输入 help 开始，Tab 补全，方向键翻阅历史。</p>
        </div>
        <div className="terminal-intro-status" aria-hidden="true"><i /><span>READY</span><small>LOCAL / SAFE / STATIC</small></div>
      </header>
      <Terminal />
    </section>
  </main>;
}
