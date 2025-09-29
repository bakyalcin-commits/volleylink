'use client';

import { useState } from 'react';
import UploadForm from '@/components/UploadForm';
import DiscoverGrid from '@/components/DiscoverGrid';

export default function Page() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <section className="hero">
        <div>
          <h1 className="h1">
            Oyununla kendini göster. <span>Keşfedil.</span>
          </h1>
          <p className="p">
            Voleybol CV’n: Video + istatistik + pozisyon. Kulüpler ve federasyonlar seni buradan bulsun.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
            <a className="button primary" href="#upload">Profilini Oluştur</a>
            <a className="button" href="#discover">Son Yüklenen Videoları Gör</a>
          </div>
        </div>

        {/* Sağ panel: basit arama mockup (voleybol) */}
        <div className="card">
          <div className="row">
            <input className="input" placeholder="Ad / Şehir" />
            <select className="input" defaultValue="">
              <option value="">Pozisyon</option>
              <option value="S">Pasör (S)</option>
              <option value="OPP">Pasör Çaprazı (OPP)</option>
              <option value="OH">Smaçör (OH)</option>
              <option value="MB">Orta Oyuncu (MB)</option>
              <option value="L">Libero (L)</option>
              <option value="DS">Defans Uzmanı (DS)</option>
            </select>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <select className="input" defaultValue="">
              <option value="">Cinsiyet</option>
              <option value="male">Erkek</option>
              <option value="female">Kadın</option>
            </select>
            <select className="input" defaultValue="">
              <option value="">Ülke</option>
              <option value="TR">Türkiye</option>
              <option value="US">ABD</option>
              <option value="DE">Almanya</option>
            </select>
          </div>
          <button className="button" style={{ marginTop: 12, width: '100%' }}>
            İleri Arama
          </button>
        </div>
      </section>

      <section id="upload" className="card" style={{ marginTop: 16 }}>
        <h3 style={{ margin: '6px 0 12px' }}>İlk videonu yükle</h3>
        <UploadForm onUploaded={() => setRefreshKey((k) => k + 1)} />
      </section>

      <section id="discover" style={{ marginTop: 22 }}>
        <h3 style={{ margin: '6px 0 12px' }}>Son Yüklenenler</h3>
        <DiscoverGrid refreshKey={refreshKey} />
      </section>
    </>
  );
}
