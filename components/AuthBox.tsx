'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function AuthBox({ onLoggedIn }: { onLoggedIn?: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendMagic(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email || !email.includes('@')) { setErr('Geçerli bir e-posta gir.'); return; }
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOtp({ email, options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/`
      }});
      if (error) throw error;
      setSent(true);
    } catch (e:any) {
      setErr(e.message ?? 'Gönderilemedi');
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    onLoggedIn?.();
  }

  return (
    <div className="card" id="auth">
      <h3 style={{margin:'6px 0 12px'}}>Giriş / Kayıt</h3>
      {!sent ? (
        <form onSubmit={sendMagic} style={{display:'grid',gap:12}}>
          <input className="input" type="email" placeholder="E-posta"
                 value={email} onChange={e=>setEmail(e.target.value)} />
          <button className="button primary" disabled={loading}>
            {loading ? 'Gönderiliyor…' : 'Magic Link Gönder'}
          </button>
          {err && <div className="p" style={{color:'#f99'}}>{err}</div>}
          <div className="p">E-postandaki bağlantıyla giriş yapacaksın.</div>
        </form>
      ) : (
        <div className="p">E-postanı kontrol et. Bağlantıya tıklayınca giriş yapılır.</div>
      )}
      <button className="button" style={{marginTop:10}} onClick={signOut}>Çıkış Yap</button>
    </div>
  );
}
