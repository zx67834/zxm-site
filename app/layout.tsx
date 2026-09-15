import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "zxm 的小站",
  description: "文章、笔记与小小的网络角落。",
  icons: {
    icon: [{ url: "/favicon-zxm.svg", type: "image/svg+xml" }],
  },
};
const themeScript = `(function(){try{var saved=localStorage.getItem('zxm-theme');var theme=saved==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch(e){document.documentElement.dataset.theme='light';document.documentElement.style.colorScheme='light'}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
    <body>{children}</body>
  </html>;
}
