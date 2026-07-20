import Link from "next/link";
import NodeField from "../components/NodeField";
import SiteLogo from "../components/SiteLogo";
import Terminal from "../components/Terminal";

export default function TerminalPage() {
  return <main className="subpage subpage--terminal">
    <div className="subpage-background"><NodeField /></div>
    <nav className="subpage-nav preview-container preview-container--wide">
      <SiteLogo />
      <div><Link href="/">Home</Link><Link href="/articles">Articles</Link></div>
    </nav>
    <section className="subpage-content preview-container">
      <p className="section-label">INTERFACE / PSEUDO TERMINAL</p>
      <h1>不连接任何机器的终端。</h1>
      <p className="subpage-lead">它只是一张可以输入的个人名片。试试 help、whoami、ls -a 或 cat .secret。</p>
      <Terminal />
    </section>
  </main>;
}
