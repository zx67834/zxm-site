"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

type DocumentReaderProps = {
  kind: "markdown" | "pdf";
  source: string;
  title: string;
};

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);

  const toggle = () => setRevealed(value => !value);
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };

  return <span
    className={`markdown-spoiler${revealed ? " is-revealed" : ""}`}
    onClick={toggle}
    onKeyDown={onKeyDown}
    role="button"
    tabIndex={0}
    aria-expanded={revealed}
    aria-label={revealed ? "隐藏内容" : "显示隐藏内容"}
  >{children}</span>;
}

/** Inline markdown: **bold**, *italic*, `code`, [text](url), ~~strike~~, ||spoiler|| */
function renderInline(text: string): ReactNode[] {
  const pattern = /(\|\|.+?\|\||~~.+?~~|\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`|\[[^\]]+?\]\([^)]+?\))/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("||") && token.endsWith("||")) {
      nodes.push(<Spoiler key={`s-${key++}`}>{renderInline(token.slice(2, -2))}</Spoiler>);
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(<span className="markdown-strike" key={`d-${key++}`}>{renderInline(token.slice(2, -2))}</span>);
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`b-${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={`i-${key++}`}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={`c-${key++}`}>{token.slice(1, -1)}</code>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        nodes.push(<a key={`a-${key++}`} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
      } else {
        nodes.push(token);
      }
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownBody({ source }: { source: string }) {
  const lines = source.split(/\r?\n/);
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

      const parseImageMeta = (rawAlt: string) => {
        const widthMatch = rawAlt.match(/^(.*?)(?:\|(\d+))?$/);
        const alt = (widthMatch?.[1] || "").trim();
        const width = widthMatch?.[2] ? Number(widthMatch[2]) : undefined;
        return { alt, width };
      };

      const renderImage = (rawAlt: string, rawSrc: string, key: string | number) => {
        const { alt, width } = parseImageMeta(rawAlt);
        const src = rawSrc.startsWith("/")
          ? `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${rawSrc}`
          : rawSrc;
        return <figure className={`markdown-figure${width ? " markdown-figure--sized" : ""}`} key={key}>
          <img
            className="markdown-image"
            src={src}
            alt={alt}
            loading="lazy"
            style={width ? { width: `${width}px`, maxWidth: "100%" } : undefined}
          />
          {alt && <figcaption>{alt}</figcaption>}
        </figure>;
      };

      const imagePattern = /!\[([^\]]*)\]\((?:<)?([^)>]+)(?:>)?\)/g;
      const galleryImages = [...line.matchAll(imagePattern)];
      if (galleryImages.length > 1 && !line.replace(imagePattern, "").trim()) {
        const sized = galleryImages.some(match => Boolean(parseImageMeta(match[1]).width));
        blocks.push(<div className={`markdown-gallery${sized ? " markdown-gallery--sized" : ""}`} key={`gallery-${index}`}>
          {galleryImages.map((match, imageIndex) => {
            const [, rawAlt, rawSrc] = match;
            return renderImage(rawAlt, rawSrc, `${index}-${imageIndex}`);
          })}
        </div>);
        continue;
      }

      const image = line.match(/^!\[([^\]]*)\]\((?:<)?([^)>]+)(?:>)?\)$/);
      if (image) {
        const [, rawAlt, rawSrc] = image;
        blocks.push(renderImage(rawAlt, rawSrc, index));
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
          <thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell)}</th>)}</tr></thead>
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell)}</td>)}</tr>)}</tbody>
        </table></div>);
        continue;
      }

      if (line.startsWith("# ")) blocks.push(<h1 key={index}>{renderInline(line.slice(2))}</h1>);
      else if (line.startsWith("## ")) blocks.push(<h2 key={index}>{renderInline(line.slice(3))}</h2>);
      else if (line.startsWith("### ")) blocks.push(<h3 key={index}>{renderInline(line.slice(4))}</h3>);
      else if (line.startsWith("#### ")) blocks.push(<h4 key={index}>{renderInline(line.slice(5))}</h4>);
      else if (/^\d+\.\s/.test(line)) blocks.push(<li key={index}>{renderInline(line.replace(/^\d+\.\s/, ""))}</li>);
      else if (line.startsWith("- ")) blocks.push(<li key={index}>{renderInline(line.slice(2))}</li>);
      else if (line.startsWith("> ")) blocks.push(<blockquote key={index}>{renderInline(line.slice(2))}</blockquote>);
      else if (/^---+$/.test(line.trim())) blocks.push(<hr key={index} />);
      else if (!line.trim()) continue;
      else blocks.push(<p key={index}>{renderInline(line)}</p>);
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
