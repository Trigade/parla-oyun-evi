import { useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import TemaButonu from "../components/TemaButonu";
import { SURUM } from "../surum";

type Asama = "girdi" | "totp_kurulum" | "totp_dogrulama";

export default function Login() {
  const [asama, setAsama] = useState<Asama>("girdi");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const { login, finishLogin } = useAuth();
  const navigate = useNavigate();

  // TOTP kurulum akışı
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [manuelSecret, setManuelSecret] = useState<string | null>(null);

  // TOTP doğrulama akışı (kurulum zaten yapılmışsa)
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  const [kod, setKod] = useState("");

  // "Bu cihazı hatırla": işaretlenirse bu tarayıcıda 30 gün boyunca
  // Authenticator kodu sorulmaz. Kullanıcı adı ve şifre yine istenir.
  const [cihaziHatirla, setCihaziHatirla] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setHata(null);
    setYukleniyor(true);
    try {
      const res = await login(username, password);
      if (res.token && res.user_id != null && res.permissions) {
        // Bu cihaz daha önce hatırlanmış: sunucu kod adımını atladı.
        finishLogin({
          token: res.token,
          user_id: res.user_id,
          is_admin: res.is_admin ?? false,
          permissions: res.permissions,
        });
        navigate("/");
      } else if (res.totp_setup_required && res.setup_token) {
        setSetupToken(res.setup_token);
        const init = await api.totpSetupInit(res.setup_token);
        setManuelSecret(init.secret);
        setQrDataUrl(await QRCode.toDataURL(init.otpauth_uri, { width: 220, margin: 1 }));
        setAsama("totp_kurulum");
      } else if (res.totp_required && res.pending_token) {
        setPendingToken(res.pending_token);
        setAsama("totp_dogrulama");
      } else {
        setHata("Beklenmeyen sunucu yanıtı, lütfen tekrar deneyin.");
      }
    } catch (err) {
      setHata((err as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }

  async function handleSetupConfirm(e: FormEvent) {
    e.preventDefault();
    if (!setupToken) return;
    setHata(null);
    setYukleniyor(true);
    try {
      const res = await api.totpSetupConfirm(setupToken, kod, cihaziHatirla);
      finishLogin(res);
      navigate("/");
    } catch (err) {
      setHata((err as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setHata(null);
    setYukleniyor(true);
    try {
      const res = await api.totpVerifyLogin(pendingToken, kod, cihaziHatirla);
      finishLogin(res);
      navigate("/");
    } catch (err) {
      setHata((err as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }

  function baştanBasla() {
    setAsama("girdi");
    setPassword("");
    setKod("");
    setSetupToken(null);
    setQrDataUrl(null);
    setManuelSecret(null);
    setPendingToken(null);
    setHata(null);
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <TemaButonu />
        <span className="logo-disc login-sign">
          <img src="/parla-tabela.jpg" alt="Parla Oyun Evi" />
        </span>
        <h1>Parla Oyun Evi</h1>

        {asama === "girdi" && (
          <>
            <p className="muted" style={{ marginBottom: 20 }}>Kasa girişi yapın</p>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label>Kullanıcı adı</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
              </div>
              <div className="field">
                <label>Şifre</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>

              {hata && <div className="alert alert--error">{hata}</div>}

              <button type="submit" disabled={yukleniyor} style={{ marginTop: 8 }}>
                {yukleniyor ? "Giriş yapılıyor..." : "Giriş Yap"}
              </button>
            </form>
          </>
        )}

        {asama === "totp_kurulum" && (
          <>
            <p className="muted" style={{ marginBottom: 12 }}>
              Hesabınızda iki adımlı doğrulama henüz kurulu değil. Google Authenticator (veya benzeri bir
              kimlik doğrulayıcı uygulama) ile aşağıdaki QR kodu okutun.
            </p>
            {qrDataUrl && (
              <img src={qrDataUrl} alt="TOTP QR kodu" style={{ margin: "0 auto 12px", display: "block" }} />
            )}
            {manuelSecret && (
              <p className="muted" style={{ marginBottom: 16, fontSize: 12 }}>
                QR kodu okutamıyorsanız bu kodu uygulamaya elle girin:
                <br />
                <code style={{ fontSize: 13, letterSpacing: 1 }}>{manuelSecret}</code>
              </p>
            )}
            <form onSubmit={handleSetupConfirm} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label>Uygulamadaki 6 haneli kod</label>
                <input
                  value={kod}
                  onChange={(e) => setKod(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  autoFocus
                />
              </div>
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, textAlign: "left" }}
              >
                <input
                  type="checkbox"
                  checked={cihaziHatirla}
                  onChange={(e) => setCihaziHatirla(e.target.checked)}
                />
                Bu cihazı hatırla (30 gün kod sorulmaz)
              </label>
              {hata && <div className="alert alert--error">{hata}</div>}
              <button type="submit" disabled={yukleniyor || kod.length !== 6}>
                {yukleniyor ? "Doğrulanıyor..." : "Kodu Doğrula ve Etkinleştir"}
              </button>
              <button type="button" className="ghost" onClick={baştanBasla}>Vazgeç</button>
            </form>
          </>
        )}

        {asama === "totp_dogrulama" && (
          <>
            <p className="muted" style={{ marginBottom: 20 }}>
              Kimlik doğrulayıcı uygulamanızdaki 6 haneli kodu girin.
            </p>
            <form onSubmit={handleVerify} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label>Doğrulama Kodu</label>
                <input
                  value={kod}
                  onChange={(e) => setKod(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  autoFocus
                />
              </div>
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, textAlign: "left" }}
              >
                <input
                  type="checkbox"
                  checked={cihaziHatirla}
                  onChange={(e) => setCihaziHatirla(e.target.checked)}
                />
                Bu cihazı hatırla (30 gün kod sorulmaz)
              </label>
              {hata && <div className="alert alert--error">{hata}</div>}
              <button type="submit" disabled={yukleniyor || kod.length !== 6}>
                {yukleniyor ? "Doğrulanıyor..." : "Giriş Yap"}
              </button>
              <button type="button" className="ghost" onClick={baştanBasla}>Vazgeç</button>
            </form>
          </>
        )}

        <p className="login-surum">
          <span className="surum-pill">{SURUM}</span>
        </p>
      </div>
    </div>
  );
}
