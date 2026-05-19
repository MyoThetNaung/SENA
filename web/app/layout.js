import './globals.css';
import { SenaChrome } from '@/components/sena-chrome';

export const metadata = {
  title: 'SENA',
  description: 'Smart Engine for Notes & Action',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning on <head> silences benign attribute injections from browser
          extensions (e.g. LocatorJS adding `data-locator-hook-status-message`). */}
      <head suppressHydrationWarning>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Audiowide&family=Open+Sans:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body suppressHydrationWarning>
        <SenaChrome />
        {children}
      </body>
    </html>
  );
}
