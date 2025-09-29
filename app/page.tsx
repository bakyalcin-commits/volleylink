'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { VideoRow, Position } from '@/types/db';

const POSITION_LABELS: Record<Position, string> = {
  S:   'Pasör (S)',
  OPP: 'Pasör Çaprazı (OPP)',
  OH:  'Smaçör (OH)',
  MB:  'Orta Oyuncu (MB)',
  L:   'Libero (L)',
  DS:  'Defans Uzmanı (DS)',
};

type Comment = { id:number; video_id:number; user_id:string|null; content:string; created_at:string };

// Row tipini genişlettik
type Row = (VideoRow & { club?: string }) & {
  like_count?: number;
  my_like?: boolean;
  comments?: Comment[];
};

export default function DiscoverGrid({ refreshKey }: { refreshKey?: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      if (mounted) setMyId(uid);

      if (uid) {
        const { data: adminHit } = await supabase
          .from('admins')
          .select('user_id')
          .eq('user_id', uid)
          .maybeSingle();
        if (mounted) setIsAdmin(!!adminHit);
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function load() {
    setLoading(true);

    // 1) Videolar
    const { data: vids, error } = await supabase
      .from('videos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(24);
    if (error) { console.error(error); setRows([] as any); setLoading(false); return; }

    const validSet = new Set<Position>(['S','OPP','OH','MB','L','DS']);
    const base = (vids ?? []).filter(v => v.position ? validSet.has(v.position as Position) : true) as Row[];

    // 2) Storage varlık kontrolü (yoksa listeleme)
    const existenceChecked = await Promise.all(
      base.map(async (v) => {
        const { error: e } = await supabase.storage.from('videos').createSignedUrl(v.storage_path, 60);
        return e ? null : v;
      })
    );
    const existing = existenceChecked.filter(Boolean) as Row[];

    const ids = existing.map(v => v.id);

    // 3) Like verileri
    if (ids.length) {
      const { data: counts } = await supabase
        .from('video_likes')
        .select('video_id, is_like')
        .in('video_id', ids);

      const { data: mine } = myId ? await supabase
        .from('video_likes')
        .select('video_id')
        .eq('user_id', myId) : { data: [] as any };

      const likeMap = new Map<number, number>();
      (counts ?? []).forEach(r => {
        if (r.is_like) likeMap.set(r.video_id, (likeMap.get(r.video_id) ?? 0) + 1);
      });
      const mySet = new Set<number>((mine ?? []).map((m:any) => m.video_id));

      existing.forEach(v => {
        v.like_count = likeMap.get(v.id) ?? 0;
        v.my_like = mySet.has(v.id);
      });
    }

    // 4) 🔥 Yorumları toptan çek (son 10)
    if (ids.length) {
      const { data: cmts } = await supabase
        .from('video_comments')
        .select('id, video_id, user_id, content, created_at')
        .in('video_id', ids)
        .order('created_at', { ascending: false });

      const map = new Map<number, Comment[]>();
      (cmts ?? []).forEach(c => {
        const arr = map.get(c.video_id) ?? [];
        if (arr.length < 10) arr.push(c);
        map.set(c.video_id, arr);
      });

      existing.forEach(v => {
        v.comments = map.get(v.id) ?? [];
      });
    }

    setRows(existing);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [refreshKey, myId]);

  // (Opsiyonel) Realtime: yeni yorum / silme anında yansısın
  useEffect(() => {
    const ch = supabase.channel('vc-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'video_comments' }, (payload:any) => {
        const c: Comment = payload.new;
        setRows(prev => prev.map(r => {
          if (r.id !== c.video_id) return r;
          const list = r.comments ? [c, ...r.comments] : [c];
          return { ...r, comments: list.slice(0, 10) };
        }));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'video_comments' }, (payload:any) => {
        const delId: number = payload.old.id;
        const vid: number = payload.old.video_id;
        setRows(prev => prev.map(r => r.id === vid ? { ...r, comments: (r.comments ?? []).filter(c => c.id !== delId) } : r));
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, []);

  async function toggleLike(videoId: number, liked: boolean) {
    if (!myId) { alert('Beğenmek için giriş yap.'); return; }
    if (!liked) {
      const { error } = await supabase.from('video_likes').upsert({ video_id: videoId, user_id: myId, is_like: true });
      if (error) console.error(error);
    } else {
      const { error } = await supabase.from('video_likes').delete().eq('video_id', videoId).eq('user_id', myId);
      if (error) console.error(error);
    }
    load();
  }

  async function addComment(videoId: number, content: string) {
    if (!myId) { alert('Yorum için giriş yap.'); return; }
    if (!content.trim()) return;
    const { error } = await supabase.from('video_comments').insert({ video_id: videoId, user_id: myId, content });
    if (error) console.error(error);
    // anında UI güncelle (realtime yoksa da çalışsın)
    setRows(prev => prev.map(r => {
      if (r.id !== videoId) return r;
      const now: Comment = { id: Math.random()*1e9|0, video_id: videoId, user_id: myId, content, created_at: new Date().toISOString() };
      const list = r.comments ? [now, ...r.comments] : [now];
      return { ...r, comments: list.slice(0, 10) };
    }));
  }

  async function fetchComments(videoId: number) {
    const { data } = await supabase
      .from('video_comments')
      .select('id, video_id, user_id, content, created_at')
      .eq('video_id', videoId)
      .order('created_at', { ascending: false })
      .limit(10);
    setRows(prev => prev.map(r => r.id === videoId ? { ...r, comments: data ?? [] } : r));
  }

  async function deleteVideo(v: Row) {
    if (!myId) { alert('Silmek için giriş yap.'); return; }
    const mine = v.user_id === myId;
    if (!mine && !isAdmin) { alert('Yetkin yok.'); return; }
    if (!confirm('Videoyu silmek istediğine emin misin?')) return;

    const { error: delObj } = await supabase.storage.from('videos').remove([v.storage_path]);
    if (delObj) console.warn('storage remove:', delObj?.message ?? delObj);
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
              src={`${v.public_url}?t=${encodeURIComponent(v.created_at)}`}
              controls
              preload="metadata"
              style={{width:'100%',height:'100%',objectFit:'cover',display:'block',background:'#000'}}
              onPlay={()=>{ if (!v.comments) fetchComments(v.id); }}
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

          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}>
            <button className="button" onClick={() => toggleLike(v.id, !!v.my_like)}>
              {v.my_like ? 'Unlike' : 'Like'}
            </button>
            <span className="p">{v.like_count ?? 0} beğeni</span>
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
  comments?: Comment[],
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
