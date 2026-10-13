import type { Metadata } from 'next';
import '@repo/ui/styles.css';
export const metadata: Metadata = {
  title: 'Studio · Brendan Eggers',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
