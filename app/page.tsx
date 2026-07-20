"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import NodeField from "./components/NodeField";
import SiteClock from "./components/SiteClock";
import SiteLogo from "./components/SiteLogo";
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
  const calendarCells: (string | null)[] = [
    ...Array.from({ length: leadingEmpty }, () => null),
    ...dates,
  ];
  const monthLabels = dates
    .filter((date, index) => index === 0 || date.slice(5, 7) !== dates[index - 1].slice(5, 7))
    .map(date => ({
      label: `${Number(date.slice(5, 7))}月`,
      week: Math.floor((leadingEmpty + dates.indexOf(date)) / 7),
    }));
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
          <a href="#about">About</a>
          <Link href="/articles">Articles</Link>
          <Link href="/terminal">Terminal</Link>
          <a href="#activity">Updates</a>
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
      <div>
        <span>CREATING · DESIGNING · CODING · WRITING · BUILDING · </span>
        <span>CREATING · DESIGNING · CODING · WRITING · BUILDING · </span>
      </div>
    </div>

    <section className="preview-section preview-container" id="about">
      <h2 className="section-label">01 / ABOUT</h2>
      <div className="glass about-card">
        <button className="about-avatar" aria-label="zxm 头像">
          <img src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/avatar-zxm.png`} alt="zxm" />
        </button>
        <div>
          <p>Hello, this is <strong>zxm</strong>&apos;s blog — where I Ctrl+Z my life.</p>
          <div className="tags"><span>Frontend</span><span>Security</span><span>Blog</span><span>Notes</span></div>
        </div>
      </div>
    </section>

    <section className="preview-section preview-container" id="explore">
      <div className="section-heading">
        <h2 className="section-label">02 / EXPLORE</h2>
        <span className="section-note">两个入口，各自成页</span>
      </div>
      <div className="portal-grid">
        <Link href="/articles" className="portal-card">
          <span className="portal-number">01</span>
          <span className="portal-kicker">READ / MARKDOWN</span>
          <h3>文章与笔记</h3>
          <b>进入文章页 ↗</b>
        </Link>
        <Link href="/terminal" className="portal-card portal-card--terminal">
          <span className="portal-number">02</span>
          <span className="portal-kicker">PLAY / SHELL</span>
          <h3>伪终端实验室</h3>
          <b>打开终端 ↗</b>
        </Link>
      </div>
    </section>

    <section className="preview-section preview-container">
      <div className="section-heading">
        <h2 className="section-label">03 / LOCAL TIME</h2>
        <span className="section-note">Asia / Shanghai</span>
      </div>
      <SiteClock />
    </section>

    <section className="preview-section preview-container" id="activity">
      <div className="section-heading">
        <h2 className="section-label">04 / WRITING LOG</h2>
        <span className="section-note">文章与复盘的记录</span>
      </div>
      <div className="glass contribution">
        <p className="contribution-total">{updateTotal} writing record in the last year</p>
        <div className="contribution-board">
          <div className="weekday-labels" aria-hidden="true">
            <span /><span /><span>一</span><span /><span>三</span><span /><span>五</span><span />
          </div>
          <div className="contribution-grid-wrap">
            <div className="month-labels" aria-hidden="true">
              {monthLabels.map(month => (
                <span key={`${month.label}-${month.week}`} style={{ gridColumn: month.week + 1 }}>
                  {month.label}
                </span>
              ))}
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
        <div className="contribution-foot">
          <span>只记录真实发布的文章与复盘，不做装饰性填充</span>
          <span className="heat-legend">
            少
            {[0, 1, 2, 3, 4].map(level => <i key={level} className={`level-${level}`} />)}
            多
          </span>
        </div>
        <ol className="update-list">
          {siteUpdates.slice(0, 3).map(item => (
            <li key={`${item.date}-${item.label}`}>
              <time>{item.date}</time>
              <span><b>{item.type}</b>{item.label}<small>{item.summary}</small></span>
            </li>
          ))}
        </ol>
      </div>
    </section>

    <footer className="preview-footer">zxm的小站 · Static and quietly alive.</footer>
  </main>;
}
