import { useEffect, useState } from "react";
import { api, type PricingPolicy, type PricingRule } from "../api/client";

function formatKurus(kurus: number) {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

function aralikMetni(minDakika: number, maxDakika: number) {
  return `${minDakika}-${maxDakika} dk`;
}

interface TierSatiri {
  maxDakikaStr: string;
  tutarTL: string;
}

function bosSatir(): TierSatiri {
  return { maxDakikaStr: "", tutarTL: "" };
}

export default function FiyatPolitikasi() {
  const [aktifPolitika, setAktifPolitika] = useState<PricingPolicy | null>(null);
  const [gecmisPolitika, setGecmisPolitika] = useState<PricingPolicy[]>([]);
  const [satirlar, setSatirlar] = useState<TierSatiri[]>([bosSatir()]);
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const [aktifDakikaUcreti, setAktifDakikaUcreti] = useState<PricingRule | null>(null);
  const [yeniDakikaUcreti, setYeniDakikaUcreti] = useState("");
  const [dakikaKaydediliyor, setDakikaKaydediliyor] = useState(false);

  async function refresh() {
    setYukleniyor(true);
    setHata(null);
    try {
      const [aktif, tumu, aktifDakika] = await Promise.all([
        api.getActivePricingPolicy().catch(() => null),
        api.listPricingPolicies().catch(() => []),
        api.getActivePricingRule().catch(() => null),
      ]);
      setAktifPolitika(aktif);
      setGecmisPolitika(tumu);
      setAktifDakikaUcreti(aktifDakika);
      if (aktif) {
        setSatirlar(
          aktif.tiers.map((t) => ({
            maxDakikaStr: String(t.max_dakika),
            tutarTL: (t.tutar_kurus / 100).toString(),
          }))
        );
      }
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function satirGuncelle(index: number, alan: keyof TierSatiri, deger: string) {
    setSatirlar((prev) => prev.map((s, i) => (i === index ? { ...s, [alan]: deger } : s)));
  }

  function satirEkle() {
    setSatirlar((prev) => [...prev, bosSatir()]);
  }

  function satirSil(index: number) {
    setSatirlar((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  // Satırlardan minDakika değerlerini otomatik türetir (her satır bir öncekinin bittiği yerden başlar).
  function minDakikalariHesapla(list: TierSatiri[]): number[] {
    const minler: number[] = [];
    let sonraki = 0;
    for (const s of list) {
      minler.push(sonraki);
      const max = Number(s.maxDakikaStr);
      sonraki = Number.isFinite(max) ? max + 1 : sonraki;
    }
    return minler;
  }

  async function kaydet() {
    setHata(null);
    setBasari(null);

    const minler = minDakikalariHesapla(satirlar);
    const tiers: { min_dakika: number; max_dakika: number; tutar_kurus: number }[] = [];
    for (let i = 0; i < satirlar.length; i++) {
      const satir = satirlar[i];
      const tutarTL = Number(satir.tutarTL.replace(",", "."));
      if (!Number.isFinite(tutarTL) || tutarTL < 0) {
        setHata(`${i + 1}. blok için geçerli bir ücret girin.`);
        return;
      }
      const max = Number(satir.maxDakikaStr);
      if (satir.maxDakikaStr.trim() === "" || !Number.isInteger(max) || max < minler[i]) {
        setHata(`${i + 1}. blok için geçerli bir üst sınır girin (${minler[i]} dakikadan büyük veya eşit).`);
        return;
      }
      tiers.push({ min_dakika: minler[i], max_dakika: max, tutar_kurus: Math.round(tutarTL * 100) });
    }

    setKaydediliyor(true);
    try {
      const politika = await api.createPricingPolicy(tiers);
      setBasari(`Yeni fiyat politikası ${politika.effective_from} itibarıyla geçerli.`);
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setKaydediliyor(false);
    }
  }

  async function dakikaKaydet() {
    setHata(null);
    setBasari(null);
    const dakikaTL = Number(yeniDakikaUcreti.replace(",", "."));
    if (!Number.isFinite(dakikaTL) || dakikaTL < 0) {
      setHata("Geçerli bir dakika ücreti girin.");
      return;
    }
    setDakikaKaydediliyor(true);
    try {
      const kural = await api.createPricingRule(Math.round(dakikaTL * 100));
      setBasari(`Paket dakika ücreti (${formatKurus(kural.kurus_per_dakika)}) ${kural.effective_from} itibarıyla geçerli.`);
      setYeniDakikaUcreti("");
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setDakikaKaydediliyor(false);
    }
  }

  return (
    <div className="page">
      <h1>Fiyat Politikası</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Oturum ücretlendirmesi blok (aralık) bazlıdır: müşterinin kaldığı süre hangi bloğa
        giriyorsa o bloğun sabit ücreti tahsil edilir. Yapılan değişiklik kaydedildiği andan
        itibaren geçerli olur; daha önce kapanmış oturumların tutarını etkilemez.
      </p>

      {hata && <div className="alert alert--error">{hata}</div>}
      {basari && <div className="alert alert--success">{basari}</div>}

      {yukleniyor ? (
        <p className="muted">Yükleniyor...</p>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <h2>Aktif Fiyat Blokları</h2>
            {aktifPolitika ? (
              <>
                <p className="muted" style={{ marginBottom: 12 }}>Geçerlilik başlangıcı: {aktifPolitika.effective_from}</p>
                <table style={{ marginBottom: 4 }}>
                  <thead>
                    <tr>
                      <th>Süre Aralığı</th>
                      <th>Ücret</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aktifPolitika.tiers.map((t) => (
                      <tr key={t.id}>
                        <td>{aralikMetni(t.min_dakika, t.max_dakika)}</td>
                        <td>{formatKurus(t.tutar_kurus)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="muted">Henüz bir fiyat politikası tanımlı değil.</p>
            )}
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h2>Fiyat Bloklarını Düzenle</h2>
            <p className="muted" style={{ marginBottom: 12 }}>
              Her blok bir öncekinin bittiği dakikadan devam eder. En son bloğun bitişi bir "tur"
              tanımlar; bir müşteri bu turdan uzun kalırsa ücret döngüsel hesaplanır — örn.
              bloklar 0-30 dk ve 31-60 dk ise (tur = 60 dk), 2 saat 45 dk (165 dk) kalan bir
              müşteri 2 tam tur + kalan 45 dk'nın bloğu kadar öder.
            </p>
            {satirlar.map((satir, i) => {
              const min = minDakikalariHesapla(satirlar)[i];
              return (
                <div className="field-row" key={i} style={{ marginBottom: 8, alignItems: "center" }}>
                  <div className="field" style={{ maxWidth: 100 }}>
                    <label>Başlangıç (dk)</label>
                    <input value={min} disabled />
                  </div>
                  <div className="field" style={{ maxWidth: 140 }}>
                    <label>Bitiş (dk)</label>
                    <input
                      placeholder="Örn: 30"
                      value={satir.maxDakikaStr}
                      onChange={(e) => satirGuncelle(i, "maxDakikaStr", e.target.value.replace(/[^\d]/g, ""))}
                    />
                  </div>
                  <div className="field" style={{ maxWidth: 140 }}>
                    <label>Ücret (TL)</label>
                    <input
                      placeholder="Örn: 50"
                      value={satir.tutarTL}
                      onChange={(e) => satirGuncelle(i, "tutarTL", e.target.value)}
                    />
                  </div>
                  <button
                    className="ghost"
                    onClick={() => satirSil(i)}
                    disabled={satirlar.length === 1}
                    style={{ marginTop: 20 }}
                  >
                    Sil
                  </button>
                </div>
              );
            })}
            <div className="field-row" style={{ marginTop: 8 }}>
              <button className="ghost" onClick={satirEkle}>+ Blok Ekle</button>
              <button onClick={kaydet} disabled={kaydediliyor}>
                {kaydediliyor ? "Kaydediliyor..." : "Kaydet ve Uygula"}
              </button>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h2>Paket Satın Alma Dakika Ücreti</h2>
            <p className="muted" style={{ marginBottom: 12 }}>
              Bu ücret yalnızca "Satın Alma" ekranında müşterilere önceden dakika paketi
              satarken kullanılır; oturum kapatma ücretlendirmesini etkilemez (o, yukarıdaki
              bloklarla belirlenir).
            </p>
            <div className="field-row" style={{ alignItems: "center" }}>
              <div className="stat-card">
                <div className="stat-card__label">Güncel Paket Dakika Ücreti</div>
                <div className="stat-card__value">
                  {aktifDakikaUcreti ? formatKurus(aktifDakikaUcreti.kurus_per_dakika) : "—"}
                </div>
              </div>
              <div className="field" style={{ maxWidth: 160 }}>
                <label>Yeni Dakika Ücreti (TL)</label>
                <input
                  placeholder="Örn: 6"
                  value={yeniDakikaUcreti}
                  onChange={(e) => setYeniDakikaUcreti(e.target.value)}
                />
              </div>
              <button onClick={dakikaKaydet} disabled={dakikaKaydediliyor || !yeniDakikaUcreti} style={{ marginTop: 20 }}>
                {dakikaKaydediliyor ? "Kaydediliyor..." : "Kaydet ve Uygula"}
              </button>
            </div>
          </div>

          <div className="card">
            <h2>Fiyat Politikası Geçmişi</h2>
            {gecmisPolitika.length === 0 ? (
              <p className="muted">Henüz bir fiyat politikası yok.</p>
            ) : (
              gecmisPolitika.map((p) => (
                <div key={p.version_id} style={{ marginBottom: 16 }}>
                  <p style={{ marginBottom: 4 }}>
                    {p.effective_from}
                    {aktifPolitika?.version_id === p.version_id && (
                      <span className="badge badge--nakit" style={{ marginLeft: 8 }}>Aktif</span>
                    )}
                  </p>
                  <table>
                    <tbody>
                      {p.tiers.map((t) => (
                        <tr key={t.id}>
                          <td>{aralikMetni(t.min_dakika, t.max_dakika)}</td>
                          <td>{formatKurus(t.tutar_kurus)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
