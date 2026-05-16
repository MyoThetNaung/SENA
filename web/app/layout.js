import './globals.css';

export const metadata = {
  title: 'SENA',
  description: 'Smart Engine for Notes & Action',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
