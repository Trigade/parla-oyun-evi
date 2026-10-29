import { useEffect, useState } from "react";
import {
  api,
  abonelikOzetiMetni,
  formatSureMetni,
  getIsAdmin,
  type CustomerListItem,
  type CustomerPackage,
  type PackageDefinition,
} from "../api/client";

function formatKurus(kurus: number) {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

// Paketin hakkını tek satırda anlatır: abonelik "haftada 3 gün · günde 4 saat",
// saat bakiyeli "10 saat bakiye".
function hakMetni(p: { tur: string; haftalik_gun: number; gunluk_dakika: number; dakika?: number; toplam_dakika?: number }) {
  if (p.tur === "bakiye") return `${formatSureMetni(p.dakika ?? p.toplam_dakika ?? 0)} bakiye`;
  return `haftada ${p.haftalik_gun} gün · günde ${formatSureMetni(p.gunluk_dakika)}`;
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
  const [ozelTutar, setOzelTutar] = useState("");

  const [musteriPaketleri, setMusteriPaketleri] = useState<CustomerPackage[]>([]);
  const [musteriPaketleriYukleniyor, setMusteriPaketleriYukleniyor] = useState(false);

  const [satinAliniyor, setSatinAliniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);

  const [yeniTur, setYeniTur] = useState<"abonelik" | "bakiye">("abonelik");
  const [yeniToplamSaat, setYeniToplamSaat] = useState("10");
  const [yeniPaketAdi, setYeniPaketAdi] = useState("");
  const [yeniGrup, setYeniGrup] = useState("Standart");
  const [yeniHaftalikGun, setYeniHaftalikGun] = useState("3");
  const [yeniGunlukSaat, setYeniGunlukSaat] = useState("4");
  const [yeniAylikUcret, setYeniAylikUcret] = useState("");
  const [paketOlusturuluyor, setPaketOlusturuluyor] = useState(false);
  const [paketTanimHata, setPaketTanimHata] = useState<string | null>(null);
  // Doluysa "Paket Tanımla" formu bu tanımı düzenler (yalnızca yönetici).
  const [duzenlenenPaketId, setDuzenlenenPaketId] = useState<number | null>(null);

  function duzenlemeyeBasla(p: PackageDefinition) {
    setDuzenlenenPaketId(p.id);
    setYeniTur(p.tur);
    setYeniPaketAdi(p.ad);
    setYeniGrup(p.grup);
    setYeniToplamSaat(String((p.dakika ?? 0) / 60).replace(".", ","));
    setYeniHaftalikGun(String(p.haftalik_gun || 3));
    setYeniGunlukSaat(String(p.gunluk_dakika / 60 || 4).replace(".", ","));
    setYeniAylikUcret(String(p.aylik_ucret_kurus / 100).replace(".", ","));
    setPaketTanimHata(null);
    document.getElementById("yeni-paket-adi")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function duzenlemedenVazgec() {
    setDuzenlenenPaketId(null);
    setYeniPaketAdi("");
    setYeniAylikUcret("");
    setPaketTanimHata(null);
  }

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
  // Özel tutar yalnızca yöneticiye görünür; tek seferlik, paket tanımını değiştirmez.
  const ozelTutarSayi = Number(ozelTutar.replace(",", "."));
  const ozelTutarKurus =
    isAdmin && ozelTutar.trim() !== "" && Number.isFinite(ozelTutarSayi) && ozelTutarSayi >= 0
      ? Math.round(ozelTutarSayi * 100)
      : undefined;

  async function satinAl() {
    if (!seciliMusteri || !seciliPaketId) return;
    setHata(null);
    setBasari(null);
    setSatinAliniyor(true);
    try {
      const kayit = await api.purchasePackage(seciliMusteri.id, seciliPaketId, odemeTipi, ozelTutarKurus);
      setBasari(
        `"${kayit.ad}" paketi ${seciliMusteri.ad} ${seciliMusteri.soyad} için tanımlandı. ` +
          `${formatKurus(kayit.tutar_kurus)} (${odemeTipiEtiketi(kayit.odeme_tipi)}) tahsil edildi, ` +
          `${kayit.gecerlilik_bitis} tarihine kadar geçerli.`
      );
      setOzelTutar("");
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
    const bakiyeMi = yeniTur === "bakiye";
    const toplamSaat = Number(yeniToplamSaat.replace(",", "."));
    if (bakiyeMi) {
      if (!Number.isFinite(toplamSaat) || toplamSaat <= 0 || toplamSaat > 1000) {
        setPaketTanimHata("Süre 0'dan büyük olmalı.");
        return;
      }
    } else {
      if (!Number.isInteger(haftalikGun) || haftalikGun < 1 || haftalikGun > 7) {
        setPaketTanimHata("Haftalık gün 1 ile 7 arasında olmalı.");
        return;
      }
      if (!Number.isFinite(gunlukSaat) || gunlukSaat <= 0 || gunlukSaat > 24) {
        setPaketTanimHata("Günlük süre 0'dan büyük ve en fazla 24 saat olmalı.");
        return;
      }
    }
    if (!Number.isFinite(aylikUcret) || aylikUcret < 0) {
      setPaketTanimHata(bakiyeMi ? "Geçerli bir paket fiyatı girin." : "Geçerli bir aylık ücret girin.");
      return;
    }
    setPaketOlusturuluyor(true);
    try {
      const alanlar = [
        yeniPaketAdi.trim(),
        yeniGrup.trim() || "Standart",
        bakiyeMi ? 0 : haftalikGun,
        bakiyeMi ? 0 : Math.round(gunlukSaat * 60),
        Math.round(aylikUcret * 100),
        yeniTur,
        bakiyeMi ? Math.round(toplamSaat * 60) : 0,
      ] as const;
      if (duzenlenenPaketId !== null) {
        await api.updatePackageDefinition(duzenlenenPaketId, ...alanlar);
      } else {
        await api.createPackageDefinition(...alanlar);
      }
      duzenlemedenVazgec();
      await paketleriYukle();
    } catch (e) {
      setPaketTanimHata((e as Error).message);
    } finally {
      setPaketOlusturuluyor(false);
    }
  }

  // Bakiyesi biten saat bakiyeli paket aktif sayılmaz (sunucudaki mantıkla aynı).
  const aktifPaket = musteriPaketleri.find((p) => !p.suresi_dolmus_mu && (p.tur !== "bakiye" || (p.kalan_dakika ?? 0) > 0)) ?? null;

  return (
    <div className="page page--wide">
      <h1>Satın Alma</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Müşteriye paket tanımlayın. Abonelik paketi haftada belirli gün ve günde belirli süre
        kullanım hakkı verir; saat bakiyeli paket ise bakiye bitene kadar (1 ay içinde) istenen
        gün istenen kadar kullanılır ve her kullanımda kalan süre ile değer azalır. Ücret satın
        alma anında dondurulur ve o günün cirosuna eklenir. Kasiyer "Paketten Düş" ile kapatır.
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
                <th>Tür</th>
                <th>Hak</th>
                <th>Ücret</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {paketler.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.ad}</td>
                  <td>{p.grup}</td>
                  <td>{p.tur === "bakiye" ? "Saat bakiyeli" : "Abonelik"}</td>
                  <td>{hakMetni(p)}</td>
                  <td>{p.tur === "bakiye" ? formatKurus(p.aylik_ucret_kurus) : `${formatKurus(p.aylik_ucret_kurus)} / ay`}</td>
                  {isAdmin && (
                    <td>
                      <button className="ghost" onClick={() => duzenlemeyeBasla(p)}>Düzenle</button>
                    </td>
                  )}
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
                  Aktif paket: <strong>{aktifPaket.ad}</strong> ·{" "}
                  {aktifPaket.tur === "bakiye"
                    ? `Kalan: ${formatSureMetni(aktifPaket.kalan_dakika ?? 0)} · ${formatKurus(aktifPaket.kalan_deger_kurus ?? 0)} değerinde`
                    : `${hakMetni(aktifPaket)} · ${abonelikOzetiMetni(aktifPaket)}`}{" "}
                  · {aktifPaket.gecerlilik_bitis} tarihine kadar
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
                        {p.ad} (
                        {p.tur === "bakiye"
                          ? `${formatSureMetni(p.dakika ?? 0)} · ${formatKurus(p.aylik_ucret_kurus)}`
                          : `${p.haftalik_gun} gün / ${formatSureMetni(p.gunluk_dakika)}`}
                        )
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
                {isAdmin && (
                  <div className="field">
                    <label htmlFor="paket-ozel-tutar">Özel Tutar (TL)</label>
                    <input
                      id="paket-ozel-tutar"
                      type="text"
                      inputMode="decimal"
                      placeholder="Örn: 123,45"
                      value={ozelTutar}
                      onChange={(e) => setOzelTutar(e.target.value)}
                      style={{ maxWidth: 140 }}
                    />
                  </div>
                )}
                <div className="field">
                  <label>Tahsil Edilecek</label>
                  <div className="stat-card__value" style={{ fontSize: 20 }}>
                    {ozelTutarKurus !== undefined
                      ? formatKurus(ozelTutarKurus)
                      : seciliPaket
                        ? formatKurus(seciliPaket.aylik_ucret_kurus)
                        : "—"}
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
                  <th>Hak</th>
                  <th>Kalan</th>
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
                    <td>{hakMetni(p)}</td>
                    <td>
                      {p.tur === "bakiye"
                        ? `${formatSureMetni(p.kalan_dakika ?? 0)} · ${formatKurus(p.kalan_deger_kurus ?? 0)}`
                        : "—"}
                    </td>
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
          <h2>{duzenlenenPaketId !== null ? "Paketi Düzenle" : "Yeni Paket Türü Tanımla"}</h2>
          <div className="field-row" style={{ alignItems: "flex-end" }}>
            <div className="field">
              <label htmlFor="yeni-paket-tur">Tür</label>
              <select
                id="yeni-paket-tur"
                value={yeniTur}
                onChange={(e) => setYeniTur(e.target.value as "abonelik" | "bakiye")}
                style={{ maxWidth: 160 }}
              >
                <option value="abonelik">Abonelik</option>
                <option value="bakiye">Saat Bakiyeli</option>
              </select>
            </div>
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
            {yeniTur === "bakiye" ? (
              <div className="field">
                <label htmlFor="yeni-paket-toplam-saat">Süre (saat)</label>
                <input
                  id="yeni-paket-toplam-saat"
                  placeholder="Örn: 10"
                  value={yeniToplamSaat}
                  onChange={(e) => setYeniToplamSaat(e.target.value)}
                  style={{ maxWidth: 140 }}
                />
              </div>
            ) : (
              <>
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
              </>
            )}
            <div className="field">
              <label htmlFor="yeni-paket-ucret">{yeniTur === "bakiye" ? "Paket Fiyatı (TL)" : "Aylık Ücret (TL)"}</label>
              <input
                id="yeni-paket-ucret"
                placeholder="Örn: 14000"
                value={yeniAylikUcret}
                onChange={(e) => setYeniAylikUcret(e.target.value)}
                style={{ maxWidth: 160 }}
              />
            </div>
            <button onClick={paketTanimla} disabled={paketOlusturuluyor}>
              {paketOlusturuluyor ? "Kaydediliyor..." : duzenlenenPaketId !== null ? "Kaydet" : "Paket Türü Ekle"}
            </button>
            {duzenlenenPaketId !== null && (
              <button className="ghost" onClick={duzenlemedenVazgec} disabled={paketOlusturuluyor}>Vazgeç</button>
            )}
          </div>
          {paketTanimHata && <div className="alert alert--error" style={{ marginTop: 12 }}>{paketTanimHata}</div>}
        </div>
      )}
    </div>
  );
}
