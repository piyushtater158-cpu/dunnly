import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dunnly — AR Pipeline",
  description: "AR collections copilot — overdue invoice pipeline dashboard.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
      <body
        style={{
          fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
        }}
      >
        {children}
      </body>
    </html>
  );
}
