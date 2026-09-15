"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function getCurrentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("storage", callback);
  return () => {
    observer.disconnect();
    window.removeEventListener("storage", callback);
  };
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem("zxm-theme", theme);
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getCurrentTheme, () => "light");

  return <button
    className="theme-toggle"
    type="button"
    onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}
    suppressHydrationWarning
    aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
    title={theme === "dark" ? "浅色主题" : "深色主题"}
  >
    <svg className="theme-icon theme-icon--sun" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </svg>
    <svg className="theme-icon theme-icon--moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z" />
    </svg>
  </button>;
}
