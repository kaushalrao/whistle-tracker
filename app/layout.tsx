import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cooker Companion | Pressure Cooker Whistle Counter",
  description: "The elegant, AI-powered kitchen companion that tracks your cooker whistles so you don't have to.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js" defer></script>
        <script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/speech-commands@latest/dist/speech-commands.min.js" defer></script>
        {children}
      </body>
    </html>
  );
}
