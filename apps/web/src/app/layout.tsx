import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider } from '@/lib/theme-context';
import { NotificationProvider } from '@/lib/notification-context';
import { ToastProvider } from '@/lib/toast';
import { APP_DESCRIPTION, APP_NAME } from '@/lib/brand';
import './globals.css';

export const metadata: Metadata = {
  title: `${APP_NAME} — Social Media Automation`,
  description: APP_DESCRIPTION,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#08101f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <NotificationProvider>
              <ToastProvider>{children}</ToastProvider>
            </NotificationProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
