"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

export default function Home() {
  const [typed, setTyped] = useState("");
  const [phrase, setPhrase] = useState(0);

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
  const monthLabels = dates
    .filter((date, index) => index === 0 || date.slice(5, 7) !== dates[index - 1].slice(5, 7))
    .map(date => ({ label: `${Number(date.slice(5, 7))}月`, week: Math.floor((leadingEmpty + dates.indexOf(date)) / 7) }));
  const updateTotal = siteUpdates.reduce((sum, item) => sum + item.count, 0);

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
          <div><strong>{String(updateTotal).padStart(2, "0")}</strong><span>篇记录<br />过去 365 天</span></div>
          <p>没写就不亮。这张表很诚实，不装连续打卡。</p>
          <span className="heat-legend">少{[0, 1, 2, 3, 4].map(level => <i key={level} className={`level-${level}`} />)}多</span>
        </header>
        <div className="heatmap-stage">
          <div className="contribution-board">
            <div className="weekday-labels" aria-hidden="true"><span /><span /><span>一</span><span /><span>三</span><span /><span>五</span><span /></div>
            <div className="contribution-grid-wrap">
              <div className="month-labels" aria-hidden="true">
                {monthLabels.map(month => <span key={`${month.label}-${month.week}`} style={{ gridColumn: month.week + 1 }}>{month.label}</span>)}
              </div>
              <div className="heatmap">
                {calendarCells.map((date, index) => {
                  if (!date) return <i key={`empty-${index}`} className="heat-empty" />;
                  const value = updateMap[date] || 0;
                  const level = value >= 4 ? 4 : value;
                  const notes = siteUpdates.filter(item => item.date === date).map(item => item.label);
                  return <i key={date} className={`level-${level}`} title={`${date}: ${notes.join(" / ") || "无更新"}`} />;
                })}
              </div>
            </div>
          </div>
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
