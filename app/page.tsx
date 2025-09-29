'use client';

import { useEffect, useState } from 'react';
import UploadForm from '@/components/UploadForm';
import DiscoverGrid from '@/components/DiscoverGrid';
import AuthBox from '@/components/AuthBox';
import { supabase } from '@/lib/supabaseClient';
import type { Position } from '@/types/db';
import { POSITIONS } from '@/lib/positions';

export default function HomePage() {
  const [refreshKey, setRefreshKey] = useState(0);

  // arama (mock)
  const [position, setPosition] = useState<Position | ''>('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');

  // ► GİRİŞ KONTROLÜ
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) setUserId(data.session?.user?.id ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setUserId(s?.user?.id ?? null);
    });
    return () => { sub.subscription.unsubscribe(); mounted = false; };
  }, []);

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
          <div style={{display:'flex',gap:12,marginTop:18}}>
            <a className="button primary" href="#upload">Profilini Oluştur</a>
            <a className="button" href="#discover">Son Yüklenen Videoları Gör</a>
          </div>
        </div>

        {/* Sağ panel: arama mockup */}
        <div className="card">
          <div className="row">
            <input className="input" placeholder="Ad / Şehir" />
            <select
              className="input"
              value={position}
              onChange={(e)=>setPosition(e.target.value as Position | '')}
            >
              <option value="">Pozisyon</option>
              {POSITIONS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="row" style={{marginTop:10}}>
            <select
              className="input"
              value={gender}
              onChange={(e)=>setGender(e.target.value as 'male' | 'female' | '')}
            >
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

          <button className="button" style={{marginTop:12,width:'100%'}}>İleri Arama</button>
        </div>
      </section>

      <section id="upload" className="card" style={{marginTop:16}}>
        <h3 style={{margin:'6px 0 12px'}}>İlk videonu yükle</h3>

        {/* ► GİRİŞ YOKSA: AuthBox göster, formu kapat */}
        {!userId ? (
          <>
            <div className="p" style={{marginBottom:8}}>
              Videonu yüklemek ve profil oluşturmak için lütfen giriş yap.
            </div>
            <AuthBox onLoggedIn={() => setRefreshKey(k => k + 1)} />
          </>
        ) : (
          <UploadForm onUploaded={() => setRefreshKey(k => k + 1)} />
        )}
      </section>

      <section id="discover" style={{marginTop:22}}>
        <h3 style={{margin:'6px 0 12px'}}>Son Yüklenenler</h3>
        <DiscoverGrid refreshKey={refreshKey} />
      </section>
    </>
  );
}
