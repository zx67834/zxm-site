import DocumentPage from "../../components/DocumentPage";
import { getArticle, getArticleMeta } from "../../data/articles";

export default function GameshellPage() {
  const article = getArticle("hmv-gameshell-4");
  return <DocumentPage
    kind={article.kind}
    title={article.title}
    meta={getArticleMeta(article)}
    source={article.source}
  />;
}
