import { useEffect, useState } from "react";
import { api, type Report } from "../api/client";

function formatKurus(kurus: number) {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

function toDateInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type Preset = "bugun" | "bu_hafta" | "bu_ay" | "ozel";

function presetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const today = toDateInputValue(now);

  if (preset === "bugun") {
    return { from: today, to: today };
  }
  if (preset === "bu_hafta") {
    const gun = (now.getDay() + 6) % 7; // Pazartesi = 0
    const pazartesi = new Date(now);
    pazartesi.setDate(now.getDate() - gun);
    return { from: toDateInputValue(pazartesi), to: today };
  }
  if (preset === "bu_ay") {
    const ayBasi = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toDateInputValue(ayBasi), to: today };
  }
  return { from: today, to: today };
}

const PRESET_LABELS: Record<Exclude<Preset, "ozel">, string> = {
  bugun: "Bugün",
  bu_hafta: "Bu Hafta",
  bu_ay: "Bu Ay",
};

const CIRO_GRAFIK_BASLIK: Record<Preset, string> = {
  bugun: "Günlük Ciro",
  bu_hafta: "Haftalık Ciro",
  bu_ay: "Aylık Ciro",
  ozel: "Özel Aralık Cirosu",
};

export default function Dashboard() {
  const [preset, setPreset] = useState<Preset>("bugun");
  const [from, setFrom] = useState(() => presetRange("bugun").from);
  const [to, setTo] = useState(() => presetRange("bugun").to);
  const [report, setReport] = useState<Report | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [indiriliyor, setIndiriliyor] = useState(false);
  const [oranGosterimi, setOranGosterimi] = useState<"yuzde" | "net">("yuzde");

  async function pdfIndir() {
    setHata(null);
    setIndiriliyor(true);
    try {
      await api.exportSessionsPDF(from, to);
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setIndiriliyor(false);
    }
  }

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p !== "ozel") {
      const r = presetRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  async function fetchReport() {
    setYukleniyor(true);
    setHata(null);
    try {
      setReport(await api.getReport(from, to));
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const maxCiro = report ? Math.max(1, ...report.gunluk_kirilim.map((d) => d.ciro_kurus)) : 1;
  const toplamTutar = report ? report.nakit_kurus + report.kredi_karti_kurus : 0;
  const nakitOrani = report && toplamTutar > 0 ? Math.round((report.nakit_kurus / toplamTutar) * 100) : 0;

  return (
    <div className="page">
      <h1>Yönetici Dashboard'u</h1>
      <p className="muted" style={{ marginBottom: 20 }}>Ciro, oturum sayısı ve ödeme tipi dağılımını inceleyin.</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="field-row" style={{ alignItems: "center" }}>
          {(Object.keys(PRESET_LABELS) as (keyof typeof PRESET_LABELS)[]).map((p) => (
            <button
              key={p}
              className={preset === p ? "preset-active" : "ghost"}
              onClick={() => applyPreset(p)}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
          <button className={preset === "ozel" ? "preset-active" : "ghost"} onClick={() => applyPreset("ozel")}>
            Özel Aralık
          </button>
          {preset === "ozel" && (
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="muted">—</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </span>
          )}
          <button className="accent" style={{ marginLeft: "auto" }} onClick={pdfIndir} disabled={indiriliyor}>
            {indiriliyor ? "İndiriliyor..." : "📄 PDF Olarak İndir"}
          </button>
        </div>
      </div>

      {hata && <div className="alert alert--error">{hata}</div>}
      {yukleniyor && <p className="muted">Yükleniyor...</p>}

      {report && !yukleniyor && (
        <>
          <div className="stat-row">
            <div className="stat-card">
              <div className="stat-card__label">Toplam Ciro</div>
              <div className="stat-card__value">{formatKurus(report.toplam_ciro_kurus)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">Oturum Sayısı</div>
              <div className="stat-card__value">{report.oturum_sayisi}</div>
            </div>
            <div className="stat-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div className="stat-card__label">Nakit / Kart Oranı</div>
                <button
                  className="ghost"
                  style={{ padding: "2px 10px", fontSize: 12 }}
                  onClick={() => setOranGosterimi((prev) => (prev === "yuzde" ? "net" : "yuzde"))}
                >
                  {oranGosterimi === "yuzde" ? "Tutar Göster" : "Yüzde Göster"}
                </button>
              </div>
              <div className="stat-card__value">
                {oranGosterimi === "yuzde"
                  ? `%${nakitOrani} / %${100 - nakitOrani}`
                  : `${formatKurus(report.nakit_kurus)} / ${formatKurus(report.kredi_karti_kurus)}`}
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Ödeme Tipi Dağılımı</h2>
            <table>
              <thead>
                <tr>
                  <th>Ödeme Tipi</th>
                  <th>Oturum Sayısı</th>
                  <th>Tutar</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span className="badge badge--nakit">Nakit</span></td>
                  <td>{report.nakit_sayisi}</td>
                  <td>{formatKurus(report.nakit_kurus)}</td>
                </tr>
                <tr>
                  <td><span className="badge badge--kart">Kredi Kartı</span></td>
                  <td>{report.kredi_karti_sayisi}</td>
                  <td>{formatKurus(report.kredi_karti_kurus)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>{CIRO_GRAFIK_BASLIK[preset]}</h2>
            {report.gunluk_kirilim.length === 0 ? (
              <p className="muted">Bu aralıkta kapanmış oturum yok.</p>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 210, paddingTop: 10, overflowX: "auto" }}>
                {report.gunluk_kirilim.map((d) => (
                  <div key={d.tarih} style={{ textAlign: "center", fontSize: 12, flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-h)", marginBottom: 4 }}>
                      {formatKurus(d.ciro_kurus)}
                    </div>
                    <div
                      title={`${d.tarih}: ${formatKurus(d.ciro_kurus)}`}
                      style={{
                        background: "linear-gradient(180deg, var(--mustard), var(--terracotta))",
                        borderRadius: "6px 6px 2px 2px",
                        width: 34,
                        height: Math.max(6, (d.ciro_kurus / maxCiro) * 130),
                      }}
                    />
                    <div className="muted" style={{ marginTop: 6 }}>{d.tarih.slice(5)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
