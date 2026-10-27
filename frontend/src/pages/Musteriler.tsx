import { useEffect, useState } from "react";
import {
  api,
  formatSureMetni,
  getIsAdmin,
  type CustomerListItem,
  type CustomerPackage,
  type PackageStatus,
  type CustomerSession,
} from "../api/client";

function formatKurus(kurus: number) {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

function odemeTipiEtiket(tip?: string) {
  if (tip === "nakit") return <span className="badge badge--nakit">Nakit</span>;
  if (tip === "kredi_karti") return <span className="badge badge--kart">Kredi Kartı</span>;
  if (tip === "paket") return <span className="badge badge--nakit">Paket</span>;
  return <span className="muted">—</span>;
}

// Listedeki "Kalan Süre" kutusu: renk kalan hakka göre (yeşil / hardal / terracotta).
function kalanSureKutusu(d: PackageStatus | null) {
  if (!d) return <span className="muted">—</span>;
  let sinif = "badge--ok";
  let metin: string;
  if (d.tur === "bakiye") {
    const kalan = d.kalan_dakika ?? 0;
    const toplam = d.toplam_dakika ?? 0;
    metin = `${formatSureMetni(kalan)} kaldı`;
    if (kalan <= 0) sinif = "badge--bitti";
    else if (kalan <= toplam * 0.25) sinif = "badge--uyari";
  } else if (d.gun_hakki_doldu_mu) {
    sinif = (d.toplam_kalan_dakika ?? 0) > 0 ? "badge--uyari" : "badge--bitti";
    metin = `Bu hafta hak doldu · Toplam ${formatSureMetni(d.toplam_kalan_dakika ?? 0)}`;
  } else {
    const hafta = d.bu_hafta_kalan_dakika ?? 0;
    const toplam = d.toplam_kalan_dakika ?? 0;
    if (toplam <= 0) sinif = "badge--bitti";
    else if (hafta <= 0) sinif = "badge--uyari";
    metin = `Bu hafta ${formatSureMetni(hafta)} · Toplam ${formatSureMetni(toplam)}`;
  }
  return <span className={`badge ${sinif}`}>{metin}</span>;
}

function tcKimlikNoGecerliMi(tc: string): boolean {
  if (!/^\d{11}$/.test(tc)) return false;
  const haneler = tc.split("").map(Number);
  const ilk10Toplam = haneler.slice(0, 10).reduce((a, b) => a + b, 0);
  return ilk10Toplam % 10 === haneler[10];
}

function telefonGecerliMi(tel: string): boolean {
  return /^\d{10,11}$/.test(tel);
}

export default function Musteriler() {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [seciliMusteri, setSeciliMusteri] = useState<CustomerListItem | null>(null);
  const [gecmis, setGecmis] = useState<CustomerSession[]>([]);
  const [paketler, setPaketler] = useState<CustomerPackage[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [gecmisYukleniyor, setGecmisYukleniyor] = useState(false);
  const [indiriliyor, setIndiriliyor] = useState(false);

  const [duzenleniyor, setDuzenleniyor] = useState(false);
  const [duzenleAd, setDuzenleAd] = useState("");
  const [duzenleSoyad, setDuzenleSoyad] = useState("");
  const [duzenleTc, setDuzenleTc] = useState("");
  const [duzenleTelefon, setDuzenleTelefon] = useState("");
  const [duzenleVeliTelefon, setDuzenleVeliTelefon] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [duzenleHata, setDuzenleHata] = useState<string | null>(null);
  const [siliniyor, setSiliniyor] = useState(false);
  const [silmeOnayGosteriliyor, setSilmeOnayGosteriliyor] = useState(false);
  const isAdmin = getIsAdmin();

  const [yeniFormAcik, setYeniFormAcik] = useState(false);
  const [yeniAd, setYeniAd] = useState("");
  const [yeniSoyad, setYeniSoyad] = useState("");
  const [yeniTc, setYeniTc] = useState("");
  const [yeniTelefon, setYeniTelefon] = useState("");
  const [yeniVeliTelefon, setYeniVeliTelefon] = useState("");
  const [yeniKaydediliyor, setYeniKaydediliyor] = useState(false);
  const [yeniHata, setYeniHata] = useState<string | null>(null);
  const [yeniBasari, setYeniBasari] = useState<string | null>(null);

  function yeniFormuSifirla() {
    setYeniAd("");
    setYeniSoyad("");
    setYeniTc("");
    setYeniTelefon("");
    setYeniVeliTelefon("");
    setYeniHata(null);
  }

  function yeniFormGecerliMi() {
    return (
      yeniAd.trim() !== "" &&
      yeniSoyad.trim() !== "" &&
      tcKimlikNoGecerliMi(yeniTc) &&
      telefonGecerliMi(yeniTelefon) &&
      (yeniVeliTelefon === "" || telefonGecerliMi(yeniVeliTelefon))
    );
  }

  // Kasadan giriş yapılmadan, önceden müşteri kaydı oluşturur.
  async function yeniMusteriKaydet() {
    setYeniHata(null);
    setYeniBasari(null);
    setYeniKaydediliyor(true);
    try {
      const kayit = await api.createCustomer(
        yeniTc.trim(),
        yeniAd.trim(),
        yeniSoyad.trim(),
        yeniTelefon.trim(),
        yeniVeliTelefon.trim()
      );
      setYeniBasari(`${kayit.ad} ${kayit.soyad} kaydedildi.`);
      yeniFormuSifirla();
      setYeniFormAcik(false);
      await refresh();
    } catch (e) {
      setYeniHata((e as Error).message);
    } finally {
      setYeniKaydediliyor(false);
    }
  }

  async function refresh() {
    setYukleniyor(true);
    setHata(null);
    try {
      setCustomers(await api.listCustomers(query));
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(refresh, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (!seciliMusteri) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") kapat();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seciliMusteri]);

  async function musteriSec(c: CustomerListItem) {
    setSeciliMusteri(c);
    setGecmis([]);
    setPaketler([]);
    setGecmisYukleniyor(true);
    setHata(null);
    try {
      const [oturumlar, musteriPaketleri] = await Promise.all([
        api.getCustomerSessions(c.id),
        api.listCustomerPackages(c.id),
      ]);
      setGecmis(oturumlar);
      setPaketler(musteriPaketleri);
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setGecmisYukleniyor(false);
    }
  }

  function kapat() {
    setSeciliMusteri(null);
    setGecmis([]);
    setPaketler([]);
    setDuzenleniyor(false);
    setSilmeOnayGosteriliyor(false);
  }

  function duzenlemeyeBasla() {
    if (!seciliMusteri) return;
    setDuzenleAd(seciliMusteri.ad);
    setDuzenleSoyad(seciliMusteri.soyad);
    setDuzenleTc(seciliMusteri.tc_kimlik_no);
    setDuzenleTelefon(seciliMusteri.telefon);
    setDuzenleVeliTelefon(seciliMusteri.veli_telefon ?? "");
    setDuzenleHata(null);
    setDuzenleniyor(true);
  }

  async function duzenlemeyiKaydet() {
    if (!seciliMusteri) return;
    setDuzenleHata(null);
    setKaydediliyor(true);
    try {
      const guncel = await api.updateCustomer(
        seciliMusteri.id,
        duzenleTc.trim(),
        duzenleAd.trim(),
        duzenleSoyad.trim(),
        duzenleTelefon.trim(),
        duzenleVeliTelefon.trim()
      );
      const guncelMusteri: CustomerListItem = {
        ...seciliMusteri,
        ad: guncel.ad,
        soyad: guncel.soyad,
        tc_kimlik_no: guncel.tc_kimlik_no,
        telefon: guncel.telefon,
        veli_telefon: guncel.veli_telefon,
      };
      setSeciliMusteri(guncelMusteri);
      setCustomers((prev) => prev.map((c) => (c.id === guncelMusteri.id ? guncelMusteri : c)));
      setDuzenleniyor(false);
    } catch (e) {
      setDuzenleHata((e as Error).message);
    } finally {
      setKaydediliyor(false);
    }
  }

  async function musteriSil() {
    if (!seciliMusteri) return;
    setSiliniyor(true);
    setHata(null);
    try {
      await api.deleteCustomer(seciliMusteri.id);
      setCustomers((prev) => prev.filter((c) => c.id !== seciliMusteri.id));
      kapat();
    } catch (e) {
      setHata((e as Error).message);
      setSilmeOnayGosteriliyor(false);
    } finally {
      setSiliniyor(false);
    }
  }

  async function pdfIndir() {
    if (!seciliMusteri) return;
    setIndiriliyor(true);
    setHata(null);
    try {
      await api.exportCustomerPDF(seciliMusteri.id);
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setIndiriliyor(false);
    }
  }

  return (
    <div className="page page--wide">
      <h1>Müşteriler</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Kayıtlı müşterileri arayın; geçmiş işlemlerini görmek için bir satıra tıklayın.
      </p>

      {hata && !seciliMusteri && <div className="alert alert--error">{hata}</div>}
      {yeniBasari && <div className="alert alert--success">{yeniBasari}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ marginBottom: 0 }}>Yeni Müşteri</h2>
          <button
            className={yeniFormAcik ? "ghost" : ""}
            onClick={() => {
              setYeniBasari(null);
              if (yeniFormAcik) yeniFormuSifirla();
              setYeniFormAcik((v) => !v);
            }}
          >
            {yeniFormAcik ? "Vazgeç" : "Yeni Müşteri Ekle"}
          </button>
        </div>

        {yeniFormAcik && (
          <div style={{ marginTop: 16 }}>
            <p className="muted" style={{ marginBottom: 12 }}>
              Müşteriyi kasaya girmeden önceden kaydedin. Kayıt sonrası kasa ekranından TC, telefon
              ya da isimle bulunup giriş yapılabilir.
            </p>
            {yeniHata && <div className="alert alert--error">{yeniHata}</div>}
            <div className="field-row">
              <div className="field">
                <label htmlFor="yeni-ad">Ad</label>
                <input id="yeni-ad" placeholder="Ad" value={yeniAd} onChange={(e) => setYeniAd(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="yeni-soyad">Soyad</label>
                <input
                  id="yeni-soyad"
                  placeholder="Soyad"
                  value={yeniSoyad}
                  onChange={(e) => setYeniSoyad(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="yeni-tc">TC Kimlik No</label>
                <input
                  id="yeni-tc"
                  placeholder="12345678901"
                  value={yeniTc}
                  inputMode="numeric"
                  maxLength={11}
                  onChange={(e) => setYeniTc(e.target.value.replace(/\D/g, "").slice(0, 11))}
                />
                {yeniTc.length === 11 && !tcKimlikNoGecerliMi(yeniTc) && (
                  <p style={{ color: "var(--terracotta-dark)", fontSize: 12, marginTop: 4 }}>
                    Geçersiz TC Kimlik No
                  </p>
                )}
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="yeni-telefon">Telefon</label>
                <input
                  id="yeni-telefon"
                  placeholder="05xxxxxxxxx"
                  value={yeniTelefon}
                  inputMode="numeric"
                  maxLength={11}
                  onChange={(e) => setYeniTelefon(e.target.value.replace(/\D/g, "").slice(0, 11))}
                />
                {yeniTelefon.length > 0 && !telefonGecerliMi(yeniTelefon) && (
                  <p style={{ color: "var(--terracotta-dark)", fontSize: 12, marginTop: 4 }}>
                    Geçersiz telefon numarası (10-11 haneli olmalı)
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="yeni-veli-telefon">Veli Telefonu (opsiyonel)</label>
                <input
                  id="yeni-veli-telefon"
                  placeholder="05xxxxxxxxx"
                  value={yeniVeliTelefon}
                  inputMode="numeric"
                  maxLength={11}
                  onChange={(e) => setYeniVeliTelefon(e.target.value.replace(/\D/g, "").slice(0, 11))}
                />
                {yeniVeliTelefon.length > 0 && !telefonGecerliMi(yeniVeliTelefon) && (
                  <p style={{ color: "var(--terracotta-dark)", fontSize: 12, marginTop: 4 }}>
                    Geçersiz telefon numarası (10-11 haneli olmalı)
                  </p>
                )}
              </div>
            </div>
            <div className="field-row">
              <button onClick={yeniMusteriKaydet} disabled={yeniKaydediliyor || !yeniFormGecerliMi()}>
                {yeniKaydediliyor ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="field">
          <label>Ara (ad, soyad, TC kimlik no veya telefon)</label>
          <input
            placeholder="Örn: Ahmet ya da 12345678901"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 320 }}
          />
        </div>
      </div>

      <div className="card">
        <h2>Müşteri Listesi ({customers.length})</h2>
        {yukleniyor && <p className="muted">Yükleniyor...</p>}
        {!yukleniyor && customers.length === 0 && <p className="muted">Kayıt bulunamadı.</p>}
        {!yukleniyor && customers.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Ad Soyad</th>
                <th>TC Kimlik No</th>
                <th>Telefon</th>
                <th>Veli Telefonu</th>
                <th>Ziyaret</th>
                <th>Toplam Harcama</th>
                <th>Aktif Paket</th>
                <th>Kalan Süre</th>
                <th>Son Ziyaret</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} onClick={() => musteriSec(c)} style={{ cursor: "pointer" }}>
                  <td>
                    {c.ad} {c.soyad}
                    {c.acik_oturum_var && (
                      <span className="badge badge--nakit" style={{ marginLeft: 8 }}>İçeride</span>
                    )}
                  </td>
                  <td>{c.tc_kimlik_no}</td>
                  <td>{c.telefon || "—"}</td>
                  <td>{c.veli_telefon || "—"}</td>
                  <td>{c.toplam_oturum}</td>
                  <td>{formatKurus(c.toplam_harcama_kurus)}</td>
                  <td>{c.aktif_paket ?? "—"}</td>
                  <td>{kalanSureKutusu(c.aktif_paket_durumu)}</td>
                  <td>{c.son_ziyaret ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {seciliMusteri && (
        <div className="modal-overlay" onClick={kapat}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div>
                <h2 style={{ marginBottom: 4 }}>{seciliMusteri.ad} {seciliMusteri.soyad}</h2>
                <p className="muted">
                  TC: {seciliMusteri.tc_kimlik_no} · Tel: {seciliMusteri.telefon || "—"}
                  {seciliMusteri.veli_telefon && <> · Veli Tel: {seciliMusteri.veli_telefon}</>}
                </p>
                <p className="muted">
                  Aktif Paket: <strong>{seciliMusteri.aktif_paket ?? "Yok"}</strong>
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {!duzenleniyor && (
                  <button className="secondary" onClick={duzenlemeyeBasla}>✏️ Düzenle</button>
                )}
                <button className="accent" onClick={pdfIndir} disabled={indiriliyor}>
                  {indiriliyor ? "İndiriliyor..." : "📄 PDF Olarak İndir"}
                </button>
                {isAdmin && (
                  <button className="ghost" onClick={() => setSilmeOnayGosteriliyor(true)} disabled={siliniyor}>
                    {siliniyor ? "Siliniyor..." : "🗑️ Sil"}
                  </button>
                )}
                <button className="ghost" onClick={kapat}>Kapat</button>
              </div>
            </div>

            {hata && <div className="alert alert--error">{hata}</div>}

            {silmeOnayGosteriliyor && (
              <div className="card" style={{ marginBottom: 16, background: "var(--cream-soft)" }}>
                <p style={{ marginBottom: 12 }}>
                  <strong>{seciliMusteri.ad} {seciliMusteri.soyad}</strong> kaydını silmek istediğinize emin misiniz?
                </p>
                <div className="field-row">
                  <button onClick={musteriSil} disabled={siliniyor}>
                    {siliniyor ? "Siliniyor..." : "Evet, Sil"}
                  </button>
                  <button className="ghost" onClick={() => setSilmeOnayGosteriliyor(false)} disabled={siliniyor}>
                    Vazgeç
                  </button>
                </div>
              </div>
            )}

            {duzenleniyor && (
              <div className="card" style={{ marginBottom: 16, background: "var(--cream-soft)" }}>
                <h2 style={{ fontSize: 16 }}>Müşteri Bilgilerini Düzenle</h2>
                <div className="field-row">
                  <div className="field">
                    <label>Ad</label>
                    <input value={duzenleAd} onChange={(e) => setDuzenleAd(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Soyad</label>
                    <input value={duzenleSoyad} onChange={(e) => setDuzenleSoyad(e.target.value)} />
                  </div>
                </div>
                <div className="field-row" style={{ marginTop: 12 }}>
                  <div className="field">
                    <label>TC Kimlik No</label>
                    <input
                      value={duzenleTc}
                      inputMode="numeric"
                      maxLength={11}
                      onChange={(e) => setDuzenleTc(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    />
                    {duzenleTc.length === 11 && !tcKimlikNoGecerliMi(duzenleTc) && (
                      <p style={{ color: "var(--terracotta-dark)", fontSize: 12, marginTop: 4 }}>
                        Geçersiz TC Kimlik No
                      </p>
                    )}
                  </div>
                  <div className="field">
                    <label>Telefon</label>
                    <input
                      value={duzenleTelefon}
                      inputMode="numeric"
                      maxLength={11}
                      onChange={(e) => setDuzenleTelefon(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    />
                    {duzenleTelefon.length > 0 && !telefonGecerliMi(duzenleTelefon) && (
                      <p style={{ color: "var(--terracotta-dark)", fontSize: 12, marginTop: 4 }}>
                        Geçersiz telefon numarası
                      </p>
                    )}
                  </div>
                  <div className="field">
                    <label>Veli Telefonu (opsiyonel)</label>
                    <input
                      value={duzenleVeliTelefon}
                      inputMode="numeric"
                      maxLength={11}
                      onChange={(e) => setDuzenleVeliTelefon(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    />
                    {duzenleVeliTelefon.length > 0 && !telefonGecerliMi(duzenleVeliTelefon) && (
                      <p style={{ color: "var(--terracotta-dark)", fontSize: 12, marginTop: 4 }}>
                        Geçersiz telefon numarası
                      </p>
                    )}
                  </div>
                </div>
                {duzenleHata && <div className="alert alert--error" style={{ marginTop: 12 }}>{duzenleHata}</div>}
                <div className="field-row" style={{ marginTop: 12 }}>
                  <button
                    onClick={duzenlemeyiKaydet}
                    disabled={
                      kaydediliyor ||
                      !duzenleAd.trim() ||
                      !duzenleSoyad.trim() ||
                      !tcKimlikNoGecerliMi(duzenleTc) ||
                      !telefonGecerliMi(duzenleTelefon) ||
                      (duzenleVeliTelefon.length > 0 && !telefonGecerliMi(duzenleVeliTelefon))
                    }
                  >
                    {kaydediliyor ? "Kaydediliyor..." : "Kaydet"}
                  </button>
                  <button className="ghost" onClick={() => setDuzenleniyor(false)}>İptal</button>
                </div>
              </div>
            )}

            {gecmisYukleniyor && <p className="muted">Yükleniyor...</p>}
            {!gecmisYukleniyor && gecmis.length === 0 && <p className="muted">Bu müşteriye ait işlem yok.</p>}
            {!gecmisYukleniyor && gecmis.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Giriş</th>
                    <th>Çıkış</th>
                    <th>Süre</th>
                    <th>Tutar</th>
                    <th>Ödeme</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {gecmis.map((s) => (
                    <tr key={s.id}>
                      <td>{s.giris_zamani}</td>
                      <td>{s.cikis_zamani ?? "—"}</td>
                      <td>{s.toplam_dakika != null ? formatSureMetni(s.toplam_dakika) : "—"}</td>
                      <td>{s.tahsil_tutar_kurus != null ? formatKurus(s.tahsil_tutar_kurus) : "—"}</td>
                      <td>{odemeTipiEtiket(s.odeme_tipi)}</td>
                      <td>
                        {s.durum === "acik" ? (
                          <span className="badge badge--nakit">Açık</span>
                        ) : s.manuel_kapatildi ? (
                          <span className="muted">Kapalı (elle)</span>
                        ) : (
                          <span className="muted">Kapalı</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {paketler.length > 0 && (
              <>
                <h2 style={{ fontSize: 16, marginTop: 20 }}>Paketler</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Paket</th>
                      <th>Haftalık Gün</th>
                      <th>Günlük Süre</th>
                      <th>Tutar</th>
                      <th>Geçerlilik Bitişi</th>
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paketler.map((p) => (
                      <tr key={p.id}>
                        <td>{p.ad}</td>
                        <td>{p.tur === "bakiye" ? "Saat bakiyeli" : `${p.haftalik_gun} gün`}</td>
                        <td>
                          {p.tur === "bakiye"
                            ? `Kalan: ${formatSureMetni(p.kalan_dakika ?? 0)} / ${formatSureMetni(p.toplam_dakika ?? 0)} · ${formatKurus(p.kalan_deger_kurus ?? 0)}`
                            : p.suresi_dolmus_mu
                              ? formatSureMetni(p.gunluk_dakika)
                              : `${formatSureMetni(p.gunluk_dakika)} · Bu hafta kalan: ${formatSureMetni(p.bu_hafta_kalan_dakika ?? 0)} · Paketten kalan toplam: ${formatSureMetni(p.toplam_kalan_dakika ?? 0)}`}
                        </td>
                        <td>{formatKurus(p.tutar_kurus)}</td>
                        <td>{p.gecerlilik_bitis}</td>
                        <td>
                          {p.suresi_dolmus_mu ? (
                            <span className="muted">Süresi Doldu</span>
                          ) : p.tur === "bakiye" && !p.kalan_dakika ? (
                            <span className="muted">Bakiye Bitti</span>
                          ) : (
                            <span className="badge badge--nakit">Aktif</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
