import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PanelPrep · 研究数据整理",
  description: "检查合并关系、追踪样本变化，导出可复现的研究数据。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
