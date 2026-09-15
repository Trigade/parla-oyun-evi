import { Fragment, useEffect, useState } from "react";
import {
  api,
  formatSureMetni,
  tierUcretiHesapla,
  type CurrentBusinessDayResponse,
  type OpenSession,
  type PricingPolicy,
} from "../api/client";

function toDatetimeLocalValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatKurus(kurus: number) {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

// Backend'deki RoundDownToTen ile aynı mantık: en yakın 10 TL'ye aşağı yuvarlar.
function yuvarlaKurus(kurus: number): number {
  const lira = Math.floor(kurus / 100);
  return Math.floor(lira / 10) * 10 * 100;
}

function odemeTipiEtiketi(odemeTipi: OpenSession["odeme_tipi"]) {
  switch (odemeTipi) {
    case "kredi_karti":
      return "Kredi Kartı";
    case "paket":
      return "Paket";
    default:
      return "Nakit";
  }
}

interface ElleKapatForm {
  cikisZamani: string;
  odemeTipi: "nakit" | "kredi_karti";
  yuvarla: boolean;
}

export default function GunSonu() {
  const [gun, setGun] = useState<CurrentBusinessDayResponse | null>(null);
  const [sessions, setSessions] = useState<OpenSession[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [islemYapiliyor, setIslemYapiliyor] = useState(false);

  const [elleKapatId, setElleKapatId] = useState<number | null>(null);
  const [elleKapatForm, setElleKapatForm] = useState<ElleKapatForm | null>(null);

  const [pricingPolicy, setPricingPolicy] = useState<PricingPolicy | null>(null);

  async function refresh() {
    setYukleniyor(true);
    try {
      const [gunDurumu, acikOturumlar] = await Promise.all([
        api.getCurrentBusinessDay(),
        api.listOpenSessions(),
      ]);
      setGun(gunDurumu);
      setSessions(acikOturumlar);
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }

  useEffect(() => {
    refresh();
    api.getActivePricingPolicy().then(setPricingPolicy).catch(() => {});
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  async function gunBasiYap() {
    setHata(null);
    setBasari(null);
    setIslemYapiliyor(true);
    try {
      await api.startBusinessDay();
      setBasari("Gün başlatıldı.");
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setIslemYapiliyor(false);
    }
  }

  async function odendiIsaretle(id: number, odemeTipi: "nakit" | "kredi_karti") {
    setHata(null);
    setBasari(null);
    setIslemYapiliyor(true);
    try {
      await api.closeSession(id, odemeTipi, false);
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setIslemYapiliyor(false);
    }
  }

  // Ödemesi erkenden alınmış bir oturumda müşteri çıktığında oturumu kapatır;
  // tutar yeniden hesaplanmaz (kasa ekranındaki "Çıkış Yaptı" ile aynı işlem).
  async function cikisYaptiIsaretle(id: number) {
    setHata(null);
    setBasari(null);
    setIslemYapiliyor(true);
    try {
      await api.checkOutSession(id);
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setIslemYapiliyor(false);
    }
  }

  function elleKapatBaslat(id: number) {
    setElleKapatId(id);
    setElleKapatForm({
      cikisZamani: toDatetimeLocalValue(new Date()),
      odemeTipi: "nakit",
      yuvarla: false,
    });
  }

  async function elleKapatOnayla() {
    if (elleKapatId == null || !elleKapatForm) return;
    setHata(null);
    setBasari(null);
    setIslemYapiliyor(true);
    try {
      const cikisIso = new Date(elleKapatForm.cikisZamani).toISOString();
      await api.manualCloseSession(elleKapatId, cikisIso, elleKapatForm.odemeTipi, elleKapatForm.yuvarla);
      setBasari(`Oturum #${elleKapatId} elle kapatıldı.`);
      setElleKapatId(null);
      setElleKapatForm(null);
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setIslemYapiliyor(false);
    }
  }

  async function gunSonuYap() {
    if (!gun?.gun) return;
    setHata(null);
    setBasari(null);
    setIslemYapiliyor(true);
    try {
      await api.endBusinessDay(gun.gun.id);
      setBasari("Gün sonu yapıldı. Rapor (.pdf) indirildi.");
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setIslemYapiliyor(false);
    }
  }

  const gunAcik = gun?.acik === true;
  // Erken ödemesi alınmış oturumlar gün sonunu engellemez; sunucu gün
  // kapanırken bunları otomatik olarak çıkış yapmış sayar.
  const odenmemisOturumSayisi = sessions.filter((s) => !s.on_odeme_yapildi_mi).length;
  const erkenOdenmisOturumSayisi = sessions.length - odenmemisOturumSayisi;

  return (
    <div className="page">
      <h1>Gün Sonu</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Sabah "Gün Başı" ile günü açın. Akşam, ödemesi alınmamış tüm açık oturumları kapattıktan
        sonra "Gün Sonu" yaparak o güne ait tüm işlemleri içeren PDF raporunu indirin.
      </p>

      {hata && <div className="alert alert--error">{hata}</div>}
      {basari && <div className="alert alert--success">{basari}</div>}

      {yukleniyor ? (
        <p className="muted">Yükleniyor...</p>
      ) : !gunAcik ? (
        <div className="card">
          <h2>Gün Henüz Başlamadı</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            Güne başlamak için aşağıdaki butona basın.
          </p>
          <button onClick={gunBasiYap} disabled={islemYapiliyor}>
            {islemYapiliyor ? "Başlatılıyor..." : "Gün Başı Yap"}
          </button>
        </div>
      ) : (
        <>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>Gün Açık</h2>
                <p className="muted">Başlangıç: {gun?.gun?.acilis_zamani}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                {odenmemisOturumSayisi > 0 && (
                  <p style={{ color: "var(--terracotta-dark)", fontWeight: 700, marginBottom: 8 }}>
                    Ödemesi alınmamış {odenmemisOturumSayisi} açık oturum var — gün sonu yapmadan önce hepsini kapatın
                  </p>
                )}
                {odenmemisOturumSayisi === 0 && erkenOdenmisOturumSayisi > 0 && (
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Erken ödemesi alınmış {erkenOdenmisOturumSayisi} müşteri gün sonunda otomatik olarak çıkış yapmış
                    sayılacak.
                  </p>
                )}
                <button onClick={gunSonuYap} disabled={odenmemisOturumSayisi > 0 || islemYapiliyor}>
                  {islemYapiliyor ? "İşleniyor..." : "Gün Sonu Yap"}
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Açık Oturumlar ({sessions.length})</h2>
            {sessions.length === 0 ? (
              <p className="muted">Açık oturum yok — gün sonu yapabilirsiniz.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Ad Soyad</th>
                    <th>Giriş Zamanı</th>
                    <th>Geçen Dakika</th>
                    <th>Tutar</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    if (s.on_odeme_yapildi_mi) {
                      return (
                        <tr key={s.id}>
                          <td>
                            {s.ad} {s.soyad}
                            <span className="badge badge--nakit" style={{ marginLeft: 8 }}>Erken Ödendi</span>
                          </td>
                          <td>{new Date(s.giris_zamani).toLocaleString()}</td>
                          <td>{formatSureMetni(s.gecen_dakika)}</td>
                          <td>
                            {formatKurus(s.tahsil_tutar_kurus ?? 0)}{" "}
                            <span className="muted">({odemeTipiEtiketi(s.odeme_tipi)}, ödendi)</span>
                          </td>
                          <td>
                            <button className="ghost" disabled={islemYapiliyor} onClick={() => cikisYaptiIsaretle(s.id)}>
                              Çıkış Yaptı
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    const tahminiTutar = tierUcretiHesapla(s.gecen_dakika, pricingPolicy);
                    return (
                    <Fragment key={s.id}>
                      <tr>
                        <td>{s.ad} {s.soyad}</td>
                        <td>{new Date(s.giris_zamani).toLocaleString()}</td>
                        <td>{formatSureMetni(s.gecen_dakika)}</td>
                        <td>{tahminiTutar != null ? formatKurus(tahminiTutar) : "—"}</td>
                        <td>
                          <button className="secondary" disabled={islemYapiliyor} onClick={() => odendiIsaretle(s.id, "nakit")}>
                            Nakit Ödendi
                          </button>{" "}
                          <button className="accent" disabled={islemYapiliyor} onClick={() => odendiIsaretle(s.id, "kredi_karti")}>
                            Kredi Kartı Ödendi
                          </button>{" "}
                          <button className="ghost" disabled={islemYapiliyor} onClick={() => elleKapatBaslat(s.id)}>
                            Elle Kapat
                          </button>
                        </td>
                      </tr>
                      {elleKapatId === s.id && elleKapatForm && (() => {
                        const elleKapatDakika = Math.max(
                          0,
                          Math.floor(
                            (new Date(elleKapatForm.cikisZamani).getTime() - new Date(s.giris_zamani).getTime()) / 60000
                          )
                        );
                        const elleKapatTutarHam = tierUcretiHesapla(elleKapatDakika, pricingPolicy);
                        const elleKapatTutar =
                          elleKapatTutarHam != null && elleKapatForm.yuvarla
                            ? yuvarlaKurus(elleKapatTutarHam)
                            : elleKapatTutarHam;
                        return (
                        <tr>
                          <td colSpan={5} style={{ background: "var(--cream-soft)" }}>
                            <div className="field-row" style={{ alignItems: "center" }}>
                              <div className="field">
                                <label>Çıkış Zamanı</label>
                                <input
                                  type="datetime-local"
                                  value={elleKapatForm.cikisZamani}
                                  onChange={(e) =>
                                    setElleKapatForm({ ...elleKapatForm, cikisZamani: e.target.value })
                                  }
                                />
                              </div>
                              <div className="field">
                                <label>Ödeme Tipi</label>
                                <select
                                  value={elleKapatForm.odemeTipi}
                                  onChange={(e) =>
                                    setElleKapatForm({
                                      ...elleKapatForm,
                                      odemeTipi: e.target.value as "nakit" | "kredi_karti",
                                    })
                                  }
                                >
                                  <option value="nakit">Nakit</option>
                                  <option value="kredi_karti">Kredi Kartı</option>
                                </select>
                              </div>
                              <div className="field">
                                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <input
                                    type="checkbox"
                                    checked={elleKapatForm.yuvarla}
                                    onChange={(e) =>
                                      setElleKapatForm({ ...elleKapatForm, yuvarla: e.target.checked })
                                    }
                                  />
                                  Yuvarla
                                </label>
                              </div>
                              <div style={{ fontWeight: 600 }}>
                                Tutar: {elleKapatTutar != null ? formatKurus(elleKapatTutar) : "—"}
                              </div>
                              <button onClick={elleKapatOnayla} disabled={islemYapiliyor}>Onayla</button>
                              <button className="ghost" onClick={() => { setElleKapatId(null); setElleKapatForm(null); }}>
                                Vazgeç
                              </button>
                            </div>
                          </td>
                        </tr>
                        );
                      })()}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
