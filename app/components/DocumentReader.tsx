"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react";

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

type Heading = {
  id: string;
  level: number;
  label: string;
};

function headingId(label: string, line: number) {
  const readable = label
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `section-${line}-${readable || "heading"}`;
}

function getHeadings(source: string): Heading[] {
  let inCode = false;
  return source.split(/\r?\n/).flatMap((line, index) => {
    if (line.startsWith("```")) {
      inCode = !inCode;
      return [];
    }
    if (inCode) return [];
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (!match) return [];
    return [{ id: headingId(match[2], index), level: match[1].length, label: match[2] }];
  });
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return <div className="markdown-code-block">
    <div className="markdown-code-toolbar">
      <span className="markdown-code-language">{language || "plain text"}</span>
      <button className="markdown-copy" type="button" onClick={copy} aria-label="复制代码">
        {copied ? "已复制" : "复制"}
      </button>
    </div>
    <pre className="markdown-code"><code>{code}</code></pre>
  </div>;
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
        blocks.push(<CodeBlock code={code.join("\n")} language={language} key={`code-${index}`} />);
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
        const cells = (value: string) => {
          const parts: string[] = [];
          const masked = value.replace(/\\\|/g, () => {
            parts.push("|");
            return `\u0000${parts.length - 1}\u0000`;
          });
          return masked.split("|").slice(1, -1).map(cell =>
            cell.trim().replace(/\u0000(\d+)\u0000/g, (_, i) => parts[Number(i)])
          );
        };
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

      // The document shell already renders the article title. Markdown files keep
      // their H1 for portability, but repeating it inside the reader wastes the
      // first screen and is especially noticeable on phones.
      if (line.startsWith("# ")) continue;
      else if (line.startsWith("## ")) blocks.push(<h2 id={headingId(line.slice(3), index)} key={index}>{renderInline(line.slice(3))}</h2>);
      else if (line.startsWith("### ")) blocks.push(<h3 id={headingId(line.slice(4), index)} key={index}>{renderInline(line.slice(4))}</h3>);
      else if (line.startsWith("#### ")) blocks.push(<h4 id={headingId(line.slice(5), index)} key={index}>{renderInline(line.slice(5))}</h4>);
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
  const [loadError, setLoadError] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeHeading, setActiveHeading] = useState("");
  const readerRef = useRef<HTMLDivElement>(null);
  const resolvedSource = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${source}`;
  const headings = useMemo(() => getHeadings(markdown), [markdown]);

  useEffect(() => {
    if (kind !== "markdown") return;
    const controller = new AbortController();
    fetch(resolvedSource, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Article request failed: ${response.status}`);
        return response.text();
      })
      .then(setMarkdown)
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(true);
      });
    return () => controller.abort();
  }, [kind, resolvedSource]);

  const updateReadingState = (event: UIEvent<HTMLDivElement>) => {
    const reader = event.currentTarget;
    const available = reader.scrollHeight - reader.clientHeight;
    setProgress(available > 0 ? Math.min(1, reader.scrollTop / available) : 0);

    const visibleHeadings = [...reader.querySelectorAll<HTMLElement>(".markdown-body h2, .markdown-body h3")];
    const current = visibleHeadings.reduce<HTMLElement | null>((result, heading) => {
      return heading.offsetTop - reader.scrollTop <= 150 ? heading : result;
    }, null);
    setActiveHeading(current?.id || "");
  };

  if (kind === "pdf") {
    return <div className="pdf-viewport">
      <iframe
        className="pdf-frame pdf-frame--page"
        src={`${resolvedSource}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
        title={title}
      />
    </div>;
  }

  if (loadError) {
    return <div className="article-load-state" role="alert">
      <strong>文章加载失败</strong>
      <button type="button" onClick={() => window.location.reload()}>重新加载</button>
    </div>;
  }

  if (!markdown) {
    return <div className="article-load-state" role="status">正在加载文章…</div>;
  }

  return <div className="markdown-reader" ref={readerRef} onScroll={updateReadingState}>
    <div className="reading-progress" aria-hidden="true">
      <i style={{ transform: `scaleX(${progress})` }} />
    </div>
    <div className={`markdown-layout${headings.length ? " has-toc" : ""}`}>
      {headings.length > 0 && <details className="article-toc-mobile">
        <summary>文章目录 <span>{String(headings.length).padStart(2, "0")}</span></summary>
        <nav aria-label="文章目录">
          {headings.map(heading => <a
            className={heading.level === 3 ? "is-subheading" : ""}
            href={`#${heading.id}`}
            key={`mobile-${heading.id}`}
          >{heading.label}</a>)}
        </nav>
      </details>}
      {headings.length > 0 && <aside className="article-toc" aria-label="文章目录">
        <span>ON THIS PAGE</span>
        <nav>
          {headings.map(heading => <a
            className={`${heading.level === 3 ? "is-subheading " : ""}${activeHeading === heading.id ? "is-active" : ""}`}
            href={`#${heading.id}`}
            key={heading.id}
          >{heading.label}</a>)}
        </nav>
      </aside>}
      <MarkdownBody source={markdown} />
    </div>
  </div>;
}
