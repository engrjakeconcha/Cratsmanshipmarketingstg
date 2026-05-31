import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Craftsmanship Marketing Dashboard",
  description:
    "Lead, appointment, and ad spend performance dashboard for Craftsmanship Marketing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
