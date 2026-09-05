import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'MadAboutSoftware — Great products. Serious play.', description: 'Independent mobile games and sharp product thinking. Explore Skippers, Lorebound, and the mind behind MadAboutSoftware.' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
