import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "zxm 的小站", description: "文章、笔记与小小的网络角落。" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN"><body>{children}</body></html>; }
