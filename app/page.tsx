"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import NodeField from "./components/NodeField";
import SiteClock from "./components/SiteClock";
import SiteLogo from "./components/SiteLogo";
import ThemeToggle from "./components/ThemeToggle";
import { articles, getArticleHref } from "./data/articles";
import { siteUpdates } from "./data/site-updates";

const phrases = [
  "Creating cool things on the web.",
  "个人博客 · 文章 · 实验",
  "Code · Design · Write.",
];

const heatCategoryClass: Record<string, string> = {
  "渗透测试": "heat-category-pentest",
  HackMyVM: "heat-category-hackmyvm",
  "春秋": "heat-category-spring",
  "生活": "heat-category-life",
  "文章": "heat-category-article",
};

export default function Home() {
  const [typed, setTyped] = useState("");
  const [phrase, setPhrase] = useState(0);
  const heatmapBoardRef = useRef<HTMLDivElement>(null);

  const dates = useMemo(() => Array.from({ length: 365 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - 364 + index);
    return day.toISOString().slice(0, 10);
  }), []);

  const updateMap = useMemo(() => siteUpdates.reduce<Record<string, number>>((result, item) => {
    result[item.date] = (result[item.date] || 0) + item.count;
    return result;
  }, {}), []);
  const leadingEmpty = new Date(`${dates[0]}T00:00:00`).getDay();
  const calendarCells: (string | null)[] = [...Array.from({ length: leadingEmpty }, () => null), ...dates];
  const updateTotal = siteUpdates.reduce((sum, item) => sum + item.count, 0);
  const activeDayCount = dates.reduce((sum, date) => sum + (updateMap[date] ? 1 : 0), 0);
  const rangeLabel = `${dates[0].slice(0, 7).replace("-", ".")} — ${dates[dates.length - 1].slice(0, 7).replace("-", ".")}`;
  const latestUpdate = siteUpdates.reduce((latest, item) => item.date > latest ? item.date : latest, "").replaceAll("-", ".");

  useEffect(() => {
    let index = 0;
    const text = phrases[phrase];
    const timer = window.setInterval(() => {
      index += 1;
      setTyped(text.slice(0, index));
      if (index >= text.length) {
        window.clearInterval(timer);
        window.setTimeout(() => setPhrase(value => (value + 1) % phrases.length), 1900);
      }
    }, 65);
    return () => window.clearInterval(timer);
  }, [phrase]);

  useEffect(() => {
    const board = heatmapBoardRef.current;
    if (!board || !window.matchMedia("(max-width: 720px)").matches) return;
    const frame = window.requestAnimationFrame(() => {
      board.scrollLeft = board.scrollWidth;
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return <main className="preview">
    <section className="preview-stage" id="top">
      <NodeField />
      <div className="stage-fade" />
      <nav className="preview-nav preview-container preview-container--wide">
        <SiteLogo />
        <div>
          <Link href="/articles">文章</Link>
          <Link href="/terminal">终端</Link>
          <ThemeToggle />
        </div>
      </nav>
      <div className="preview-hero preview-container preview-container--narrow">
        <p className="preview-eyebrow">PERSONAL SITE · BLOG · LAB</p>
        <h1>{"zxm的小站".split("").map((character, index) => (
          <span key={index} style={{ animationDelay: `${index * .08 + .15}s` }}>{character}</span>
        ))}</h1>
        <p className="preview-subtitle">{typed}<i>|</i></p>
        <div className="scroll-hint"><span>scroll</span><i /></div>
      </div>
    </section>

    <div className="preview-marquee">
      <div><span>CREATING · DESIGNING · CODING · WRITING · BUILDING · </span><span>CREATING · DESIGNING · CODING · WRITING · BUILDING · </span></div>
    </div>

    <section className="preview-section preview-container" id="about">
      <h2 className="section-label">01 / ABOUT</h2>
      <div className="glass about-card">
        <div className="about-avatar"><img src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/avatar-zxm.png`} alt="zxm" /></div>
        <div>
          <p>Hello, this is <strong>zxm</strong>&apos;s blog — where I Ctrl+Z my life.</p>
          <div className="tags"><span>Frontend</span><span>Security</span><span>Blog</span><span>Notes</span></div>
        </div>
      </div>
    </section>

    <section className="preview-section preview-container" id="activity">
      <div className="section-heading"><h2 className="section-label">02 / WRITING LOG</h2><span className="section-note">文章与复盘的记录</span></div>
      <div className="writing-panel">
        <header className="writing-summary">
          <span className="writing-kicker">YEAR IN WRITING · 365 DAYS</span>
          <h3>把写过的，留在时间里。</h3>
          <p><strong>{updateTotal}</strong> 篇记录，散落在 <strong>{activeDayCount}</strong> 个创作日里。</p>
        </header>
        <div className="heatmap-stage">
          <p className="sr-only">过去 365 天共记录 {updateTotal} 次文章更新。</p>
          <div className="heatmap-range" aria-hidden="true">
            <span>{rangeLabel}</span>
            <span>ONE SQUARE · ONE DAY</span>
          </div>
          <div className="contribution-board" ref={heatmapBoardRef}>
            <div className="contribution-grid-wrap">
              <div className="heatmap" aria-hidden="true">
                {calendarCells.map((date, index) => {
                  if (!date) return <i key={`empty-${index}`} className="heat-empty" />;
                  const value = updateMap[date] || 0;
                  const level = value >= 4 ? 4 : value;
                  const updates = siteUpdates.filter(item => item.date === date);
                  const notes = updates.map(item => item.label);
                  const categories = [...new Set(updates.map(item => item.type))];
                  const categoryClass = categories.length > 1 ? "heat-category-mixed" : heatCategoryClass[categories[0]] || "";
                  const today = date === dates[dates.length - 1] ? " is-today" : "";
                  return <i key={date} className={`level-${level} ${categoryClass}${today}`} title={`${date}: ${notes.join(" / ") || "无更新"}`} />;
                })}
              </div>
            </div>
          </div>
          <div className="heatmap-meta" aria-hidden="true">
            <div className="heatmap-categories">
              <span><i className="heat-category-pentest" />渗透测试</span>
              <span><i className="heat-category-hackmyvm" />HackMyVM</span>
              <span><i className="heat-category-spring" />春秋</span>
              <span><i className="heat-category-life" />生活</span>
              <span><i className="heat-category-article" />文章</span>
            </div>
            <span className="heatmap-latest"><i />最近更新 {latestUpdate}</span>
          </div>
          <span className="heatmap-scroll-hint" aria-hidden="true">左右滑动查看全年 <i>↔</i></span>
        </div>
        <div className="writing-recent-head"><span>RECENT ACTIVITY</span><Link href="/articles">查看全部文章<i className="writing-arrow" aria-hidden="true" /></Link></div>
        <ol className="writing-recent">
          {articles.slice(0, 4).map(article => <li key={article.slug}>
            <Link href={getArticleHref(article)}>
              <time>{article.publishedAt}</time><span>{article.category}</span><strong>{article.title}</strong>
            </Link>
          </li>)}
        </ol>
      </div>
    </section>

    <section className="preview-section preview-container" id="explore">
      <div className="section-heading">
        <h2 className="section-label">03 / EXPLORE</h2>
        <span className="section-note">找文章，或者去终端晃一圈</span>
      </div>
      <div className="explore-panel">
        <div className="explore-panel-label"><span>INDEX</span><strong>分类是目录；终端是另一扇可以敲的门。</strong></div>
        <div className="explore-rows">
          <Link className="explore-row" href="/articles/archive">
            <span className="explore-index">01</span>
            <span className="explore-meta">TAXONOMY / ARCHIVE</span>
            <h3>分类和归档</h3>
            <small>生活 / HackMyVM / 春秋 / 渗透测试</small>
            <b aria-hidden="true">↗</b>
          </Link>
          <Link className="explore-row explore-row--terminal" href="/terminal">
            <span className="explore-index">02</span>
            <span className="explore-meta">PLAY / SHELL</span>
            <h3>终端</h3>
            <small>help / whoami / ls -a</small>
            <b aria-hidden="true">↗</b>
          </Link>
        </div>
      </div>
    </section>

    <section className="preview-section preview-container" id="local-time">
      <h2 className="section-label">04 / 本地时间</h2>
      <SiteClock />
    </section>

    <footer className="preview-footer">zxm的小站 · Static and quietly alive.</footer>
  </main>;
}
