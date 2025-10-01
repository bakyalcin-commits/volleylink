'use client';
import { useEffect, useState } from 'react';

type VbReport = { strengths: string[]; issues: string[]; drills: string[] };

export default function AnalyzePanel({ videoId, canForce=false }: { videoId:string; canForce?:boolean }) {
  const [loading, setLoading] = useState(false);
  const [exists, setExists] = useState<boolean | null>(null);
  const [report, setReport] = useState<VbReport | null>(null);
  const [meta, setMeta] = useState<{version?:number; model?:string; created_at?:string} | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Sayfa yüklenince cache durumunu kontrol et
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/analysis?videoId=${encodeURIComponent(videoId)}`);
      const json = await res.json();
      if (json.exists) {
        setExists(true);
        setReport(json.analysis?.report ?? null);
        setMeta({
          version: json.analysis?.version,
          model: json.analysis?.model,
          created_at: json.analysis?.created_at
        });
      } else {
        setExists(false);
      }
    })();
  }, [videoId]);

  const runAnalyze = async (force=false) => {
    setLoading(true); setMsg(null);
    const res = await fetch('/api/analyze-video', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ videoId, force })
    });
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error || 'Analiz başarısız'); setLoading(false); return;
    }
    if (json.from_cache) setMsg('Bu video daha önce analiz edilmiş. Mevcut rapor gösteriliyor.');
    if (json.queued) setMsg('Analiz zaten çalışıyor, birazdan hazır olur.');
    if (json.report) setReport(json.report);
    if (json.meta) setMeta(json.meta);
    setExists(!!json.report);
    setLoading(false);
  };

  return (
    <div className="rounded border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-gray-500">
          {meta?.model ? `Model: ${meta.model}` : 'Model: —'}{meta?.version ? ` • v${meta.version}` : ''}{meta?.created_at ? ` • ${new Date(meta.created_at).toLocaleString()}` : ''}
        </div>
        <div className="flex gap-2">
          {exists ? (
            <>
              <button
                className="px-3 py-2 rounded bg-gray-900 text-white"
                onClick={() => runAnalyze(false)}
                disabled={loading}
                title="Cache varsa onu getirir"
              >
                Analizi Görüntüle
              </button>
              {canForce && (
                <button
                  className="px-3 py-2 rounded border"
                  onClick={() => runAnalyze(true)}
                  disabled={loading}
                  title="Yeni sürüm üretir ve cache’i aşar"
                >
                  Yeniden Analiz (v+1)
                </button>
              )}
            </>
          ) : (
            <button
              className="px-3 py-2 rounded bg-black text-white"
              onClick={() => runAnalyze(false)}
              disabled={loading}
            >
              {loading ? 'Analiz yapılıyor…' : 'AI ile Analiz Et'}
            </button>
          )}
        </div>
      </div>

      {msg && <div className="text-sm text-amber-600">{msg}</div>}

      {report && (
        <div className="grid md:grid-cols-3 gap-4">
          <Section title="Güçlü Yanlar" items={report.strengths} />
          <Section title="Geliştirme Alanları" items={report.issues} />
          <Section title="Drill Önerileri" items={report.drills} />
        </div>
      )}
    </div>
  );
}

function Section({ title, items }: { title:string; items:string[] }) {
  return (
    <div className="rounded border p-3">
      <div className="font-semibold mb-2">{title}</div>
      <ul className="list-disc pl-5 text-sm space-y-1">
        {items?.length ? items.map((t, i) => <li key={i}>{t}</li>) : <li>—</li>}
      </ul>
    </div>
  );
}
