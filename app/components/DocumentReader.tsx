"use client";

import { useEffect, useState, type ReactNode } from "react";

type DocumentReaderProps = {
  kind: "markdown" | "pdf";
  source: string;
  title: string;
};

function MarkdownBody({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
      if (line.startsWith("```")) {
        const code: string[] = [];
        const language = line.slice(3).trim();
        index += 1;
        while (index < lines.length && !lines[index].startsWith("```")) {
          code.push(lines[index]);
          index += 1;
        }
        blocks.push(<pre className="markdown-code" key={`code-${index}`}>
          {language && <span className="markdown-code-language">{language}</span>}
          <code>{code.join("\n")}</code>
        </pre>);
        continue;
      }

      const imagePattern = /!\[([^\]]*)\]\((?:<)?([^)>]+)(?:>)?\)/g;
      const galleryImages = [...line.matchAll(imagePattern)];
      if (galleryImages.length > 1 && !line.replace(imagePattern, "").trim()) {
        blocks.push(<div className="markdown-gallery" key={`gallery-${index}`}>
          {galleryImages.map((match, imageIndex) => {
            const [, alt, rawSrc] = match;
            const src = rawSrc.startsWith("/")
              ? `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${rawSrc}`
              : rawSrc;
            return <figure className="markdown-figure" key={`${index}-${imageIndex}`}>
              <img className="markdown-image" src={src} alt={alt} loading="lazy" />
              {alt && <figcaption>{alt}</figcaption>}
            </figure>;
          })}
        </div>);
        continue;
      }

      const image = line.match(/^!\[([^\]]*)\]\((?:<)?([^)>]+)(?:>)?\)$/);
      if (image) {
        const [, alt, rawSrc] = image;
        const src = rawSrc.startsWith("/")
          ? `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${rawSrc}`
          : rawSrc;
        blocks.push(<figure className="markdown-figure" key={index}>
          <img className="markdown-image" src={src} alt={alt} loading="lazy" />
          {alt && <figcaption>{alt}</figcaption>}
        </figure>);
        continue;
      }

      if (line.startsWith("| ") && /^\|[\s|:-]+\|$/.test(lines[index + 1] || "")) {
        const cells = (value: string) => value.split("|").slice(1, -1).map(cell => cell.trim());
        const header = cells(line);
        const rows: string[][] = [];
        index += 2;
        while (lines[index]?.startsWith("| ")) {
          rows.push(cells(lines[index]));
          index += 1;
        }
        index -= 1;
        blocks.push(<div className="markdown-table-wrap" key={`table-${index}`}><table className="markdown-table">
          <thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{cell}</th>)}</tr></thead>
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
        </table></div>);
        continue;
      }

      if (line.startsWith("# ")) blocks.push(<h1 key={index}>{line.slice(2)}</h1>);
      else if (line.startsWith("## ")) blocks.push(<h2 key={index}>{line.slice(3)}</h2>);
      else if (line.startsWith("### ")) blocks.push(<h3 key={index}>{line.slice(4)}</h3>);
      else if (line.startsWith("- ")) blocks.push(<li key={index}>{line.slice(2)}</li>);
      else if (line.startsWith("> ")) blocks.push(<blockquote key={index}>{line.slice(2)}</blockquote>);
      else if (!line.trim()) blocks.push(<br key={index} />);
      else blocks.push(<p key={index}>{line.replaceAll("`", "")}</p>);
  }

  return <article className="markdown-body markdown-body--page">{blocks}</article>;
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
