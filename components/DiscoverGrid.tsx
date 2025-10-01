'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { VideoRow, Position } from '@/types/db';
import AnalyzeInline from '@/components/AnalyzeInline'; // inline analiz

// Kod -> Etiket eşlemesi
const POSITION_LABELS: Record<Position, string> = {
  S:   'Pasör (S)',
  OPP: 'Pasör Çaprazı (OPP)',
  OH:  'Smaçör (OH)',
  MB:  'Orta Oyuncu (MB)',
  L:   'Libero (L)',
  DS:  'Defans Uzmanı (DS)',
};

type Row = (VideoRow & { club?: string }) & {
  like_count?: number;
  my_like?: boolean;
  comments?: { id:number; user_id:string|null; content:string; created_at:string }[];
  playable_url?: string;
};

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

  // ... load(), toggleLike(), addComment(), fetchComments(), deleteVideo() aynı kalıyor ...

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

          {/* 🔥 AI Analizi — artık sadece admin yeniden analiz görebilir */}
          <div style={{marginTop:10}}>
            <AnalyzeInline
              videoId={String(v.id)}
              canForce={isAdmin}   // ← değiştirdik
            />
          </div>

          <CommentBox videoId={v.id} onAdd={(c)=>addComment(v.id, c)} />
          <CommentList videoId={v.id} comments={v.comments} onRefresh={()=>fetchComments(v.id)} />
        </div>
      ))}
    </div>
  );
}

// CommentBox ve CommentList olduğu gibi kalıyor
