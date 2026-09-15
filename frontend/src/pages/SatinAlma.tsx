import { useEffect, useState } from "react";
import {
  api,
  getIsAdmin,
  type CustomerListItem,
  type CustomerPackage,
  type PackageDefinition,
  type PricingRule,
} from "../api/client";

function formatKurus(kurus: number) {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

// Paket satışı şimdilik kapalı. Yeniden açmak için false yapın; backend'deki
// paketSatisiBakimda sabiti de (handlers/packages.go) aynı şekilde güncellenmeli.
const PAKET_SATISI_BAKIMDA = true;

export default function SatinAlma() {
  if (PAKET_SATISI_BAKIMDA) {
    return (
      <div className="page">
        <h1>Satın Alma</h1>
        <div className="card">
          <h2>Bu bölüm bakımda</h2>
          <p className="muted">
            Paket satışı ve yeni paket türü tanımlama şimdilik kapalı. Müşterilerin daha önce aldığı
            paketlerin bakiyesi kasa ekranında kullanılmaya devam eder.
          </p>
        </div>
      </div>
    );
  }
  return <SatinAlmaIcerik />;
}

function SatinAlmaIcerik() {
  const isAdmin = getIsAdmin();

  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [ararken, setArarken] = useState(false);
  const [seciliMusteri, setSeciliMusteri] = useState<CustomerListItem | null>(null);

  const [paketler, setPaketler] = useState<PackageDefinition[]>([]);
  const [seciliPaketId, setSeciliPaketId] = useState<number | null>(null);
  const [aktifFiyat, setAktifFiyat] = useState<PricingRule | null>(null);

  const [musteriPaketleri, setMusteriPaketleri] = useState<CustomerPackage[]>([]);
  const [musteriPaketleriYukleniyor, setMusteriPaketleriYukleniyor] = useState(false);

  const [satinAliniyor, setSatinAliniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);

  const [yeniPaketAdi, setYeniPaketAdi] = useState("");
  const [yeniPaketDakika, setYeniPaketDakika] = useState("");
  const [paketOlusturuluyor, setPaketOlusturuluyor] = useState(false);
  const [paketTanimHata, setPaketTanimHata] = useState<string | null>(null);

  async function paketleriYukle() {
    try {
      const [tanimlar, fiyat] = await Promise.all([
        api.listPackageDefinitions(),
        api.getActivePricingRule().catch(() => null),
      ]);
      setPaketler(tanimlar);
      setAktifFiyat(fiyat);
      if (tanimlar.length > 0) setSeciliPaketId((prev) => prev ?? tanimlar[0].id);
    } catch (e) {
      setHata((e as Error).message);
    }
  }

  useEffect(() => {
    paketleriYukle();
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setCustomers([]);
      return;
    }
    setArarken(true);
    const timeout = setTimeout(async () => {
      try {
        setCustomers(await api.listCustomers(query));
      } catch (e) {
        setHata((e as Error).message);
      } finally {
        setArarken(false);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  async function musteriSec(c: CustomerListItem) {
    setSeciliMusteri(c);
    setCustomers([]);
    setQuery("");
    setHata(null);
    setBasari(null);
    await musteriPaketleriYukle(c.id);
  }

  async function musteriPaketleriYukle(customerId: number) {
    setMusteriPaketleriYukleniyor(true);
    try {
      setMusteriPaketleri(await api.listCustomerPackages(customerId));
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setMusteriPaketleriYukleniyor(false);
    }
  }

  const seciliPaket = paketler.find((p) => p.id === seciliPaketId) ?? null;
  const tahminiTutar =
    seciliPaket && aktifFiyat ? seciliPaket.dakika * aktifFiyat.kurus_per_dakika : null;

  async function satinAl() {
    if (!seciliMusteri || !seciliPaketId) return;
    setHata(null);
    setBasari(null);
    setSatinAliniyor(true);
    try {
      const kayit = await api.purchasePackage(seciliMusteri.id, seciliPaketId);
      setBasari(
        `"${kayit.ad}" paketi ${seciliMusteri.ad} ${seciliMusteri.soyad} için ${formatKurus(
          kayit.tutar_kurus
        )} karşılığında tanımlandı.`
      );
      await musteriPaketleriYukle(seciliMusteri.id);
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setSatinAliniyor(false);
    }
  }

  async function paketTanimla() {
    setPaketTanimHata(null);
    const dakika = Number(yeniPaketDakika);
    if (!yeniPaketAdi.trim()) {
      setPaketTanimHata("Paket adı girin.");
      return;
    }
    if (!Number.isFinite(dakika) || dakika <= 0) {
      setPaketTanimHata("Geçerli bir dakika miktarı girin.");
      return;
    }
    setPaketOlusturuluyor(true);
    try {
      await api.createPackageDefinition(yeniPaketAdi.trim(), Math.round(dakika));
      setYeniPaketAdi("");
      setYeniPaketDakika("");
      await paketleriYukle();
    } catch (e) {
      setPaketTanimHata((e as Error).message);
    } finally {
      setPaketOlusturuluyor(false);
    }
  }

  const toplamKalanDakika = musteriPaketleri
    .filter((p) => !p.suresi_dolmus_mu)
    .reduce((toplam, p) => toplam + p.kalan_dakika, 0);

  return (
    <div className="page">
      <h1>Satın Alma</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Müşteriye aylık dakika paketi tanımlayın. Tutar, satın alma anındaki aktif dakika
        ücretinden hesaplanır ve dondurulur; müşteri giriş/çıkış yaptıkça kalan dakikasından
        düşülür, paketi bittiğinde normal dakika ücreti üzerinden tahsilat yapılmaya devam eder.
      </p>

      {hata && <div className="alert alert--error">{hata}</div>}
      {basari && <div className="alert alert--success">{basari}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Müşteri Seç</h2>
        <div className="field">
          <label>Ara (ad, soyad, TC kimlik no veya telefon)</label>
          <input
            placeholder="Örn: Ahmet ya da 12345678901"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 320 }}
          />
        </div>
        {ararken && <p className="muted">Aranıyor...</p>}
        {customers.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} onClick={() => musteriSec(c)} style={{ cursor: "pointer" }}>
                  <td>
                    {c.ad} {c.soyad}
                  </td>
                  <td>{c.tc_kimlik_no}</td>
                  <td>{c.telefon || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {seciliMusteri && (
          <div style={{ marginTop: 16, padding: 12, background: "var(--cream-soft)", borderRadius: 8 }}>
            <strong>
              {seciliMusteri.ad} {seciliMusteri.soyad}
            </strong>
            <span className="muted"> · TC: {seciliMusteri.tc_kimlik_no} · Tel: {seciliMusteri.telefon || "—"}</span>
            <div style={{ marginTop: 4 }}>
              {musteriPaketleriYukleniyor ? (
                <span className="muted">Paket bakiyesi yükleniyor...</span>
              ) : (
                <span>
                  Kalan Paket Bakiyesi: <strong>{toplamKalanDakika} dakika</strong>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {seciliMusteri && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2>Paket Satın Al</h2>
          {paketler.length === 0 ? (
            <p className="muted">Henüz tanımlı bir paket türü yok.</p>
          ) : (
            <div className="field-row">
              <div className="field">
                <label>Paket</label>
                <select
                  value={seciliPaketId ?? ""}
                  onChange={(e) => setSeciliPaketId(Number(e.target.value))}
                  style={{ maxWidth: 220 }}
                >
                  {paketler.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.ad} ({p.dakika} dk)
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Tahmini Tutar</label>
                <div className="stat-card__value" style={{ fontSize: 20 }}>
                  {tahminiTutar != null ? formatKurus(tahminiTutar) : "—"}
                </div>
              </div>
              <button onClick={satinAl} disabled={satinAliniyor || !seciliPaketId}>
                {satinAliniyor ? "İşleniyor..." : "Satın Al ve Tanımla"}
              </button>
            </div>
          )}

          {musteriPaketleri.length > 0 && (
            <table style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Paket</th>
                  <th>Toplam Dk</th>
                  <th>Kalan Dk</th>
                  <th>Tutar</th>
                  <th>Satın Alma</th>
                  <th>Geçerlilik Bitişi</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {musteriPaketleri.map((p) => (
                  <tr key={p.id}>
                    <td>{p.ad}</td>
                    <td>{p.toplam_dakika}</td>
                    <td>{p.kalan_dakika}</td>
                    <td>{formatKurus(p.tutar_kurus)}</td>
                    <td>{p.satin_alma_zamani}</td>
                    <td>{p.gecerlilik_bitis}</td>
                    <td>
                      {p.suresi_dolmus_mu ? (
                        <span className="muted">Süresi Doldu</span>
                      ) : p.kalan_dakika > 0 ? (
                        <span className="badge badge--nakit">Aktif</span>
                      ) : (
                        <span className="muted">Tükendi</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <h2>Yeni Paket Türü Tanımla</h2>
          <div className="field-row">
            <div className="field">
              <label>Paket Adı</label>
              <input
                placeholder="Örn: Aylık 1000 Dakika"
                value={yeniPaketAdi}
                onChange={(e) => setYeniPaketAdi(e.target.value)}
                style={{ maxWidth: 220 }}
              />
            </div>
            <div className="field">
              <label>Dakika</label>
              <input
                placeholder="Örn: 1000"
                value={yeniPaketDakika}
                onChange={(e) => setYeniPaketDakika(e.target.value)}
                style={{ maxWidth: 120 }}
              />
            </div>
            <button onClick={paketTanimla} disabled={paketOlusturuluyor}>
              {paketOlusturuluyor ? "Kaydediliyor..." : "Paket Türü Ekle"}
            </button>
          </div>
          {paketTanimHata && <div className="alert alert--error" style={{ marginTop: 12 }}>{paketTanimHata}</div>}

          {paketler.length > 0 && (
            <table style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Paket Adı</th>
                  <th>Dakika</th>
                </tr>
              </thead>
              <tbody>
                {paketler.map((p) => (
                  <tr key={p.id}>
                    <td>{p.ad}</td>
                    <td>{p.dakika}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
