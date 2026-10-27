import { useEffect, useState } from "react";
import {
  api,
  abonelikOzetiMetni,
  formatSureMetni,
  tierUcretiHesapla,
  type CustomerListItem,
  type OpenSession,
  type PackageStatus,
  type PricingPolicy,
} from "../api/client";
import { useAuth } from "../context/AuthContext";

type Asama = "sorgu" | "bulundu" | "kayit_gerekli";
type SorguTipi = "tc" | "telefon" | "ad";

function formatKurus(kurus: number) {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

// Backend'deki RoundDownToTen ile aynı mantık: en yakın 10 TL'ye aşağı yuvarlar.
function yuvarlaKurus(kurus: number): number {
  const lira = Math.floor(kurus / 100);
  return Math.floor(lira / 10) * 10 * 100;
}


// TC Kimlik No doğrulaması: tam 11 haneli olmalı ve ilk 10 hanenin toplamının
// birler basamağı 11. haneye eşit olmalıdır.
function tcKimlikNoGecerliMi(tc: string): boolean {
  if (!/^\d{11}$/.test(tc)) return false;
  const haneler = tc.split("").map(Number);
  const ilk10Toplam = haneler.slice(0, 10).reduce((a, b) => a + b, 0);
  return ilk10Toplam % 10 === haneler[10];
}

// Telefon numarası: 10 ya da 11 haneli olmalıdır (başında 0 olsun olmasın).
function telefonGecerliMi(tel: string): boolean {
  return /^\d{10,11}$/.test(tel);
}

export default function KasaEkrani() {
  const [sessions, setSessions] = useState<OpenSession[]>([]);
  const [asama, setAsama] = useState<Asama>("sorgu");
  const [sorguTipi, setSorguTipi] = useState<SorguTipi>("tc");
  const [tcKimlikNo, setTcKimlikNo] = useState("");
  const [ad, setAd] = useState("");
  const [soyad, setSoyad] = useState("");
  const [telefon, setTelefon] = useState("");
  const [veliTelefon, setVeliTelefon] = useState("");
  const [telefonKayitliUyari, setTelefonKayitliUyari] = useState<string | null>(null);
  const [telefonKontrolEdiliyor, setTelefonKontrolEdiliyor] = useState(false);
  const [sorgulaniyor, setSorgulaniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);

  const [adAramaMetin, setAdAramaMetin] = useState("");
  const [adAramaSonuclari, setAdAramaSonuclari] = useState<CustomerListItem[]>([]);
  const [adAramaYukleniyor, setAdAramaYukleniyor] = useState(false);
  const [hizliGirisId, setHizliGirisId] = useState<number | null>(null);

  const [pricingPolicy, setPricingPolicy] = useState<PricingPolicy | null>(null);
  const [seciliSessionId, setSeciliSessionId] = useState<number | null>(null);
  const [simdi, setSimdi] = useState(() => Date.now());
  const [kapatiliyor, setKapatiliyor] = useState(false);
  const [yuvarla, setYuvarla] = useState(false);

  const [indirimAcik, setIndirimAcik] = useState(false);
  const [indirimTipi, setIndirimTipi] = useState<"tutar" | "yuzde">("tutar");
  const [indirimDeger, setIndirimDeger] = useState("");
  const { isAdmin } = useAuth();
  const [ozelTutar, setOzelTutar] = useState("");

  const [paketDurumu, setPaketDurumu] = useState<PackageStatus | null>(null);

  const [sureSecimi, setSureSecimi] = useState<number | null>(null);

  const [suresiDolanUyari, setSuresiDolanUyari] = useState<OpenSession | null>(null);
  const [uyariGosterilenIdler, setUyariGosterilenIdler] = useState<Set<number>>(new Set());
  const [uzatiliyor, setUzatiliyor] = useState(false);
  const [asimOnayAcik, setAsimOnayAcik] = useState(false);

  const [gunAcik, setGunAcik] = useState<boolean | null>(null);

  async function refresh() {
    try {
      setSessions(await api.listOpenSessions());
    } catch (e) {
      setHata((e as Error).message);
    }
  }

  async function gunDurumunuKontrolEt() {
    try {
      const durum = await api.getCurrentBusinessDay();
      setGunAcik(durum.acik);
    } catch {
      setGunAcik(null);
    }
  }

  useEffect(() => {
    refresh();
    gunDurumunuKontrolEt();
    api.getActivePricingPolicy().then(setPricingPolicy).catch(() => {});
    const interval = setInterval(() => {
      refresh();
      gunDurumunuKontrolEt();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (sorguTipi !== "ad" || asama !== "sorgu") return;
    const q = adAramaMetin.trim();
    if (q.length < 2) {
      setAdAramaSonuclari([]);
      return;
    }
    let iptal = false;
    setAdAramaYukleniyor(true);
    const timeout = setTimeout(() => {
      api
        .listCustomers(q)
        .then((sonuc) => {
          if (!iptal) setAdAramaSonuclari(sonuc.slice(0, 8));
        })
        .catch((e) => {
          if (!iptal) setHata((e as Error).message);
        })
        .finally(() => {
          if (!iptal) setAdAramaYukleniyor(false);
        });
    }, 300);
    return () => {
      iptal = true;
      clearTimeout(timeout);
    };
  }, [adAramaMetin, sorguTipi, asama]);

  function sifirla() {
    setAsama("sorgu");
    setSorguTipi("tc");
    setTcKimlikNo("");
    setAd("");
    setSoyad("");
    setTelefon("");
    setVeliTelefon("");
    setTelefonKayitliUyari(null);
    setAdAramaMetin("");
    setAdAramaSonuclari([]);
    setSureSecimi(null);
  }

  // Arama sonuçlarından bir müşteriye tıklanınca, ayrıca sorgulamaya gerek
  // kalmadan doğrudan giriş yapılır (mevcut kayıttaki bilgilerle).
  async function hizliGirisYap(musteri: CustomerListItem) {
    if (musteri.acik_oturum_var) return;
    setHata(null);
    setHizliGirisId(musteri.id);
    try {
      await api.startSession(
        musteri.tc_kimlik_no,
        musteri.ad,
        musteri.soyad,
        musteri.telefon,
        musteri.veli_telefon ?? "",
        sureSecimi
      );
      sifirla();
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setHizliGirisId(null);
    }
  }

  async function sorgula() {
    const sorguDegeri = sorguTipi === "tc" ? tcKimlikNo.trim() : telefon.trim();
    if (!sorguDegeri) {
      setHata(sorguTipi === "tc" ? "TC kimlik no girin." : "Telefon numarası girin.");
      return;
    }
    if (sorguTipi === "tc" && !tcKimlikNoGecerliMi(sorguDegeri)) {
      setHata("Geçersiz TC Kimlik No. 11 haneli olmalı ve doğrulama kuralını sağlamalıdır.");
      return;
    }
    if (sorguTipi === "telefon" && !telefonGecerliMi(sorguDegeri)) {
      setHata("Geçersiz telefon numarası. 10-11 haneli olmalıdır.");
      return;
    }
    setHata(null);
    setSorgulaniyor(true);
    try {
      const sonuc =
        sorguTipi === "tc"
          ? await api.lookupCustomerByTC(sorguDegeri)
          : await api.lookupCustomerByPhone(sorguDegeri);
      if (sonuc.bulundu && sonuc.musteri) {
        setTcKimlikNo(sonuc.musteri.tc_kimlik_no);
        setAd(sonuc.musteri.ad);
        setSoyad(sonuc.musteri.soyad);
        setTelefon(sonuc.musteri.telefon ?? "");
        setVeliTelefon(sonuc.musteri.veli_telefon ?? "");
        setAsama("bulundu");
      } else {
        if (sorguTipi === "tc") {
          setTelefon("");
        } else {
          setTcKimlikNo("");
        }
        setAd("");
        setSoyad("");
        setVeliTelefon("");
        setAsama("kayit_gerekli");
      }
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setSorgulaniyor(false);
    }
  }

  // Yeni kayıt sırasında girilen telefon numarasının başka bir müşteriye
  // (farklı TC kimlik no) ait olup olmadığını kontrol eder — TC kontrolüyle aynı mantık.
  async function telefonKontrolEt(tel: string) {
    setTelefonKayitliUyari(null);
    if (!telefonGecerliMi(tel)) return;
    setTelefonKontrolEdiliyor(true);
    try {
      const sonuc = await api.lookupCustomerByPhone(tel);
      if (sonuc.bulundu && sonuc.musteri && sonuc.musteri.tc_kimlik_no !== tcKimlikNo.trim()) {
        setTelefonKayitliUyari(
          `Bu telefon numarası ${sonuc.musteri.ad} ${sonuc.musteri.soyad} adına kayıtlı.`
        );
      }
    } catch {
      // sessizce geç: telefon kontrolü giriş yapmayı engellemesin, sunucu tarafı zaten tekilliği doğrular
    } finally {
      setTelefonKontrolEdiliyor(false);
    }
  }

  async function girisYap() {
    setHata(null);
    try {
      await api.startSession(tcKimlikNo.trim(), ad, soyad, telefon.trim(), veliTelefon.trim(), sureSecimi);
      sifirla();
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    }
  }

  function seciliSessionSifirla() {
    setSeciliSessionId(null);
    setYuvarla(false);
    setIndirimAcik(false);
    setIndirimTipi("tutar");
    setIndirimDeger("");
    setOzelTutar("");
    setPaketDurumu(null);
    setAsimOnayAcik(false);
  }

  // Seçilen oturumun müşterisinin abonelik durumu (bu hafta kaç gün kullandı,
  // bugün ne kadar hakkı kaldı) kasiyere gösterilmek üzere alınır.
  useEffect(() => {
    const session = sessions.find((s) => s.id === seciliSessionId);
    if (!session) {
      setPaketDurumu(null);
      return;
    }
    let iptal = false;
    api
      .getCustomerPackageStatus(session.customer_id)
      .then((sonuc) => {
        if (!iptal) setPaketDurumu(sonuc);
      })
      .catch(() => {
        if (!iptal) setPaketDurumu(null);
      });
    return () => {
      iptal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seciliSessionId]);

  // paketModu: "" normal tahsilat, "ucretsiz" tamamı pakete sayılır,
  // "asim" günlük hak kadarı pakete sayılıp aşan süre tahsil edilir.
  async function odendiIsaretle(
    id: number,
    odemeTipi: "nakit" | "kredi_karti" | "paket",
    paketModu: "" | "ucretsiz" | "asim" = ""
  ) {
    setHata(null);
    setBilgi(null);
    setKapatiliyor(true);
    try {
      const sonuc = await api.closeSession(
        id,
        odemeTipi,
        paketModu === "ucretsiz" ? false : yuvarla,
        paketModu === "ucretsiz" ? 0 : indirimKurus,
        paketModu,
        paketModu === "ucretsiz" ? undefined : ozelTutarKurus
      );
      if (sonuc.silindi) {
        setBilgi("Oturum 1 dakikadan kısa sürdüğü için ücretsiz kapatıldı (kayıt silindi); paketten düşülmedi ve ücret alınmadı.");
      }
      seciliSessionSifirla();
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setKapatiliyor(false);
    }
  }

  // Süreli açılan (sure_secimi_dakika seçilmiş) bir oturumda müşteri hâlâ
  // içeride iken ödemeyi erkenden almak için kullanılır. Oturum "acik"
  // kalmaya devam eder; tutar seçilen (rezerve) süre üzerinden hesaplanır.
  async function erkenOdeIsaretle(id: number, odemeTipi: "nakit" | "kredi_karti" | "paket") {
    setHata(null);
    setKapatiliyor(true);
    try {
      await api.payEarlySession(id, odemeTipi, odemeTipi === "paket" ? false : yuvarla, odemeTipi === "paket" ? 0 : indirimKurus, ozelTutarKurus);
      seciliSessionSifirla();
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setKapatiliyor(false);
    }
  }

  // Ödemesi erkenden alınmış bir oturumda müşteri gerçekten çıktığında
  // oturumu kapatmak için kullanılır; tutar yeniden hesaplanmaz.
  async function cikisYaptiIsaretle(id: number) {
    setHata(null);
    setKapatiliyor(true);
    try {
      await api.checkOutSession(id);
      seciliSessionSifirla();
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setKapatiliyor(false);
    }
  }

  // Süresi dolan (veya dolmak üzere olan) süreli bir oturumun rezerve
  // edilen süresini uzatır. Ödemesi zaten erkenden alınmış oturumlarda
  // sunucu bu işlemi reddeder (bkz. ExtendSessionDuration).
  async function sureUzat(id: number, ekDakika: number) {
    setHata(null);
    setUzatiliyor(true);
    try {
      await api.extendSessionDuration(id, ekDakika);
      setSuresiDolanUyari(null);
      setUyariGosterilenIdler((prev) => {
        const kopya = new Set(prev);
        kopya.delete(id);
        return kopya;
      });
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setUzatiliyor(false);
    }
  }

  const seciliSession = sessions.find((s) => s.id === seciliSessionId) ?? null;
  const canliDakika = seciliSession
    ? Math.max(0, Math.floor((simdi - new Date(seciliSession.giris_zamani).getTime()) / 60000))
    : 0;
  const seciliSuresiDoldu =
    seciliSession?.sure_secimi_dakika != null && canliDakika >= seciliSession.sure_secimi_dakika;

  // Müşteri girişinde "Kalış Süresi" seçildiğinde, o süre için tahsil
  // edilecek tutarı önceden gösterir (erken ödemede de aynı süre ücretlendirilir).
  const seciliSureTutari = sureSecimi != null ? tierUcretiHesapla(sureSecimi, pricingPolicy) : null;

  function satirCanliDakika(s: OpenSession) {
    return Math.max(0, Math.floor((simdi - new Date(s.giris_zamani).getTime()) / 60000));
  }

  function suresiDolduMu(s: OpenSession) {
    return s.sure_secimi_dakika != null && satirCanliDakika(s) >= s.sure_secimi_dakika;
  }

  // Süresi yeni dolan bir oturum tespit edildiğinde tam ekran bir uyarı
  // penceresi gösterir; aynı oturum için tekrar tekrar açılmaması için
  // gösterilen oturum id'leri ayrıca izlenir.
  useEffect(() => {
    if (suresiDolanUyari) return;
    const yeniSuresiDolan = sessions.find((s) => suresiDolduMu(s) && !uyariGosterilenIdler.has(s.id));
    if (yeniSuresiDolan) {
      setSuresiDolanUyari(yeniSuresiDolan);
      setUyariGosterilenIdler((prev) => new Set(prev).add(yeniSuresiDolan.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, simdi]);

  // Paketli müşteride günlük hakkı aşan süre ve bunun ücreti; kararı kasiyer verir.
  const paketVar = paketDurumu?.var === true;
  const paketKalanGunlukDakika = paketDurumu?.kalan_gunluk_dakika ?? 0;
  const paketAsanDakika = paketVar ? Math.max(0, canliDakika - paketKalanGunlukDakika) : 0;
  const bakiyePaketi = paketDurumu?.tur === "bakiye";
  const paketAsanTutar = paketAsanDakika > 0 ? tierUcretiHesapla(paketAsanDakika, pricingPolicy) : null;
  // Abonelikte ücretsiz düşmeden önce kasiyere gösterilen uyarı: günlük süre aşımı ya da haftalık gün hakkı dolması.
  const abonelikUyarisi = paketVar && !bakiyePaketi && (paketAsanDakika > 0 || paketDurumu?.gun_hakki_doldu_mu === true);

  const tahminiTutarHam = tierUcretiHesapla(canliDakika, pricingPolicy);
  const yuvarlanmisTutar = tahminiTutarHam != null && yuvarla ? yuvarlaKurus(tahminiTutarHam) : tahminiTutarHam;

  const indirimDegerSayi = Number(indirimDeger.replace(",", "."));
  let indirimKurus = 0;
  if (indirimAcik && yuvarlanmisTutar != null && Number.isFinite(indirimDegerSayi) && indirimDegerSayi > 0) {
    indirimKurus =
      indirimTipi === "tutar"
        ? Math.round(indirimDegerSayi * 100)
        : Math.round(yuvarlanmisTutar * (indirimDegerSayi / 100));
    if (indirimKurus > yuvarlanmisTutar) indirimKurus = yuvarlanmisTutar;
  }
  // Özel tutar (yalnızca yönetici): doluysa yuvarlama/indirim yok sayılır, tahsilat bu tutardır.
  const ozelTutarSayi = Number(ozelTutar.replace(",", "."));
  const ozelTutarKurus =
    isAdmin && ozelTutar.trim() !== "" && Number.isFinite(ozelTutarSayi) && ozelTutarSayi >= 0
      ? Math.round(ozelTutarSayi * 100)
      : undefined;
  const tahminiTutar =
    ozelTutarKurus ?? (yuvarlanmisTutar != null ? yuvarlanmisTutar - indirimKurus : null);

  return (
    <div className="page">
      <h1>Kasa Ekranı</h1>
      <p className="muted" style={{ marginBottom: 20 }}>Müşteri giriş/çıkışını ve içeride geçen süreyi buradan yönetin.</p>

      {hata && <div className="alert alert--error">{hata}</div>}
      {bilgi && <div className="alert alert--success">{bilgi}</div>}

      {gunAcik === false && (
        <div className="alert alert--error">
          Gün henüz başlamadı. Müşteri girişi kabul edilemez — önce "Gün Sonu" ekranından "Gün Başı Yap"ı çalıştırın.
        </div>
      )}

      <div className="card">
        <h2>Müşteri Girişi</h2>

        {gunAcik === false ? (
          <p className="muted">Güne başlamadan müşteri girişi yapılamaz.</p>
        ) : (
          <>
            <div className="field-row" style={{ marginBottom: 16, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 14 }}>Kalış Süresi:</span>
              <button className={sureSecimi === null ? "" : "ghost"} onClick={() => setSureSecimi(null)}>
                Kaldığı Süre Kadar
              </button>
              {/* Saat ve dakika ayrı seçilir; ikisi de 0 ise süre seçilmemiş sayılır
                  ("Kaldığı Süre Kadar"). Sunucu 0'dan büyük her dakikayı kabul eder. */}
              <select
                id="kalis-suresi-saat"
                aria-label="Kalış süresi (saat)"
                value={Math.floor((sureSecimi ?? 0) / 60)}
                onChange={(e) => {
                  const toplam = Number(e.target.value) * 60 + ((sureSecimi ?? 0) % 60);
                  setSureSecimi(toplam > 0 ? toplam : null);
                }}
                style={{ width: "auto" }}
              >
                {Array.from({ length: 13 }, (_, saat) => (
                  <option key={saat} value={saat}>
                    {saat} saat
                  </option>
                ))}
              </select>
              <select
                id="kalis-suresi-dakika"
                aria-label="Kalış süresi (dakika)"
                value={(sureSecimi ?? 0) % 60}
                onChange={(e) => {
                  const toplam = Math.floor((sureSecimi ?? 0) / 60) * 60 + Number(e.target.value);
                  setSureSecimi(toplam > 0 ? toplam : null);
                }}
                style={{ width: "auto" }}
              >
                {Array.from({ length: 12 }, (_, i) => i * 5).map((dk) => (
                  <option key={dk} value={dk}>
                    {dk} dk
                  </option>
                ))}
              </select>
              {sureSecimi != null && (
                <span style={{ fontWeight: 600 }}>
                  {formatSureMetni(sureSecimi)} ·{" "}
                  {seciliSureTutari != null ? `Tutar: ${formatKurus(seciliSureTutari)}` : "Tutar: —"}
                </span>
              )}
            </div>

            {asama === "sorgu" && (
              <div>
                <div className="field-row" style={{ marginBottom: 12 }}>
                  <button
                    className={sorguTipi === "tc" ? "" : "ghost"}
                    onClick={() => {
                      setSorguTipi("tc");
                      setHata(null);
                    }}
                  >
                    TC Kimlik No ile
                  </button>
                  <button
                    className={sorguTipi === "telefon" ? "" : "ghost"}
                    onClick={() => {
                      setSorguTipi("telefon");
                      setHata(null);
                    }}
                  >
                    Telefon ile
                  </button>
                  <button
                    className={sorguTipi === "ad" ? "" : "ghost"}
                    onClick={() => {
                      setSorguTipi("ad");
                      setHata(null);
                    }}
                  >
                    İsim ile Ara
                  </button>
                </div>
                {sorguTipi === "ad" ? (
                  <div>
                    <div className="field">
                      <label>Müşteri Ara (ad, soyad, TC veya telefon)</label>
                      <input
                        placeholder="Örn: Ahmet Yılmaz"
                        value={adAramaMetin}
                        onChange={(e) => setAdAramaMetin(e.target.value)}
                        autoFocus
                      />
                    </div>
                    {adAramaYukleniyor && <p className="muted" style={{ marginTop: 8 }}>Aranıyor...</p>}
                    {!adAramaYukleniyor && adAramaMetin.trim().length >= 2 && adAramaSonuclari.length === 0 && (
                      <p className="muted" style={{ marginTop: 8 }}>Eşleşen müşteri bulunamadı.</p>
                    )}
                    {adAramaSonuclari.length > 0 && (
                      <table style={{ marginTop: 8 }}>
                        <tbody>
                          {adAramaSonuclari.map((m) => (
                            <tr
                              key={m.id}
                              onClick={() => hizliGirisYap(m)}
                              style={{
                                cursor: m.acik_oturum_var ? "not-allowed" : "pointer",
                                opacity: hizliGirisId != null && hizliGirisId !== m.id ? 0.5 : 1,
                              }}
                            >
                              <td>
                                {m.ad} {m.soyad}
                                {m.acik_oturum_var && (
                                  <span className="badge badge--nakit" style={{ marginLeft: 8 }}>İçeride</span>
                                )}
                              </td>
                              <td className="muted">{m.tc_kimlik_no}</td>
                              <td className="muted">{m.telefon || "—"}</td>
                              <td style={{ textAlign: "right" }}>
                                {m.acik_oturum_var ? (
                                  <span className="muted">Zaten içeride</span>
                                ) : (
                                  <button disabled={hizliGirisId === m.id} onClick={(e) => { e.stopPropagation(); hizliGirisYap(m); }}>
                                    {hizliGirisId === m.id ? "Giriş yapılıyor..." : "Giriş Yap"}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : sorguTipi === "tc" ? (
                  <div className="field-row">
                    <div className="field">
                      <label>TC Kimlik No</label>
                      <input
                        placeholder="12345678901"
                        value={tcKimlikNo}
                        inputMode="numeric"
                        maxLength={11}
                        onChange={(e) => setTcKimlikNo(e.target.value.replace(/\D/g, "").slice(0, 11))}
                        onKeyDown={(e) => e.key === "Enter" && sorgula()}
                        autoFocus
                      />
                      {tcKimlikNo.length === 11 && !tcKimlikNoGecerliMi(tcKimlikNo) && (
                        <p style={{ color: "var(--terracotta-dark)", fontSize: 12, marginTop: 4 }}>
                          Geçersiz TC Kimlik No
                        </p>
                      )}
                    </div>
                    <button onClick={sorgula} disabled={sorgulaniyor || tcKimlikNo.length !== 11}>
                      {sorgulaniyor ? "Sorgulanıyor..." : "Sorgula"}
                    </button>
                  </div>
                ) : (
                  <div className="field-row">
                    <div className="field">
                      <label>Telefon</label>
                      <input
                        placeholder="05xxxxxxxxx"
                        value={telefon}
                        inputMode="numeric"
                        maxLength={11}
                        onChange={(e) => setTelefon(e.target.value.replace(/\D/g, "").slice(0, 11))}
                        onKeyDown={(e) => e.key === "Enter" && sorgula()}
                        autoFocus
                      />
                      {telefon.length > 0 && !telefonGecerliMi(telefon) && (
                        <p style={{ color: "var(--terracotta-dark)", fontSize: 12, marginTop: 4 }}>
                          Geçersiz telefon numarası
                        </p>
                      )}
                    </div>
                    <button onClick={sorgula} disabled={sorgulaniyor || !telefonGecerliMi(telefon)}>
                      {sorgulaniyor ? "Sorgulanıyor..." : "Sorgula"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {asama === "bulundu" && (
              <div>
                <div className="alert alert--success">
                  Kayıt bulundu: <strong>{ad} {soyad}</strong> ({tcKimlikNo})
                  {telefon && <> — Tel: {telefon}</>}
                </div>
                <div className="field-row">
                  <button onClick={girisYap}>Giriş Yap</button>
                  <button className="ghost" onClick={sifirla}>Vazgeç</button>
                </div>
              </div>
            )}

            {asama === "kayit_gerekli" && (
              <div>
                <div className="alert alert--warn">
                  {sorguTipi === "tc"
                    ? `Bu TC kimlik no (${tcKimlikNo}) ile kayıtlı müşteri bulunamadı. Yeni müşteri kaydı oluşturun.`
                    : `Bu telefon numarası (${telefon}) ile kayıtlı müşteri bulunamadı. Yeni müşteri kaydı oluşturun.`}
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Ad</label>
                    <input placeholder="Ad" value={ad} onChange={(e) => setAd(e.target.value)} autoFocus />
                  </div>
                  <div className="field">
                    <label>Soyad</label>
                    <input placeholder="Soyad" value={soyad} onChange={(e) => setSoyad(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>TC Kimlik No</label>
                    <input
                      placeholder="12345678901"
                      value={tcKimlikNo}
                      inputMode="numeric"
                      maxLength={11}
                      disabled={sorguTipi === "tc"}
                      onChange={(e) => setTcKimlikNo(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    />
                    {tcKimlikNo.length === 11 && !tcKimlikNoGecerliMi(tcKimlikNo) && (
                      <p style={{ color: "var(--terracotta-dark)", fontSize: 12, marginTop: 4 }}>
                        Geçersiz TC Kimlik No
                      </p>
                    )}
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Telefon</label>
                    <input
                      placeholder="05xxxxxxxxx"
                      value={telefon}
                      inputMode="numeric"
                      maxLength={11}
                      disabled={sorguTipi === "telefon"}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "").slice(0, 11);
                        setTelefon(v);
                        setTelefonKayitliUyari(null);
                      }}
                      onBlur={() => telefonKontrolEt(telefon)}
                    />
                    {telefon.length > 0 && !telefonGecerliMi(telefon) && (
                      <p style={{ color: "var(--terracotta-dark)", fontSize: 12, marginTop: 4 }}>
                        Geçersiz telefon numarası (10-11 haneli olmalı)
                      </p>
                    )}
                  </div>
                  <div className="field">
                    <label>Veli Telefonu (opsiyonel)</label>
                    <input
                      placeholder="05xxxxxxxxx"
                      value={veliTelefon}
                      inputMode="numeric"
                      maxLength={11}
                      onChange={(e) => setVeliTelefon(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    />
                    {veliTelefon.length > 0 && !telefonGecerliMi(veliTelefon) && (
                      <p style={{ color: "var(--terracotta-dark)", fontSize: 12, marginTop: 4 }}>
                        Geçersiz telefon numarası (10-11 haneli olmalı)
                      </p>
                    )}
                  </div>
                </div>
                {telefonKontrolEdiliyor && <p className="muted">Telefon kontrol ediliyor...</p>}
                {telefonKayitliUyari && <div className="alert alert--error">{telefonKayitliUyari}</div>}
                <div className="field-row">
                  <button
                    onClick={girisYap}
                    disabled={
                      !ad.trim() ||
                      !soyad.trim() ||
                      !tcKimlikNoGecerliMi(tcKimlikNo) ||
                      !telefonGecerliMi(telefon) ||
                      (veliTelefon.length > 0 && !telefonGecerliMi(veliTelefon))
                    }
                  >
                    Kaydet ve Giriş Yap
                  </button>
                  <button className="ghost" onClick={sifirla}>Vazgeç</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {seciliSession && (
        <div className="card" style={{ borderColor: "var(--mustard)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ marginBottom: 4 }}>{seciliSession.ad} {seciliSession.soyad}</h2>
              <p className="muted">Giriş: {new Date(seciliSession.giris_zamani).toLocaleString()}</p>
            </div>
            <button className="ghost" onClick={seciliSessionSifirla}>Kapat</button>
          </div>

          {seciliSuresiDoldu && (
            <div className="alert alert--error" style={{ marginTop: 12 }}>
              ⏰ Seçilen süre ({formatSureMetni(seciliSession.sure_secimi_dakika ?? 0)}) doldu!
            </div>
          )}

          {seciliSession.on_odeme_yapildi_mi ? (
            <>
              <div className="alert alert--success" style={{ marginTop: 16 }}>
                ✅ Ödeme erkenden alındı. Müşteri hâlâ içeride görünüyor.
              </div>
              <div className="field-row" style={{ marginTop: 8 }}>
                <button
                  className="accent"
                  disabled={kapatiliyor}
                  onClick={() => cikisYaptiIsaretle(seciliSession.id)}
                >
                  Çıkış Yaptı
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="stat-row" style={{ marginTop: 16 }}>
                <div className="stat-card">
                  <div className="stat-card__label">Geçen Süre</div>
                  <div className="stat-card__value">{formatSureMetni(canliDakika)}</div>
                </div>
                {paketVar && (
                  <div className="stat-card">
                    <div className="stat-card__label">Paket</div>
                    <div className="stat-card__value" style={{ fontSize: 18 }}>{paketDurumu?.ad}</div>
                  </div>
                )}
                {indirimKurus > 0 && (
                  <div className="stat-card">
                    <div className="stat-card__label">İndirim</div>
                    <div className="stat-card__value">-{formatKurus(indirimKurus)}</div>
                  </div>
                )}
                <div className="stat-card">
                  <div className="stat-card__label">Ödenmesi Gereken Tutar</div>
                  <div className="stat-card__value">
                    {tahminiTutar != null ? formatKurus(tahminiTutar) : "—"}
                  </div>
                </div>
              </div>

              {paketVar && (
                <div
                  style={{
                    marginTop: 16,
                    padding: 14,
                    borderRadius: 10,
                    background: "var(--cream-soft)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    {paketDurumu?.ad}
                    {paketDurumu?.grup ? ` · ${paketDurumu.grup}` : ""}
                  </div>
                  {bakiyePaketi ? (
                    <div>
                      Kalan bakiye: {formatSureMetni(paketDurumu?.kalan_dakika ?? 0)} (
                      {formatKurus(paketDurumu?.kalan_deger_kurus ?? 0)} değerinde) / toplam{" "}
                      {formatSureMetni(paketDurumu?.toplam_dakika ?? 0)} · Geçerlilik: {paketDurumu?.gecerlilik_bitis}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600 }}>{paketDurumu && abonelikOzetiMetni(paketDurumu)}</div>
                      <div>
                        Bugün kalan: {formatSureMetni(paketDurumu?.bugun_kalan_dakika ?? 0)} · Bu hafta{" "}
                        {paketDurumu?.bu_hafta_kullanilan_gun}/{paketDurumu?.haftalik_gun} gün kullanıldı ·
                        Geçerlilik: {paketDurumu?.gecerlilik_bitis}
                      </div>
                    </>
                  )}
                  {paketDurumu?.gun_hakki_doldu_mu && (
                    <div style={{ color: "var(--terracotta-dark)", fontWeight: 600, marginTop: 6 }}>
                      Haftalık gün hakkı doldu. Yine de ücretsiz kapatabilir ya da normal ücret alabilirsiniz.
                    </div>
                  )}
                  {paketAsanDakika > 0 && (
                    <div className="alert alert--warn" style={{ marginTop: 10, marginBottom: 0 }}>
                      ⚠ {bakiyePaketi ? "Kalan bakiyeyi" : "Günlük hakkı"} {formatSureMetni(paketAsanDakika)} aşıyor
                      {paketAsanTutar != null && paketAsanTutar > 0
                        ? ` · aşan süre ücreti ${formatKurus(paketAsanTutar)}`
                        : ""}
                      .{bakiyePaketi && " Ücretsiz düşülemez; aşan kısmı tahsil edin."}
                    </div>
                  )}
                  <div className="field-row" style={{ marginTop: 10 }}>
                    <button
                      className="secondary"
                      disabled={kapatiliyor || (bakiyePaketi && paketAsanDakika > 0)}
                      onClick={() =>
                        abonelikUyarisi ? setAsimOnayAcik(true) : odendiIsaretle(seciliSession.id, "paket", "ucretsiz")
                      }
                    >
                      Paketten Düş (Ücretsiz)
                    </button>
                    {paketAsanDakika > 0 && (
                      <>
                        <button
                          className="ghost"
                          disabled={kapatiliyor}
                          onClick={() => odendiIsaretle(seciliSession.id, "nakit", "asim")}
                        >
                          Aşanı Tahsil Et: Nakit
                        </button>
                        <button
                          className="ghost"
                          disabled={kapatiliyor}
                          onClick={() => odendiIsaretle(seciliSession.id, "kredi_karti", "asim")}
                        >
                          Aşanı Tahsil Et: Kredi Kartı
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="field-row" style={{ marginTop: 16, alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                  <input
                    type="checkbox"
                    checked={yuvarla}
                    disabled={ozelTutarKurus !== undefined}
                    onChange={(e) => setYuvarla(e.target.checked)}
                  />
                  Yuvarla (en yakın 10 TL'ye)
                </label>
                <button className="ghost" disabled={ozelTutarKurus !== undefined} onClick={() => setIndirimAcik((v) => !v)}>
                  {indirimAcik ? "İndirimi Kaldır" : "İndirim Uygula"}
                </button>
              </div>

              {indirimAcik && (
                <div className="field-row" style={{ marginTop: 8, alignItems: "center" }}>
                  <div className="field" style={{ maxWidth: 140 }}>
                    <label>İndirim Değeri</label>
                    <input
                      type="number"
                      min="0"
                      placeholder={indirimTipi === "tutar" ? "Örn: 20" : "Örn: 10"}
                      value={indirimDeger}
                      onChange={(e) => setIndirimDeger(e.target.value)}
                    />
                  </div>
                  <div className="field-row" style={{ gap: 4 }}>
                    <button
                      className={indirimTipi === "tutar" ? "" : "ghost"}
                      onClick={() => setIndirimTipi("tutar")}
                    >
                      TL
                    </button>
                    <button
                      className={indirimTipi === "yuzde" ? "" : "ghost"}
                      onClick={() => setIndirimTipi("yuzde")}
                    >
                      %
                    </button>
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="field-row" style={{ marginTop: 8, alignItems: "center" }}>
                  <div className="field" style={{ maxWidth: 180 }}>
                    <label>Özel Tutar (TL)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Örn: 123,45"
                      value={ozelTutar}
                      onChange={(e) => setOzelTutar(e.target.value)}
                    />
                  </div>
                  {ozelTutarKurus !== undefined && (
                    <span className="muted" style={{ fontSize: 14 }}>
                      Özel tutar uygulanıyor; normal ücret: {tahminiTutarHam != null ? formatKurus(tahminiTutarHam) : "—"}
                    </span>
                  )}
                </div>
              )}

              <div className="field-row" style={{ marginTop: 8 }}>
                <button
                  className="secondary"
                  disabled={kapatiliyor}
                  onClick={() => odendiIsaretle(seciliSession.id, "nakit")}
                >
                  Nakit Ödendi
                </button>
                <button
                  className="accent"
                  disabled={kapatiliyor}
                  onClick={() => odendiIsaretle(seciliSession.id, "kredi_karti")}
                >
                  Kredi Kartı Ödendi
                </button>
              </div>

              {seciliSession.sure_secimi_dakika != null && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border, #e0d8c8)" }}>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Bu oturum süreli açıldı ({formatSureMetni(seciliSession.sure_secimi_dakika)}). Müşteri daha çıkmadan
                    ödemeyi şimdiden ({formatSureMetni(seciliSession.sure_secimi_dakika)} üzerinden,{" "}
                    {(() => {
                      const t = tierUcretiHesapla(seciliSession.sure_secimi_dakika, pricingPolicy);
                      return t != null ? formatKurus(t) : "—";
                    })()}
                    ) alabilirsiniz.
                  </p>
                  <div className="field-row">
                    <button
                      className="ghost"
                      disabled={kapatiliyor}
                      onClick={() => erkenOdeIsaretle(seciliSession.id, "nakit")}
                    >
                      Erken Öde: Nakit
                    </button>
                    <button
                      className="ghost"
                      disabled={kapatiliyor}
                      onClick={() => erkenOdeIsaretle(seciliSession.id, "kredi_karti")}
                    >
                      Erken Öde: Kredi Kartı
                    </button>
                  </div>

                  <div className="field-row" style={{ marginTop: 8, alignItems: "center" }}>
                    <span className="muted" style={{ fontSize: 14 }}>Süreyi Uzat:</span>
                    {[10, 20, 30, 60].map((dk) => (
                      <button
                        key={dk}
                        className="ghost"
                        disabled={uzatiliyor}
                        onClick={() => sureUzat(seciliSession.id, dk)}
                      >
                        +{dk} dk
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>İçeride Olanlar ({sessions.length})</h2>
        {sessions.length === 0 ? (
          <p className="muted">Şu anda içeride müşteri yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ad Soyad</th>
                <th>Giriş Zamanı</th>
                <th>Geçen Dakika</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const doldu = suresiDolduMu(s);
                return (
                  <tr
                    key={s.id}
                    onClick={() => setSeciliSessionId(s.id)}
                    style={{
                      cursor: "pointer",
                      background: doldu
                        ? "var(--row-bad)"
                        : seciliSessionId === s.id
                        ? "var(--row-sel)"
                        : undefined,
                    }}
                  >
                    <td>
                      {s.ad} {s.soyad}
                      {s.on_odeme_yapildi_mi && (
                        <span className="badge badge--nakit" style={{ marginLeft: 8 }}>Ödendi</span>
                      )}
                      {doldu && (
                        <span className="badge badge--solid" style={{ marginLeft: 8 }}>
                          ⏰ Süresi Doldu
                        </span>
                      )}
                    </td>
                    <td>{new Date(s.giris_zamani).toLocaleTimeString()}</td>
                    <td>
                      {formatSureMetni(satirCanliDakika(s))}
                      {s.sure_secimi_dakika != null && ` / ${formatSureMetni(s.sure_secimi_dakika)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {seciliSession && paketDurumu && asimOnayAcik && abonelikUyarisi && (
        <div className="modal-overlay" onClick={() => setAsimOnayAcik(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2 style={{ fontSize: 22, marginBottom: 12 }}>
              {paketAsanDakika > 0 ? "Günlük paket hakkı aşıldı" : "Haftalık gün hakkı doldu"}
            </h2>
            {paketAsanDakika > 0 && (
              <>
                <p style={{ marginBottom: 8 }}>
                  Günlük hak: {formatSureMetni(paketDurumu.gunluk_dakika ?? 0)} · Bugün kalan:{" "}
                  {formatSureMetni(paketKalanGunlukDakika)} · İçeride geçen: {formatSureMetni(canliDakika)} →{" "}
                  <strong>{formatSureMetni(paketAsanDakika)} fazla.</strong>
                </p>
                {paketAsanTutar != null && (
                  <p style={{ marginBottom: 8 }}>
                    Aşan {formatSureMetni(paketAsanDakika)}'in ücreti: <strong>{formatKurus(paketAsanTutar)}</strong>
                  </p>
                )}
              </>
            )}
            {paketDurumu.gun_hakki_doldu_mu && (
              <p style={{ marginBottom: 8 }}>
                Bu hafta {paketDurumu.bu_hafta_kullanilan_gun}/{paketDurumu.haftalik_gun} gün kullanıldı.
              </p>
            )}
            <div className="field-row" style={{ marginTop: 16 }}>
              {paketAsanDakika > 0 && (
                <>
                  <button disabled={kapatiliyor} onClick={() => odendiIsaretle(seciliSession.id, "nakit", "asim")}>
                    Aşanı Tahsil Et: Nakit
                  </button>
                  <button disabled={kapatiliyor} onClick={() => odendiIsaretle(seciliSession.id, "kredi_karti", "asim")}>
                    Aşanı Tahsil Et: Kredi Kartı
                  </button>
                </>
              )}
              <button
                className="accent"
                disabled={kapatiliyor}
                onClick={() => odendiIsaretle(seciliSession.id, "paket", "ucretsiz")}
              >
                Yine de Ücretsiz Düş
              </button>
              <button className="ghost" onClick={() => setAsimOnayAcik(false)}>Vazgeç</button>
            </div>
          </div>
        </div>
      )}

      {suresiDolanUyari && (
        <div className="modal-overlay" onClick={() => setSuresiDolanUyari(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, textAlign: "center" }}>
            <h2 style={{ fontSize: 24, marginBottom: 12 }}>⏰ Süre Doldu</h2>
            <p style={{ fontSize: 18, marginBottom: 20 }}>
              <strong>{suresiDolanUyari.ad} {suresiDolanUyari.soyad}</strong> kişinin oturum süresi doldu.
            </p>

            {suresiDolanUyari.on_odeme_yapildi_mi ? (
              <p className="muted" style={{ marginBottom: 20 }}>
                Bu oturumun ödemesi zaten erkenden alınmış; süre uzatılamaz. Müşteri çıktığında normal
                şekilde kapatın.
              </p>
            ) : (
              <div style={{ marginBottom: 20 }}>
                <p className="muted" style={{ marginBottom: 8 }}>Müşteri kalmaya devam edecekse süreyi uzatın:</p>
                <div className="field-row" style={{ justifyContent: "center" }}>
                  {[10, 20, 30, 60].map((dk) => (
                    <button
                      key={dk}
                      className="ghost"
                      disabled={uzatiliyor}
                      onClick={() => sureUzat(suresiDolanUyari.id, dk)}
                    >
                      +{dk} dk
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => {
                setSeciliSessionId(suresiDolanUyari.id);
                setSuresiDolanUyari(null);
              }}
            >
              Oturumu Görüntüle
            </button>{" "}
            <button className="ghost" onClick={() => setSuresiDolanUyari(null)}>Tamam</button>
          </div>
        </div>
      )}
    </div>
  );
}
