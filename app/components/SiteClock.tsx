"use client";

import { useEffect, useState } from "react";

function FlipUnit({ value, unit, modulo, accent = false }: { value: string; unit: string; modulo: number; accent?: boolean }) {
  const numericValue = Number(value);
  const previous = Number.isFinite(numericValue)
    ? String((numericValue - 1 + modulo) % modulo).padStart(2, "0")
    : value;

  return <span className={`flip-unit${accent ? " clock-seconds" : ""}`} aria-hidden="true">
    <span className="flip-static flip-static-top"><span>{previous}</span></span>
    <span className="flip-static flip-static-bottom"><span>{value}</span></span>
    {value !== "--" && <span className="flip-moving" key={value}>
      <span className="flip-face flip-face-front"><span>{previous}</span></span>
      <span className="flip-face flip-face-back"><span>{value}</span></span>
    </span>}
    <small>{unit}</small>
  </span>;
}

const formatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

export default function SiteClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const time = now ? formatter.format(now) : "--:--:--";
  const [hours = "--", minutes = "--", seconds = "--"] = time.split(":");

  return <div className="site-clock glass" aria-live="off">
    <div className="clock-status"><i /> 北京时间 / 实时</div>
    <div className="clock-digits" aria-label={time}>
      <FlipUnit value={hours} unit="时" modulo={24} />
      <b>:</b>
      <FlipUnit value={minutes} unit="分" modulo={60} />
      <b>:</b>
      <FlipUnit value={seconds} unit="秒" modulo={60} accent />
    </div>
    <div className="clock-meta">
      <span>{now ? dateFormatter.format(now) : "正在同步时间"}</span>
      <span>UTC +08:00</span>
    </div>
  </div>;
}
