import Link from "next/link";
import DocumentReader from "./DocumentReader";
import SiteLogo from "./SiteLogo";

type DocumentPageProps = {
  kind: "markdown" | "pdf";
  title: string;
  meta: string;
  source: string;
};

export default function DocumentPage({ kind, title, meta, source }: DocumentPageProps) {
  return <main className="document-page">
    <nav className="document-nav">
      <SiteLogo />
      <div>
        <Link href="/articles">全部文章</Link>
        <Link href="/terminal">终端</Link>
      </div>
    </nav>
    <header className="document-header">
      <div>
        <span>{meta}</span>
        <h1>{title}</h1>
      </div>
      <Link className="document-back" href="/articles">← 返回文章列表</Link>
    </header>
    <section className={`document-surface document-surface--${kind}`}>
      <DocumentReader kind={kind} source={source} title={title} />
    </section>
  </main>;
}
