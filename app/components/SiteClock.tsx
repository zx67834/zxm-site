"use client";

import { useEffect, useState } from "react";

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
    <div className="clock-status"><i /> SYSTEM TIME / ONLINE</div>
    <div className="clock-digits" aria-label={time}>
      <span data-unit="HOUR">{hours}</span>
      <b>:</b>
      <span data-unit="MIN">{minutes}</span>
      <b>:</b>
      <span className="clock-seconds" data-unit="SEC">{seconds}</span>
    </div>
    <div className="clock-meta">
      <span>{now ? dateFormatter.format(now) : "正在同步时间"}</span>
      <span>UTC +08:00</span>
    </div>
  </div>;
}
