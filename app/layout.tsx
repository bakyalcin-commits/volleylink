import './globals.css';
import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'VolleyLink',
  description: 'Voleybol Yetenek Ağı'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <div className="container">
          <nav>
            <Link href="/" aria-label="VolleyLink anasayfa"
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Image
                src="/volleylink.png"
                alt="VolleyLink"
                width={200}   // gerekirse 140–180 arası oynat
                height={40}
                priority
                style={{ height: '120px', width: 'auto' }}
              />
            </Link>

            <div className="right">
              <a href="#discover">Keşfet</a>
              <a href="#how">Nasıl Çalışır?</a>
              <a href="#verify">Doğrulama</a>
              <a className="button" href="#auth">Giriş / Kayıt</a>
            </div>
          </nav>

          {children}

          <footer>© VolleyLink — Beta</footer>
        </div>
      </body>
    </html>
  );
}
