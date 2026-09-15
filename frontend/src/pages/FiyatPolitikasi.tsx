import { useEffect, useState } from "react";
import { api, type PricingPolicy } from "../api/client";

// Fiyat blokları sabittir: blok süreleri değiştirilemez, ekranda yalnızca
// ücretler güncellenir. Aynı liste backend'de (handlers/pricing.go →
// CreatePricingTierVersion) ve varsayılan fiyatları yazan 0015 migration'ında
// da tanımlıdır; değiştirilecekse üçü birlikte güncellenmeli.
const SABIT_BLOKLAR = [
  { maxDakika: 30, etiket: "30 Dakika", varsayilanTL: 250 },
  { maxDakika: 60, etiket: "60 Dakika", varsayilanTL: 370 },
  { maxDakika: 90, etiket: "90 Dakika", varsayilanTL: 550 },
  { maxDakika: 120, etiket: "2 Saat", varsayilanTL: 650 },
  { maxDakika: 180, etiket: "3 Saat", varsayilanTL: 900 },
  { maxDakika: 300, etiket: "5 Saat", varsayilanTL: 1450 },
  { maxDakika: 600, etiket: "10 Saat", varsayilanTL: 2500 },
];

// Her blok bir öncekinin bittiği dakikanın bir fazlasından başlar.
const BLOK_BASLANGICLARI = SABIT_BLOKLAR.map((_, i) => (i === 0 ? 0 : SABIT_BLOKLAR[i - 1].maxDakika + 1));

function formatKurus(kurus: number) {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

function blokEtiketi(maxDakika: number) {
  return SABIT_BLOKLAR.find((b) => b.maxDakika === maxDakika)?.etiket ?? `${maxDakika} dk`;
}

function aralikMetni(minDakika: number, maxDakika: number) {
  return `${minDakika}–${maxDakika} dk`;
}

// Politika sabit blok yapısında mı? (Eski sürümde elle girilmiş farklı bloklar olabilir.)
function sabitYapidaMi(politika: PricingPolicy) {
  return (
    politika.tiers.length === SABIT_BLOKLAR.length &&
    politika.tiers.every((t, i) => t.max_dakika === SABIT_BLOKLAR[i].maxDakika)
  );
}

export default function FiyatPolitikasi() {
  const [aktifPolitika, setAktifPolitika] = useState<PricingPolicy | null>(null);
  const [gecmisPolitika, setGecmisPolitika] = useState<PricingPolicy[]>([]);
  const [fiyatlar, setFiyatlar] = useState<string[]>(() => SABIT_BLOKLAR.map((b) => String(b.varsayilanTL)));
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  async function refresh() {
    setYukleniyor(true);
    setHata(null);
    try {
      const [aktif, tumu] = await Promise.all([
        api.getActivePricingPolicy().catch(() => null),
        api.listPricingPolicies().catch(() => []),
      ]);
      setAktifPolitika(aktif);
      setGecmisPolitika(tumu);
      setFiyatlar(
        aktif && sabitYapidaMi(aktif)
          ? aktif.tiers.map((t) => (t.tutar_kurus / 100).toString())
          : SABIT_BLOKLAR.map((b) => String(b.varsayilanTL))
      );
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function fiyatGuncelle(index: number, deger: string) {
    setFiyatlar((prev) => prev.map((f, i) => (i === index ? deger : f)));
  }

  async function kaydet() {
    setHata(null);
    setBasari(null);

    const tiers: { min_dakika: number; max_dakika: number; tutar_kurus: number }[] = [];
    for (let i = 0; i < SABIT_BLOKLAR.length; i++) {
      const tutarTL = Number(fiyatlar[i].replace(",", "."));
      if (fiyatlar[i].trim() === "" || !Number.isFinite(tutarTL) || tutarTL < 0) {
        setHata(`${SABIT_BLOKLAR[i].etiket} için geçerli bir ücret girin.`);
        return;
      }
      tiers.push({
        min_dakika: BLOK_BASLANGICLARI[i],
        max_dakika: SABIT_BLOKLAR[i].maxDakika,
        tutar_kurus: Math.round(tutarTL * 100),
      });
    }

    setKaydediliyor(true);
    try {
      const politika = await api.createPricingPolicy(tiers);
      setBasari(`Yeni fiyatlar ${politika.effective_from} itibarıyla geçerli.`);
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <div className="page">
      <h1>Fiyat Politikası</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Ücretlendirme sabit süre bloklarına göre yapılır: müşterinin kaldığı süre hangi bloğa
        giriyorsa o bloğun ücreti tahsil edilir. Bloklar sabittir, burada yalnızca ücretleri
        güncelleyebilirsiniz. Değişiklik kaydedildiği andan itibaren geçerli olur; daha önce
        kapanmış oturumların tutarını etkilemez.
      </p>

      {hata && <div className="alert alert--error">{hata}</div>}
      {basari && <div className="alert alert--success">{basari}</div>}

      {yukleniyor ? (
        <p className="muted">Yükleniyor...</p>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <h2>Ücretleri Güncelle</h2>
            {aktifPolitika && !sabitYapidaMi(aktifPolitika) && (
              <div className="alert alert--error" style={{ marginBottom: 12 }}>
                Aktif fiyat politikası eski blok yapısında. Kaydettiğinizde aşağıdaki sabit bloklara geçilir.
              </div>
            )}
            {!aktifPolitika && (
              <p className="muted" style={{ marginBottom: 12 }}>
                Henüz kayıtlı bir fiyat politikası yok; aşağıda varsayılan ücretler gösteriliyor.
              </p>
            )}
            <table>
              <thead>
                <tr>
                  <th>Süre</th>
                  <th>Kapsadığı Aralık</th>
                  <th>Ücret (TL)</th>
                </tr>
              </thead>
              <tbody>
                {SABIT_BLOKLAR.map((blok, i) => (
                  <tr key={blok.maxDakika}>
                    <td style={{ fontWeight: 600 }}>
                      <label htmlFor={`fiyat-${blok.maxDakika}`}>{blok.etiket}</label>
                    </td>
                    <td className="muted">{aralikMetni(BLOK_BASLANGICLARI[i], blok.maxDakika)}</td>
                    <td>
                      <input
                        id={`fiyat-${blok.maxDakika}`}
                        inputMode="decimal"
                        value={fiyatlar[i]}
                        onChange={(e) => fiyatGuncelle(i, e.target.value)}
                        style={{ maxWidth: 140 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 12 }}>
              10 saati aşan kalışlarda ücret döngüsel hesaplanır: her tam 10 saat için 10 saatlik
              ücret, kalan süre için de düştüğü bloğun ücreti eklenir.
            </p>
            <div className="field-row" style={{ marginTop: 8 }}>
              <button onClick={kaydet} disabled={kaydediliyor}>
                {kaydediliyor ? "Kaydediliyor..." : "Kaydet ve Uygula"}
              </button>
            </div>
          </div>

          <div className="card">
            <h2>Fiyat Geçmişi</h2>
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
                          <td>{blokEtiketi(t.max_dakika)}</td>
                          <td className="muted">{aralikMetni(t.min_dakika, t.max_dakika)}</td>
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
