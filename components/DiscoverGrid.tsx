'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { VideoRow, Position } from '@/types/db';
import AnalyzeInline from '@/components/AnalyzeInline';

// Kod -> Etiket eşlemesi (tek kaynak)
const POSITION_LABELS: Record<Position, string> = {
  S:   'Pasör (S)',
  OPP: 'Pasör Çaprazı (OPP)',
  OH:  'Smaçör (OH)',
  MB:  'Orta Oyuncu (MB)',
  L:   'Libero (L)',
  DS:  'Defans Uzmanı (DS)',
};

// Row tipini genişlettik
type Row = (VideoRow & { club?: string }) & {
  like_count?: number;
  my_like?: boolean;
  comments?: { id:number; user_id:string|null; content:string; created_at:string }[];
  playable_url?: string; // signed/public kaynak
};

// Cache-bypass paramını doğru şekilde eklemek için helper
function withBypass(u: string | null | undefined, createdAt?: string | null) {
  if (!u) return '';
  const sep = u.includes('?') ? '&' : '?';
  const t = encodeURIComponent(createdAt ?? '');
  return `${u}${sep}t=${t}`;
}

export default function DiscoverGrid({ refreshKey }: { refreshKey?: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      if (alive.current) setMyId(uid);

      if (uid) {
        const { data: adminHit } = await supabase
          .from('admins')
          .select('user_id')
          .eq('user_id', uid)
          .maybeSingle();
        if (alive.current) setIsAdmin(!!adminHit);
      } else {
        if (alive.current) setIsAdmin(false);
      }
    })();
    return () => { alive.current = false; };
  }, []);

  async function load() {
    if (!alive.current) return;
    setLoading(true);

    // 1) DB'den son videoları al
    const { data: vids, error } = await supabase
      .from('videos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(24);

    if (error) {
      console.error(error);
      if (alive.current) { setRows([] as any); setLoading(false); }
      return;
    }

    // 1.5) Voleybol pozisyonları dışında kalanları ve path'i olmayanları çıkar
    const validSet = new Set<Position>(['S','OPP','OH','MB','L','DS']);
    const sanitized = (vids ?? []).filter(v => {
      const posOk = v.position ? validSet.has(v.position as Position) : true;
      const hasPath = !!v.storage_path && typeof v.storage_path === 'string';
      return posOk && hasPath;
    }) as Row[];

    // 2) Storage'ta gerçekten var mı? + playable_url oluştur (TTL 3600 sn)
    const existenceChecked = await Promise.all(
      sanitized.map(async (v) => {
        try {
          const { data: signed, error: e } = await supabase
            .storage
            .from('videos')
            .createSignedUrl(v.storage_path!, 3600); // 1 saat
          if (e) return null; // obje yoksa at
          const playable_url = signed?.signedUrl ?? v.public_url ?? null;
          if (!playable_url) return null;
          return { ...v, playable_url } as Row;
        } catch (err) {
          console.warn('signedUrl err:', err);
          return null;
        }
      })
    );
    const existing = existenceChecked.filter(Boolean) as Row[];

    // 3) Like sayıları ve benim like durumum
    if (existing.length) {
      const ids = existing.map(v => v.id);
      const { data: counts, error: likeErr } = await supabase
        .from('video_likes')
        .select('video_id, is_like')
        .in('video_id', ids);

      if (likeErr) console.error(likeErr);

      let mine: { video_id:number }[] = [];
      if (myId) {
        const { data: mineRows, error: mineErr } = await supabase
          .from('video_likes')
          .select('video_id')
          .eq('user_id', myId);
        if (mineErr) console.error(mineErr);
        mine = mineRows ?? [];
      }

      const likeMap = new Map<number, number>();
      (counts ?? []).forEach(r => {
        if (r.is_like) likeMap.set(r.video_id, (likeMap.get(r.video_id) ?? 0) + 1);
      });

      const mySet = new Set<number>(mine.map(m => m.video_id));
      existing.forEach(v => {
        v.like_count = likeMap.get(v.id) ?? 0;
        v.my_like = mySet.has(v.id);
      });
    }

    if (!alive.current) return;

    // 4) Listeyi göster
    setRows(existing);
    setLoading(false);

    // 5) Yorumları videoyu oynatmadan yükle (arka planda, her video için)
    existing.forEach(v => { fetchComments(v.id); });
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [refreshKey, myId]);

  async function toggleLike(videoId: number, liked: boolean) {
    if (!myId) { alert('Beğenmek için giriş yap.'); return; }
    if (!liked) {
      const { error } = await supabase.from('video_likes').upsert(
        { video_id: videoId, user_id: myId, is_like: true },
        { onConflict: 'video_id,user_id' }
      );
      if (error) console.error(error);
    } else {
      const { error } = await supabase
        .from('video_likes')
        .delete()
        .eq('video_id', videoId)
        .eq('user_id', myId);
      if (error) console.error(error);
    }
    load();
  }

  async function addComment(videoId: number, content: string) {
    if (!myId) { alert('Yorum için giriş yap.'); return; }
    const trimmed = content.trim();
    if (!trimmed) return;
    const { error } = await supabase.from('video_comments').insert({
      video_id: videoId,
      user_id: myId,
      content: trimmed
    });
    if (error) console.error(error);
    await fetchComments(videoId);
  }

  async function fetchComments(videoId: number) {
    const { data, error } = await supabase
      .from('video_comments')
      .select('id, user_id, content, created_at')
      .eq('video_id', videoId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) console.error(error);
    setRows(prev => prev.map(r => r.id === videoId ? { ...r, comments: data ?? [] } : r));
  }

  // 🔧 HATA NEDENİ: Bu fonksiyon eksikti → geri eklendi
  async function deleteVideo(v: Row) {
    if (!myId) { alert('Silmek için giriş yap.'); return; }
    const mine = v.user_id === myId;
    if (!mine && !isAdmin) { alert('Yetkin yok.'); return; }
    if (!confirm('Videoyu silmek istediğine emin misin?')) return;

    // Storage → DB
    if (v.storage_path) {
      const { error: delObj } = await supabase.storage.from('videos').remove([v.storage_path]);
      if (delObj) console.warn('storage remove:', delObj?.message ?? delObj);
    }
    const { error: delRow } = await supabase.from('videos').delete().eq('id', v.id);
    if (delRow) console.error(delRow);

    load();
  }

  if (loading) return <div className="p">Yükleniyor…</div>;
  if (!rows.length) return <div className="p">Henüz video yok.</div>;

  return (
    <div className="grid">
      {rows.map(v => (
        <div key={v.id} className="card">
          <div className="video-thumb">
            <video
              src={withBypass(v.playable_url ?? v.public_url, v.created_at)}
              controls
              preload="metadata"
              style={{width:'100%',height:'100%',objectFit:'cover',display:'block',background:'#000'}}
            />
          </div>

          <div style={{display:'flex',justifyContent:'space-between',marginTop:8,alignItems:'center'}}>
            <div>
              <strong style={{fontSize:14}}>{v.full_name ?? ''}</strong>
              {v.position ? (
                <span className="badge" style={{marginLeft:8}}>
                  {POSITION_LABELS[v.position as Position] ?? String(v.position)}
                </span>
              ) : null}
            </div>

            {(myId && (isAdmin || v.user_id === myId)) ? (
              <button className="button" onClick={()=>deleteVideo(v)}>Sil</button>
            ) : null}
          </div>

          <div className="p" style={{marginTop:4}}>
            {v.country ? `${v.country}` : ''}{v.city ? ` · ${v.city}` : ''}
            {typeof v.age === 'number' ? ` · ${v.age} yaş` : ''}
            {v.club ? ` · ${v.club}` : ''}
          </div>

          {/* Beğeni alanı */}
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}>
            <button className="button" onClick={() => toggleLike(v.id, !!v.my_like)}>
              {v.my_like ? 'Unlike' : 'Like'}
            </button>
            <span className="p">{v.like_count ?? 0} beğeni</span>
          </div>

          {/* 🔥 AI Analizi: her kartta inline buton + rapor */}
          <div style={{marginTop:10}}>
            <AnalyzeInline
              videoId={String(v.id)}
              // sadece admin veya sahibi "Yeniden Analiz" görebilir
              canForce={Boolean(myId && (isAdmin || v.user_id === myId))}
            />
          </div>

          {/* Yorumlar */}
          <CommentBox videoId={v.id} onAdd={(c)=>addComment(v.id, c)} />
          <CommentList videoId={v.id} comments={v.comments} onRefresh={()=>fetchComments(v.id)} />
        </div>
      ))}
    </div>
  );
}

function CommentBox({ videoId, onAdd }: { videoId:number, onAdd:(c:string)=>void }) {
  const [text, setText] = useState('');
  return (
    <div style={{marginTop:10}}>
      <div className="row">
        <input className="input" placeholder="Yorum yaz…" value={text} onChange={e=>setText(e.target.value)} />
        <button className="button" onClick={()=>{ onAdd(text); setText(''); }}>Gönder</button>
      </div>
    </div>
  );
}

function CommentList({ videoId, comments, onRefresh }:{
  videoId:number,
  comments?: { id:number; user_id:string|null; content:string; created_at:string }[],
  onRefresh:()=>void
}) {
  const [myId, setMyId] = useState<string|null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      setMyId(uid);
      if (uid) {
        const { data: adminHit } = await supabase.from('admins').select('user_id').eq('user_id', uid).maybeSingle();
        setIsAdmin(!!adminHit);
      }
    })();
  }, []);

  async function delComment(id:number, uid:string|null) {
    if (!myId) return;
    if (myId !== uid && !isAdmin) return;
    const { error } = await supabase.from('video_comments').delete().eq('id', id);
    if (error) console.error(error);
    onRefresh();
  }

  if (!comments?.length) return null;

  return (
    <div style={{marginTop:10}}>
      {comments.map(c => (
        <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid #1d1e22'}}>
          <div style={{fontSize:13}}>
            {c.content}
            <span className="p" style={{marginLeft:8, fontSize:12, opacity:.7}}>
              {new Date(c.created_at).toLocaleString()}
            </span>
          </div>
          {(myId && (isAdmin || myId === c.user_id)) ? (
            <button className="button" onClick={()=>delComment(c.id, c.user_id)}>Sil</button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
