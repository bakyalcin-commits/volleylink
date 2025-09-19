'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Gender, Position } from '@/types/db';
import AuthBox from './AuthBox';

type Props = { onUploaded?: () => void };

export default function UploadForm({ onUploaded }: Props) {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [position, setPosition] = useState<Position | ''>('');
  const [birthDate, setBirthDate] = useState('');
  const [heightCm, setHeightCm] = useState<number | ''>('');
  const [weightKg, setWeightKg] = useState<number | ''>('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [school, setSchool] = useState('');
  const [club, setClub] = useState('');

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Giriş kontrolü
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) setSessionUserId(data.session?.user?.id ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSessionUserId(s?.user?.id ?? null);
    });
    return () => { sub.subscription.unsubscribe(); mounted = false; };
  }, []);

  // Zorunlu alanlar
  const isValid = useMemo(() => {
    return !!(file && fullName.trim() && gender && position && birthDate && city.trim() && country.trim());
  }, [file, fullName, gender, position, birthDate, city, country]);

  async function ensureProfile(userId: string) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    const payload = {
      id: userId,
      full_name: fullName || null,
      gender: (gender || null) as any,
      position: (position || null) as any,
      birth_date: birthDate || null,
      height_cm: heightCm === '' ? null : Number(heightCm),
      weight_kg: weightKg === '' ? null : Number(weightKg),
      city: city || null,
      country: country || null,
      school: school || null,
      club: club || null
    };

    if (!existing) {
      await supabase.from('profiles').insert(payload);
    } else {
      await supabase.from('profiles').update(payload).eq('id', userId);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!sessionUserId) { setErr('Yükleme için önce giriş yap.'); return; }
    if (!isValid) { setErr('Zorunlu alanları doldur.'); return; }

    try {
      setLoading(true);
      setStatus('Yükleniyor…');

      await ensureProfile(sessionUserId);

      // boyut sınırı (örn. 200MB)
      const maxBytes = 200 * 1024 * 1024;
      if ((file?.size ?? 0) > maxBytes) throw new Error('Dosya 200MB sınırını aşıyor.');

      const ext = (file!.name.split('.').pop() || 'mp4').toLowerCase();
      const path = `${sessionUserId}/${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('videos')
        .upload(path, file!, { contentType: file!.type || 'video/mp4', upsert: false });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('videos').getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const age = birthDate ? Math.max(0, Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25*24*3600*1000))) : null;

      const { error: insErr } = await supabase.from('videos').insert({
        user_id: sessionUserId,
        title: `${fullName} – Highlights`,
        storage_path: path,
        public_url: publicUrl,
        thumbnail_url: null,
        position,
        gender,
        city,
        country,
        age,
        full_name: fullName
      });
      if (insErr) throw insErr;

      setStatus('Yüklendi.');
      setFile(null);
      onUploaded?.();
    } catch (e:any) {
      console.error(e);
      setErr(e.message ?? 'Yükleme başarısız');
    } finally {
      setLoading(false);
    }
  }

  if (!sessionUserId) {
    return (
      <>
        <div className="p" style={{marginBottom:8}}>
          <strong>Not:</strong> Video yüklemek için önce giriş yap.
        </div>
        <AuthBox onLoggedIn={() => { /* sayfada kal */ }} />
      </>
    );
  }

  return (
    <form onSubmit={handleUpload} style={{display:'grid',gap:12}}>
      <div className="row">
        <input className="input" placeholder="Ad Soyad *" value={fullName} onChange={e=>setFullName(e.target.value)} />
        <select className="input" value={gender} onChange={e=>setGender(e.target.value as any)}>
          <option value="">Cinsiyet *</option>
          <option value="male">Erkek</option>
          <option value="female">Kadın</option>
        </select>
      </div>

      <div className="row">
        <select className="input" value={position} onChange={e=>setPosition(e.target.value as any)}>
          <option value="">Pozisyon *</option>
          <option>PG</option><option>SG</option><option>SF</option><option>PF</option><option>C</option>
        </select>
        <input className="input" type="date" value={birthDate} onChange={e=>setBirthDate(e.target.value)} />
      </div>

      <div className="row">
        <input className="input" placeholder="Şehir *" value={city} onChange={e=>setCity(e.target.value)} />
        <input className="input" placeholder="Ülke *" value={country} onChange={e=>setCountry(e.target.value)} />
      </div>

      <div className="row">
        <input className="input" type="number" placeholder="Boy (cm)" value={heightCm as any} onChange={e=>setHeightCm(e.target.value ? Number(e.target.value) : '')} />
        <input className="input" type="number" placeholder="Kilo (kg)" value={weightKg as any} onChange={e=>setWeightKg(e.target.value ? Number(e.target.value) : '')} />
      </div>

      <div>
        <input className="input" type="file" accept="video/*" onChange={(e)=>setFile(e.target.files?.[0] ?? null)} />
        <div className="p" style={{marginTop:6}}>Destek: MP4/MOV/WEBM • Maks 200MB</div>
      </div>

      <button className="button primary" disabled={!isValid || loading}>
        {loading ? 'Yükleniyor…' : 'Videoyu Yükle'}
      </button>

      {err && <div className="p" style={{color:'#f99'}}>{err}</div>}
      {status && <div className="p">{status}</div>}
    </form>
  );
}
