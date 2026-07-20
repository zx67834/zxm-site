"use client";

import { useEffect, useState } from "react";

type DocumentReaderProps = {
  kind: "markdown" | "pdf";
  source: string;
  title: string;
};

function MarkdownBody({ source }: { source: string }) {
  let inCode = false;
  return <article className="markdown-body markdown-body--page">
    {source.split("\n").map((line, index) => {
      if (line.startsWith("```")) {
        inCode = !inCode;
        return null;
      }
      if (inCode) return <pre key={index}><code>{line}</code></pre>;
      if (line.startsWith("# ")) return <h1 key={index}>{line.slice(2)}</h1>;
      if (line.startsWith("## ")) return <h2 key={index}>{line.slice(3)}</h2>;
      if (line.startsWith("### ")) return <h3 key={index}>{line.slice(4)}</h3>;
      if (line.startsWith("- ")) return <li key={index}>{line.slice(2)}</li>;
      if (line.startsWith("> ")) return <blockquote key={index}>{line.slice(2)}</blockquote>;
      if (!line.trim()) return <br key={index} />;
      return <p key={index}>{line.replaceAll("`", "")}</p>;
    })}
  </article>;
}

export default function DocumentReader({ kind, source, title }: DocumentReaderProps) {
  const [markdown, setMarkdown] = useState("");
  const resolvedSource = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${source}`;

  useEffect(() => {
    if (kind !== "markdown") return;
    fetch(resolvedSource).then(response => response.text()).then(setMarkdown);
  }, [kind, resolvedSource]);

  if (kind === "pdf") {
    return <div className="pdf-viewport">
      <iframe
        className="pdf-frame pdf-frame--page"
        src={`${resolvedSource}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
        title={title}
      />
    </div>;
  }

  return <MarkdownBody source={markdown || "正在加载…"} />;
}
