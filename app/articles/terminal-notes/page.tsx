import DocumentPage from "../../components/DocumentPage";
import { getArticle, getArticleMeta } from "../../data/articles";

export default function TerminalNotesPage() {
  const article = getArticle("terminal-notes");
  return <DocumentPage
    kind={article.kind}
    title={article.title}
    meta={getArticleMeta(article)}
    source={article.source}
  />;
}
