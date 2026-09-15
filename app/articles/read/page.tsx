import ArticleRoute from "../../components/ArticleRoute";

export default async function ArticleReadPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const { slug = "" } = await searchParams;
  return <ArticleRoute slug={slug} />;
}
