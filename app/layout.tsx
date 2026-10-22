import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "流光片场 · Seedance AI 视频创作",
  description:
    "用 Seedance 2.5 把一句想象变成电影感 AI 视频。支持首帧、原生声音和多种画幅。",
  applicationName: "流光片场",
  openGraph: {
    title: "流光片场 · Seedance AI 视频创作",
    description: "让脑海里的画面，开始流动。",
    type: "website"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d0a"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
