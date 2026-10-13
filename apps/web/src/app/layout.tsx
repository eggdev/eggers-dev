import type { Metadata } from 'next';
import '@repo/ui/styles.css';
import './styles.css';
export const metadata: Metadata = {
  title: 'Brendan Eggers',
  description: 'A new portfolio is taking shape. Get in touch with Brendan Eggers.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
