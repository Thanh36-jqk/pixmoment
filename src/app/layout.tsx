import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Pixmoment — Chia sẻ ảnh chất lượng gốc",
  description: "Gửi ảnh cho nhau không mất một pixel nào. Chất lượng gốc 100%.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pixmoment",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom is left enabled (no maximumScale/userScalable) — blocking it broke
  // pinch-zoom for everyone to work around iOS auto-zooming into inputs
  // under 16px font-size. Fixed at the source instead: every input on the
  // site is text-base (16px)+, which is exactly the threshold iOS uses to
  // decide whether to zoom in on focus.
  viewportFit: "cover",   // full-screen kể cả notch
  themeColor: "#0a0a0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className={`${inter.className} bg-[#0a0a0f] text-white antialiased`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
