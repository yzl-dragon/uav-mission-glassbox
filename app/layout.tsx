import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UAV Mission Glassbox｜无人机任务链可视化",
  description: "面向物资配送、搜索救援和农田喷洒的无人机任务、状态、能源与安全约束仿真雏形。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
