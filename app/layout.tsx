import type { Metadata } from 'next';
import './globals.css';

// Theme is applied before paint to avoid a flash: dark unless the user chose light.
const themeInit = `(function(){try{var t=localStorage.getItem('foss-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export const metadata: Metadata = { title: 'FOSS-PCB', description: 'Open text-to-PCB designer' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
