import DocumentPage from "../../components/DocumentPage";
import { getArticle, getArticleMeta } from "../../data/articles";

export default function HelixPage() {
  const article = getArticle("hmv-helix");
  return <DocumentPage
    kind={article.kind}
    title={article.title}
    meta={getArticleMeta(article)}
    source={article.source}
  />;
}
