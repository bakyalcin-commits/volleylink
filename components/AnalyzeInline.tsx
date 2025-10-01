'use client';
import { useState } from 'react';

type VbReport = { strengths: string[]; issues: string[]; drills: string[] };

export default function AnalyzeInline({ videoId, canForce = false }: { videoId: string; canForce?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<VbReport | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [allowForce, setAllowForce] = useState(false); // rapor boşsa herkese force

  const run = async (force = false) => {
    setLoading(true); setMsg(null);
    try {
      const res = await fetch('/api/analyze-video', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ videoId, force })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Analiz başarısız');

      if (json.queued) setMsg('Analiz zaten çalışıyor, birazdan hazır olur.');

      if (json.report) {
        setReport(json.report);
        const empty =
          (!json.report.strengths || json.report.strengths.length === 0) &&
          (!json.report.issues || json.report.issues.length === 0) &&
          (!json.report.drills || json.report.drills.length === 0);
        setAllowForce(empty);
      }
      setOpen(true);
    } catch (e:any) {
      setMsg(e.message || 'Analiz başarısız. Videodan yeterli kare çıkarılamadı.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-8">
        <button
          className="button"     // diğer butonlarla aynı stil
          onClick={() => run(false)}
          disabled={loading}
          aria-busy={loading ? 'true' : 'false'}
        >
          {loading ? 'Analiz…' : 'Yapay Zeka Analizi'}
        </button>

        {(canForce || allowForce) && (
          <button
            className="button secondary"
            onClick={() => run(true)}
            disabled={loading}
          >
            Yeniden Analiz
          </button>
        )}

        {report && (
          <button
            className="text-sm underline"
            onClick={() => setOpen((v) => !v)}
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

function Section({ title, items }: { title:string; items:string[] }) {
  const has = Array.isArray(items) && items.length > 0;
  return (
    <div>
      <div className="font-semibold mb-1 text-sm">{title}</div>
      {has ? (
        <ul className="list-disc pl-5 text-xs space-y-1">
          {items.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      ) : (
        <div className="text-xs opacity-70">Veri üretilemedi.</div>
      )}
    </div>
  );
}
