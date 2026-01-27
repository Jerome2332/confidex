import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { Providers } from '@/components/providers';

const inter = Inter({ subsets: ['latin'] });

const iosevka = localFont({
  src: [
    {
      path: '../../public/fonts/Iosevka-Term-Slab-Light.ttf',
      weight: '300',
      style: 'normal',
    },
    {
      path: '../../public/fonts/Iosevka-Term-Slab.ttf',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../public/fonts/Iosevka-Term-Slab-Medium.ttf',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../public/fonts/Iosevka-Term-Slab-Bold.ttf',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-iosevka',
  display: 'swap',
});

const tektur = localFont({
  src: '../../public/fonts/Tektur-VariableFont_wdth,wght.ttf',
  variable: '--font-tektur',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Confidex - Confidential DEX',
  description: 'Privacy-preserving decentralized exchange on Solana',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Inline script to prevent flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('confidex-theme');
                  if (stored) {
                    var parsed = JSON.parse(stored);
                    var theme = parsed.state?.theme || 'dark';
                    if (theme === 'system') {
                      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                    }
                    if (theme === 'light') {
                      document.documentElement.classList.remove('dark');
                    }
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={`${inter.className} ${iosevka.variable} ${tektur.variable}`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
