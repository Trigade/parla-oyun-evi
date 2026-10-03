import { useEffect, useState } from "react";
import {
  api,
  formatSureMetni,
  getIsAdmin,
  type CustomerListItem,
  type CustomerPackage,
  type PackageDefinition,
} from "../api/client";

function formatKurus(kurus: number) {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

function odemeTipiEtiketi(odemeTipi: string) {
  if (odemeTipi === "kredi_karti") return "Kredi Kartı";
  if (odemeTipi === "nakit") return "Nakit";
  return "—";
}

export default function SatinAlma() {
  const isAdmin = getIsAdmin();

  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [ararken, setArarken] = useState(false);
  const [seciliMusteri, setSeciliMusteri] = useState<CustomerListItem | null>(null);

  const [paketler, setPaketler] = useState<PackageDefinition[]>([]);
  const [seciliPaketId, setSeciliPaketId] = useState<number | null>(null);
  const [odemeTipi, setOdemeTipi] = useState<"nakit" | "kredi_karti">("nakit");

  const [musteriPaketleri, setMusteriPaketleri] = useState<CustomerPackage[]>([]);
  const [musteriPaketleriYukleniyor, setMusteriPaketleriYukleniyor] = useState(false);

  const [satinAliniyor, setSatinAliniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);

  const [yeniPaketAdi, setYeniPaketAdi] = useState("");
  const [yeniGrup, setYeniGrup] = useState("Standart");
  const [yeniHaftalikGun, setYeniHaftalikGun] = useState("3");
  const [yeniGunlukSaat, setYeniGunlukSaat] = useState("4");
  const [yeniAylikUcret, setYeniAylikUcret] = useState("");
  const [paketOlusturuluyor, setPaketOlusturuluyor] = useState(false);
  const [paketTanimHata, setPaketTanimHata] = useState<string | null>(null);

  async function paketleriYukle() {
    try {
      const tanimlar = await api.listPackageDefinitions();
      setPaketler(tanimlar);
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

  async function satinAl() {
    if (!seciliMusteri || !seciliPaketId) return;
    setHata(null);
    setBasari(null);
    setSatinAliniyor(true);
    try {
      const kayit = await api.purchasePackage(seciliMusteri.id, seciliPaketId, odemeTipi);
      setBasari(
        `"${kayit.ad}" paketi ${seciliMusteri.ad} ${seciliMusteri.soyad} için tanımlandı. ` +
          `${formatKurus(kayit.tutar_kurus)} (${odemeTipiEtiketi(kayit.odeme_tipi)}) tahsil edildi, ` +
          `${kayit.gecerlilik_bitis} tarihine kadar geçerli.`
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
    const haftalikGun = Number(yeniHaftalikGun);
    const gunlukSaat = Number(yeniGunlukSaat.replace(",", "."));
    const aylikUcret = Number(yeniAylikUcret.replace(",", "."));
    if (!yeniPaketAdi.trim()) {
      setPaketTanimHata("Paket adı girin.");
      return;
    }
    if (!Number.isInteger(haftalikGun) || haftalikGun < 1 || haftalikGun > 7) {
      setPaketTanimHata("Haftalık gün 1 ile 7 arasında olmalı.");
      return;
    }
    if (!Number.isFinite(gunlukSaat) || gunlukSaat <= 0 || gunlukSaat > 24) {
      setPaketTanimHata("Günlük süre 0'dan büyük ve en fazla 24 saat olmalı.");
      return;
    }
    if (!Number.isFinite(aylikUcret) || aylikUcret < 0) {
      setPaketTanimHata("Geçerli bir aylık ücret girin.");
      return;
    }
    setPaketOlusturuluyor(true);
    try {
      await api.createPackageDefinition(
        yeniPaketAdi.trim(),
        yeniGrup.trim() || "Standart",
        haftalikGun,
        Math.round(gunlukSaat * 60),
        Math.round(aylikUcret * 100)
      );
      setYeniPaketAdi("");
      setYeniAylikUcret("");
      await paketleriYukle();
    } catch (e) {
      setPaketTanimHata((e as Error).message);
    } finally {
      setPaketOlusturuluyor(false);
    }
  }

  const aktifPaket = musteriPaketleri.find((p) => !p.suresi_dolmus_mu) ?? null;

  return (
    <div className="page page--wide">
      <h1>Satın Alma</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Müşteriye aylık paket tanımlayın. Paket, haftada belirli gün ve günde belirli süre
        kullanım hakkı verir; ücreti satın alma anında dondurulur ve o günün cirosuna eklenir.
        Paketli müşteri kasada geldiğinde ücret istenmez, kasiyer "Paketten Düş" ile kapatır.
      </p>

      {hata && <div className="alert alert--error">{hata}</div>}
      {basari && <div className="alert alert--success">{basari}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Paketler</h2>
        {paketler.length === 0 ? (
          <p className="muted">Henüz tanımlı bir paket yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Paket İsmi</th>
                <th>Yaş / Grup</th>
                <th>Haftalık Gün</th>
                <th>Günlük Süre</th>
                <th>Aylık Ücret</th>
              </tr>
            </thead>
            <tbody>
              {paketler.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.ad}</td>
                  <td>{p.grup}</td>
                  <td>{p.haftalik_gun} Gün</td>
                  <td>{formatSureMetni(p.gunluk_dakika)}</td>
                  <td>{formatKurus(p.aylik_ucret_kurus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Müşteri Seç</h2>
        <div className="field">
          <label htmlFor="paket-musteri-ara">Ara (ad, soyad, TC kimlik no veya telefon)</label>
          <input
            id="paket-musteri-ara"
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
                  <td className="muted">{c.aktif_paket ?? "Paketi yok"}</td>
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
                <span className="muted">Paket bilgisi yükleniyor...</span>
              ) : aktifPaket ? (
                <span>
                  Aktif paket: <strong>{aktifPaket.ad}</strong> · haftada {aktifPaket.haftalik_gun} gün ·
                  günde {formatSureMetni(aktifPaket.gunluk_dakika)} · {aktifPaket.gecerlilik_bitis} tarihine kadar
                </span>
              ) : (
                <span className="muted">Aktif paketi yok.</span>
              )}
            </div>
          </div>
        )}
      </div>

      {seciliMusteri && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2>Paket Tanımla</h2>
          {paketler.length === 0 ? (
            <p className="muted">Önce bir paket türü tanımlanmalı.</p>
          ) : (
            <>
              <div className="field-row" style={{ alignItems: "flex-end" }}>
                <div className="field">
                  <label htmlFor="paket-secimi">Paket</label>
                  <select
                    id="paket-secimi"
                    value={seciliPaketId ?? ""}
                    onChange={(e) => setSeciliPaketId(Number(e.target.value))}
                    style={{ maxWidth: 280 }}
                  >
                    {paketler.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.ad} ({p.haftalik_gun} gün / {formatSureMetni(p.gunluk_dakika)})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="paket-odeme-tipi">Ödeme Tipi</label>
                  <select
                    id="paket-odeme-tipi"
                    value={odemeTipi}
                    onChange={(e) => setOdemeTipi(e.target.value as "nakit" | "kredi_karti")}
                    style={{ maxWidth: 160 }}
                  >
                    <option value="nakit">Nakit</option>
                    <option value="kredi_karti">Kredi Kartı</option>
                  </select>
                </div>
                <div className="field">
                  <label>Tahsil Edilecek</label>
                  <div className="stat-card__value" style={{ fontSize: 20 }}>
                    {seciliPaket ? formatKurus(seciliPaket.aylik_ucret_kurus) : "—"}
                  </div>
                </div>
                <button onClick={satinAl} disabled={satinAliniyor || !seciliPaketId}>
                  {satinAliniyor ? "İşleniyor..." : "Satın Al ve Tanımla"}
                </button>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                Paket, tanımlandığı tarihten itibaren 1 ay geçerlidir ve tutar bugünün cirosuna eklenir.
              </p>
            </>
          )}

          {musteriPaketleri.length > 0 && (
            <table style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Paket</th>
                  <th>Haftalık Gün</th>
                  <th>Günlük Süre</th>
                  <th>Tutar</th>
                  <th>Ödeme</th>
                  <th>Satın Alma</th>
                  <th>Geçerlilik Bitişi</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {musteriPaketleri.map((p) => (
                  <tr key={p.id}>
                    <td>{p.ad}</td>
                    <td>{p.haftalik_gun} gün</td>
                    <td>{formatSureMetni(p.gunluk_dakika)}</td>
                    <td>{formatKurus(p.tutar_kurus)}</td>
                    <td>{odemeTipiEtiketi(p.odeme_tipi)}</td>
                    <td>{p.satin_alma_zamani}</td>
                    <td>{p.gecerlilik_bitis}</td>
                    <td>
                      {p.suresi_dolmus_mu ? (
                        <span className="muted">Süresi Doldu</span>
                      ) : (
                        <span className="badge badge--nakit">Aktif</span>
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
          <div className="field-row" style={{ alignItems: "flex-end" }}>
            <div className="field">
              <label htmlFor="yeni-paket-adi">Paket Adı</label>
              <input
                id="yeni-paket-adi"
                placeholder="Örn: 5 Günlük Paket"
                value={yeniPaketAdi}
                onChange={(e) => setYeniPaketAdi(e.target.value)}
                style={{ maxWidth: 220 }}
              />
            </div>
            <div className="field">
              <label htmlFor="yeni-paket-grup">Yaş / Grup</label>
              <input
                id="yeni-paket-grup"
                placeholder="Örn: Standart"
                value={yeniGrup}
                onChange={(e) => setYeniGrup(e.target.value)}
                style={{ maxWidth: 160 }}
              />
            </div>
            <div className="field">
              <label htmlFor="yeni-paket-gun">Haftalık Gün</label>
              <select
                id="yeni-paket-gun"
                value={yeniHaftalikGun}
                onChange={(e) => setYeniHaftalikGun(e.target.value)}
                style={{ maxWidth: 120 }}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((g) => (
                  <option key={g} value={g}>
                    {g} Gün
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="yeni-paket-saat">Günlük Süre (saat)</label>
              <input
                id="yeni-paket-saat"
                placeholder="Örn: 4"
                value={yeniGunlukSaat}
                onChange={(e) => setYeniGunlukSaat(e.target.value)}
                style={{ maxWidth: 140 }}
              />
            </div>
            <div className="field">
              <label htmlFor="yeni-paket-ucret">Aylık Ücret (TL)</label>
              <input
                id="yeni-paket-ucret"
                placeholder="Örn: 14000"
                value={yeniAylikUcret}
                onChange={(e) => setYeniAylikUcret(e.target.value)}
                style={{ maxWidth: 160 }}
              />
            </div>
            <button onClick={paketTanimla} disabled={paketOlusturuluyor}>
              {paketOlusturuluyor ? "Kaydediliyor..." : "Paket Türü Ekle"}
            </button>
          </div>
          {paketTanimHata && <div className="alert alert--error" style={{ marginTop: 12 }}>{paketTanimHata}</div>}
        </div>
      )}
    </div>
  );
}
