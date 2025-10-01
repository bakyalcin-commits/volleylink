'use client';
import { useState } from 'react';

type VbReport = { strengths: string[]; issues: string[]; drills: string[] };

export default function AnalyzeInline({
  videoId,
  canForce = false, // artık kullanılmıyor ama API sabit kalsın
}: {
  videoId: string;
  canForce?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<VbReport | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const run = async (force = false) => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('/api/analyze-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, force }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Analiz başarısız');

      // Önceden cache mesajını tamamen kaldırdık.
      // Kuyruğa alındı mesajını da istemiyorsan aşağıdaki satırı da sil.
      if (json.queued) setMsg('Analiz çalışıyor, birazdan hazır olur.');

      if (json.report) setReport(json.report);
      setOpen(true);
    } catch (e: any) {
      setMsg(e.message || 'Analiz başarısız. Videodan yeterli kare çıkarılamadı.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-8">
        <button
          className="px-3 py-1.5 rounded bg-black text-white text-sm"
          onClick={() => run(false)}
          disabled={loading}
          title="Bu video için AI analizi çalıştırır (gerekirse cache’ten getirir)"
        >
          {loading ? 'Analiz…' : 'YAPAY ZEKA ANALİZİ'}
        </button>

        {/* Yeniden Analiz butonu tamamen kaldırıldı */}

        {report && (
          <button
            className="text-sm underline"
            onClick={() => setOpen((v) => !v)}
            title="Rapor panelini aç/kapat"
          >
            {open ? 'Raporu Gizle' : 'Raporu Göster'}
          </button>
        )}
      </div>

      {msg && <div className="text-xs text-amber-600">{msg}</div>}

      {open && report && (
        <div className="grid md:grid-cols-3 gap-3 border rounded p-3 bg-black/5">
          <Section title="Güçlü Yanlar" items={report.strengths} />
          <Section title="Geliştirme Alanları" items={report.issues} />
          <Section title="Drill Önerileri" items={report.drills} />
        </div>
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  const has = Array.isArray(items) && items.length > 0;
  return (
    <div>
      <div className="font-semibold mb-1 text-sm">{title}</div>
      {has ? (
        <ul className="list-disc pl-5 text-xs space-y-1">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <div className="text-xs opacity-70">Veri üretilemedi.</div>
      )}
    </div>
  );
}
