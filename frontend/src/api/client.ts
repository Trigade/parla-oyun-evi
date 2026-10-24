// Varsayılan olarak aynı origin üzerinden göreli /api yolu kullanılır (Vite
// dev server'daki proxy bunu backend'e (localhost:8080) yönlendirir, bkz.
// vite.config.ts). Böylece sayfa localhost, LAN IP'si veya ngrok gibi bir
// HTTPS tünel üzerinden açılsın fark etmez — ayrı bir backend tüneli/portu
// gerekmez ve HTTPS sayfadan HTTP'ye "mixed content" engeline takılmaz.
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

const TOKEN_KEY = "parla_token";
const IS_ADMIN_KEY = "parla_is_admin";
const PERMISSIONS_KEY = "parla_permissions";
const USER_ID_KEY = "parla_user_id";
// "Bu cihazı hatırla" anahtarı. Oturum kapatınca silinmez: amacı, aynı
// cihazda tekrar giriş yaparken Authenticator kodunun sorulmamasıdır.
// Tek başına giriş yapmaya yetmez, şifre yine gerekir.
const CIHAZ_TOKEN_KEY = "parla_cihaz_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getIsAdmin() {
  return localStorage.getItem(IS_ADMIN_KEY) === "true";
}

export function getPermissions(): string[] {
  const raw = localStorage.getItem(PERMISSIONS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function getUserId() {
  const v = localStorage.getItem(USER_ID_KEY);
  return v ? Number(v) : null;
}

export function setSession(token: string, isAdmin: boolean, permissions: string[], userId: number) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(IS_ADMIN_KEY, String(isAdmin));
  localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(permissions));
  localStorage.setItem(USER_ID_KEY, String(userId));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(IS_ADMIN_KEY);
  localStorage.removeItem(PERMISSIONS_KEY);
  localStorage.removeItem(USER_ID_KEY);
}

export function getCihazToken() {
  return localStorage.getItem(CIHAZ_TOKEN_KEY) ?? "";
}

function setCihazToken(token: string) {
  localStorage.setItem(CIHAZ_TOKEN_KEY, token);
}

// statusMesaji, sunucunun JSON gövdesinde açıklayıcı bir "hata" alanı
// döndürmediği durumlarda (ör. beklenmeyen bir sunucu hatası, ya da yanıt
// hiç JSON değilse) HTTP durum koduna göre kullanıcının anlayacağı bir
// Türkçe mesaj üretir. Amaç: kullanıcıya asla çıplak bir sayı/kod
// (ör. "İstek başarısız: 404") göstermemek.
function statusMesaji(status: number): string {
  switch (status) {
    case 400:
      return "Gönderilen bilgilerde bir sorun var, lütfen alanları kontrol edip tekrar deneyin.";
    case 403:
      return "Bu işlemi yapmak için yetkiniz yok.";
    case 404:
      return "Aradığınız kayıt bulunamadı. Sayfayı yenileyip tekrar deneyin.";
    case 409:
      return "Bu işlem şu anki kayıt durumuyla çakışıyor, sayfayı yenileyip tekrar deneyin.";
    case 413:
      return "Gönderilen veri çok büyük.";
    case 429:
      return "Çok fazla istek gönderildi, lütfen biraz bekleyip tekrar deneyin.";
    case 502:
    case 503:
    case 504:
      return "Sunucuya şu anda ulaşılamıyor, lütfen birazdan tekrar deneyin.";
    default:
      if (status >= 500) return "Sunucuda beklenmeyen bir hata oluştu. Sorun devam ederse yöneticinize bildirin.";
      return "İstek tamamlanamadı, lütfen tekrar deneyin.";
  }
}

// agBaglantiHatasiMi, fetch()'in ağ seviyesinde (sunucuya hiç ulaşamama,
// DNS/CORS engeli, bağlantı reddi vb.) başarısız olduğu durumu yakalar.
// Tarayıcı bu durumda "Failed to fetch" gibi teknik bir TypeError fırlatır;
// bunun yerine anlaşılır bir Türkçe mesaj gösterilir.
function agHatasiMesaji(): string {
  return "Sunucuya ulaşılamıyor. İnternet/ağ bağlantınızı ve sunucunun çalışır durumda olduğunu kontrol edip tekrar deneyin.";
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { ...headers, ...(options?.headers as Record<string, string>) },
      ...options,
    });
  } catch {
    throw new Error(agHatasiMesaji());
  }

  // /auth/login ve TOTP kurulum/doğrulama uçlarının kendi 401'i (yanlış
  // şifre, yanlış/süresi dolmuş TOTP kodu) bir "oturum süresi doldu" durumu
  // değildir — henüz hiç tam oturum yok. Bu durumda aşağıdaki genel 401
  // işleyicisi atlanır ki gerçek hata mesajı kullanıcıya gösterilebilsin,
  // sayfa zorla /login'e yönlendirilip akış sıfırlanmasın.
  const totpFlowPaths = ["/auth/login", "/auth/totp/setup-init", "/auth/totp/setup-confirm", "/auth/totp/verify-login"];
  if (res.status === 401 && !totpFlowPaths.includes(path)) {
    clearSession();
    window.location.href = "/login";
    throw new Error("Oturumunuzun süresi doldu, tekrar giriş yapın.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.hata ?? statusMesaji(res.status));
  }
  return res.json();
}

async function downloadFile(path: string, fallbackFilename: string, method: "GET" | "POST" = "GET") {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new Error(agHatasiMesaji());
  }
  if (res.status === 401) {
    clearSession();
    window.location.href = "/login";
    throw new Error("Oturumunuzun süresi doldu, tekrar giriş yapın.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.hata ?? statusMesaji(res.status));
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : fallbackFilename;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface OpenSession {
  id: number;
  customer_id: number;
  ad: string;
  soyad: string;
  giris_zamani: string;
  gecen_dakika: number;
  sure_secimi_dakika?: number;
  on_odeme_yapildi_mi: boolean;
  // Yalnızca erken ödemesi alınmış (on_odeme_yapildi_mi) oturumlarda dolu gelir.
  tahsil_tutar_kurus?: number;
  odeme_tipi?: "nakit" | "kredi_karti" | "paket";
}

export interface LoginResponse {
  token: string;
  user_id: number;
  is_admin: boolean;
  permissions: string[];
  // "Bu cihazı hatırla" işaretlendiyse yalnızca bu yanıtta döner.
  cihaz_token?: string;
}

export interface TrustedDevice {
  id: number;
  cihaz_adi: string;
  created_at: string;
  last_used_at?: string;
  expires_at: string;
}

// Login artık üç farklı sonuç dönebilir: TOTP hiç kurulmamışsa kurulum
// akışına (setup_token), kuruluysa kod doğrulamaya (pending_token) yönlendirir.
// Üçü de aynı LoginResponse şeklini üretir (setup-confirm / verify-login sonrası).
export interface LoginStepResponse {
  totp_setup_required?: boolean;
  setup_token?: string;
  totp_required?: boolean;
  pending_token?: string;
  // Cihaz hatırlanmışsa sunucu kod adımını atlar ve doğrudan tam oturum döner.
  token?: string;
  user_id?: number;
  is_admin?: boolean;
  permissions?: string[];
}

export interface TotpSetupInit {
  secret: string;
  otpauth_uri: string;
}

export interface DailyBreakdown {
  tarih: string;
  ciro_kurus: number;
  oturum_sayisi: number;
}

export interface Report {
  toplam_ciro_kurus: number;
  oturum_sayisi: number;
  nakit_kurus: number;
  nakit_sayisi: number;
  kredi_karti_kurus: number;
  kredi_karti_sayisi: number;
  gunluk_kirilim: DailyBreakdown[];
}

export interface CustomerListItem {
  id: number;
  tc_kimlik_no: string;
  ad: string;
  soyad: string;
  telefon: string;
  veli_telefon?: string;
  toplam_oturum: number;
  toplam_harcama_kurus: number;
  son_ziyaret?: string;
  acik_oturum_var: boolean;
  // Müşterinin süresi dolmamış aboneliğinin adı; paketi yoksa gelmez.
  aktif_paket?: string;
}

export interface CustomerSession {
  id: number;
  giris_zamani: string;
  cikis_zamani?: string;
  durum: string;
  toplam_dakika?: number;
  orijinal_tutar_kurus?: number;
  tahsil_tutar_kurus?: number;
  odeme_tipi?: string;
  manuel_kapatildi: boolean;
  paketten_dusulen_dakika: number;
}

export interface CustomerRecord {
  id: number;
  tc_kimlik_no: string;
  ad: string;
  soyad: string;
  telefon: string;
  veli_telefon?: string;
}

export interface CustomerLookupResult {
  bulundu: boolean;
  musteri?: {
    id: number;
    tc_kimlik_no: string;
    ad: string;
    soyad: string;
    telefon: string;
    veli_telefon?: string;
  };
}

export interface StaffUser {
  id: number;
  username: string;
  is_admin: boolean;
  permissions: string[];
  created_at: string;
  totp_enabled: boolean;
}

export interface PricingRule {
  id: number;
  kurus_per_dakika: number;
  effective_from: string;
}

export interface PricingTier {
  id: number;
  sira: number;
  min_dakika: number;
  max_dakika: number;
  tutar_kurus: number;
}

export interface PricingPolicy {
  version_id: number;
  effective_from: string;
  yuvarlama_tolerans_dakika: number;
  tiers: PricingTier[];
}

export interface PricingTierInput {
  min_dakika: number;
  max_dakika: number;
  tutar_kurus: number;
}

// Verilen dakikanın düştüğü bloğun ücretini bulur. Tanımlı en yüksek blok
// (son bloğun bitişi) bir "tur" oluşturur; bunu aşan sürelerde ücret modüler
// (döngüsel) hesaplanır — backend'deki tierUcretiniHesapla ile aynı mantık.
// Tolerans: ücret max(1, dakika - tolerans) dakikanın ücretidir (dakika 0 ise 0).
// Yalnızca canlı önizleme içindir, gerçek tutar sunucuda otoriter hesaplanır.
export function tierUcretiHesapla(dakika: number, policy: PricingPolicy | null): number | null {
  if (!policy || policy.tiers.length === 0) return null;
  if (dakika > 0) dakika = Math.max(1, dakika - policy.yuvarlama_tolerans_dakika);
  const sonTier = policy.tiers[policy.tiers.length - 1];
  const turDakika = sonTier.max_dakika;

  let kalanDakika = dakika;
  let tamTurSayisi = 0;
  if (dakika > turDakika) {
    tamTurSayisi = Math.floor(dakika / turDakika);
    kalanDakika = dakika % turDakika;
  }

  if (kalanDakika === 0) return tamTurSayisi * sonTier.tutar_kurus;
  const tier = policy.tiers.find((t) => kalanDakika >= t.min_dakika && kalanDakika <= t.max_dakika);
  return tier ? tamTurSayisi * sonTier.tutar_kurus + tier.tutar_kurus : null;
}

// Dakikayı "1 saat 30 dakika" gibi okunabilir Türkçe metne çevirir.
export function formatSureMetni(dakika: number): string {
  const saat = Math.floor(dakika / 60);
  const kalanDakika = dakika % 60;
  if (saat === 0) return `${kalanDakika} dakika`;
  if (kalanDakika === 0) return `${saat} saat`;
  return `${saat} saat ${kalanDakika} dakika`;
}

export interface BusinessDay {
  id: number;
  acilis_zamani: string;
  kapanis_zamani?: string;
  durum: string;
}

export interface CurrentBusinessDayResponse {
  acik: boolean;
  gun?: BusinessDay;
}

export interface PackageDefinition {
  id: number;
  // "bakiye" pakette dakika dolu, haftalik_gun/gunluk_dakika 0; aylik_ucret_kurus paket fiyatıdır.
  tur: "abonelik" | "bakiye";
  ad: string;
  grup: string;
  dakika?: number;
  haftalik_gun: number;
  gunluk_dakika: number;
  aylik_ucret_kurus: number;
  aktif: boolean;
}

export interface CustomerPackage {
  id: number;
  tur: "abonelik" | "bakiye";
  ad: string;
  grup: string;
  haftalik_gun: number;
  gunluk_dakika: number;
  toplam_dakika?: number;
  kalan_dakika?: number;
  kalan_deger_kurus?: number;
  tutar_kurus: number;
  odeme_tipi: string;
  satin_alma_zamani: string;
  gecerlilik_bitis: string;
  suresi_dolmus_mu: boolean;
}

// Müşterinin aktif paketindeki güncel hak kullanımı (kasa ekranı için).
export interface PackageStatus {
  var: boolean;
  customer_package_id?: number;
  tur?: "abonelik" | "bakiye";
  toplam_dakika?: number;
  kalan_dakika?: number;
  kalan_deger_kurus?: number;
  ad?: string;
  grup?: string;
  haftalik_gun?: number;
  gunluk_dakika?: number;
  bu_hafta_kullanilan_gun: number;
  bugun_kullanilan_dakika: number;
  kalan_gunluk_dakika: number;
  bugun_pakete_sayildi_mi: boolean;
  gun_hakki_doldu_mu: boolean;
  gecerlilik_bitis?: string;
}

export const api = {
  health: () => request<{ durum: string }>("/health"),
  login: (username: string, password: string) =>
    request<LoginStepResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, cihaz_token: getCihazToken() }),
    }),
  totpSetupInit: (setupToken: string) =>
    request<TotpSetupInit>("/auth/totp/setup-init", {
      method: "POST",
      headers: { Authorization: `Bearer ${setupToken}` },
    }),
  totpSetupConfirm: async (setupToken: string, code: string, cihaziHatirla = false) => {
    const res = await request<LoginResponse>("/auth/totp/setup-confirm", {
      method: "POST",
      headers: { Authorization: `Bearer ${setupToken}` },
      body: JSON.stringify({ code, cihazi_hatirla: cihaziHatirla }),
    });
    if (res.cihaz_token) setCihazToken(res.cihaz_token);
    return res;
  },
  totpVerifyLogin: async (pendingToken: string, code: string, cihaziHatirla = false) => {
    const res = await request<LoginResponse>("/auth/totp/verify-login", {
      method: "POST",
      headers: { Authorization: `Bearer ${pendingToken}` },
      body: JSON.stringify({ code, cihazi_hatirla: cihaziHatirla }),
    });
    if (res.cihaz_token) setCihazToken(res.cihaz_token);
    return res;
  },
  resetUserTotp: (id: number) => request(`/users/${id}/totp-reset`, { method: "POST" }),
  listUserDevices: (id: number) => request<TrustedDevice[]>(`/users/${id}/devices`),
  forgetUserDevice: (userId: number, cihazId: number) =>
    request(`/users/${userId}/devices/${cihazId}`, { method: "DELETE" }),
  lookupCustomerByTC: (tc: string) =>
    request<CustomerLookupResult>(`/customers/by-tc/${encodeURIComponent(tc)}`),
  lookupCustomerByPhone: (telefon: string) =>
    request<CustomerLookupResult>(`/customers/by-phone/${encodeURIComponent(telefon)}`),
  listOpenSessions: () => request<OpenSession[]>("/sessions/open"),
  startSession: (
    tc_kimlik_no: string,
    ad: string,
    soyad: string,
    telefon: string,
    veli_telefon: string,
    sure_secimi_dakika: number | null = null
  ) =>
    request("/sessions/start", {
      method: "POST",
      body: JSON.stringify({ tc_kimlik_no, ad, soyad, telefon, veli_telefon, sure_secimi_dakika }),
    }),
  // paketModu: "" (paket kullanılmaz) | "ucretsiz" (tamamı pakete sayılır)
  // | "asim" (günlük hak kadarı pakete sayılır, aşan süre tahsil edilir)
  closeSession: (
    id: number,
    odeme_tipi: "nakit" | "kredi_karti" | "paket",
    yuvarla: boolean,
    indirimKurus = 0,
    paketModu: "" | "ucretsiz" | "asim" = ""
  ) =>
    request(`/sessions/${id}/close`, {
      method: "POST",
      body: JSON.stringify({ odeme_tipi, yuvarla, indirim_kurus: indirimKurus, paket_modu: paketModu }),
    }),
  payEarlySession: (
    id: number,
    odeme_tipi: "nakit" | "kredi_karti" | "paket",
    yuvarla: boolean,
    indirimKurus = 0
  ) =>
    request(`/sessions/${id}/pay-early`, {
      method: "POST",
      body: JSON.stringify({ odeme_tipi, yuvarla, indirim_kurus: indirimKurus }),
    }),
  checkOutSession: (id: number) => request(`/sessions/${id}/check-out`, { method: "POST" }),
  extendSessionDuration: (id: number, ekDakika: number) =>
    request<{ id: number; sure_secimi_dakika: number }>(`/sessions/${id}/extend-duration`, {
      method: "POST",
      body: JSON.stringify({ ek_dakika: ekDakika }),
    }),
  manualCloseSession: (
    id: number,
    cikis_zamani: string,
    odeme_tipi: "nakit" | "kredi_karti",
    yuvarla: boolean
  ) =>
    request(`/sessions/${id}/manual-close`, {
      method: "POST",
      body: JSON.stringify({ cikis_zamani, odeme_tipi, yuvarla }),
    }),
  getReport: (from: string, to: string) =>
    request<Report>(`/reports?from=${from}&to=${to}`),
  exportSessionsPDF: (from: string, to: string) =>
    downloadFile(`/reports/export?from=${from}&to=${to}`, `oturumlar_${from}_${to}.pdf`),
  listCustomers: (q: string) =>
    request<CustomerListItem[]>(`/customers?q=${encodeURIComponent(q)}`),
  createCustomer: (
    tc_kimlik_no: string,
    ad: string,
    soyad: string,
    telefon: string,
    veli_telefon: string
  ) =>
    request<CustomerRecord>("/customers", {
      method: "POST",
      body: JSON.stringify({ tc_kimlik_no, ad, soyad, telefon, veli_telefon }),
    }),
  updateCustomer: (
    id: number,
    tc_kimlik_no: string,
    ad: string,
    soyad: string,
    telefon: string,
    veli_telefon: string
  ) =>
    request<{ id: number; tc_kimlik_no: string; ad: string; soyad: string; telefon: string; veli_telefon?: string }>(
      `/customers/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ tc_kimlik_no, ad, soyad, telefon, veli_telefon }),
      }
    ),
  getCustomerSessions: (id: number) =>
    request<CustomerSession[]>(`/customers/${id}/sessions`),
  deleteCustomer: (id: number) => request(`/customers/${id}`, { method: "DELETE" }),
  exportCustomerPDF: (id: number) =>
    downloadFile(`/customers/${id}/export`, `musteri_gecmisi_${id}.pdf`),
  listUsers: () => request<StaffUser[]>("/users"),
  createUser: (username: string, password: string, isAdmin: boolean, permissions: string[]) =>
    request<StaffUser>("/users", {
      method: "POST",
      body: JSON.stringify({ username, password, is_admin: isAdmin, permissions }),
    }),
  updateUser: (
    id: number,
    username: string,
    password: string | null,
    isAdmin: boolean,
    permissions: string[]
  ) =>
    request<StaffUser>(`/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        username,
        password: password ?? "",
        is_admin: isAdmin,
        permissions,
      }),
    }),
  deleteUser: (id: number) => request(`/users/${id}`, { method: "DELETE" }),
  getActivePricingRule: () => request<PricingRule>("/pricing-rules/active"),
  listPricingRules: () => request<PricingRule[]>("/pricing-rules"),
  createPricingRule: (kurusPerDakika: number) =>
    request<PricingRule>("/pricing-rules", {
      method: "POST",
      body: JSON.stringify({ kurus_per_dakika: kurusPerDakika }),
    }),
  getActivePricingPolicy: () => request<PricingPolicy>("/pricing-tiers/active"),
  listPricingPolicies: () => request<PricingPolicy[]>("/pricing-tiers"),
  createPricingPolicy: (tiers: PricingTierInput[], yuvarlama_tolerans_dakika: number) =>
    request<PricingPolicy>("/pricing-tiers", {
      method: "POST",
      body: JSON.stringify({ tiers, yuvarlama_tolerans_dakika }),
    }),
  getCurrentBusinessDay: () => request<CurrentBusinessDayResponse>("/business-day/current"),
  startBusinessDay: () =>
    request<BusinessDay>("/business-day/start", { method: "POST" }),
  endBusinessDay: (id: number) =>
    downloadFile(`/business-day/${id}/end`, `gun_sonu_${id}.pdf`, "POST"),
  listPackageDefinitions: () => request<PackageDefinition[]>("/package-definitions"),
  createPackageDefinition: (
    ad: string,
    grup: string,
    haftalikGun: number,
    gunlukDakika: number,
    aylikUcretKurus: number,
    tur: "abonelik" | "bakiye" = "abonelik",
    dakika = 0
  ) =>
    request<PackageDefinition>("/package-definitions", {
      method: "POST",
      body: JSON.stringify({
        ad,
        grup,
        tur,
        dakika,
        haftalik_gun: haftalikGun,
        gunluk_dakika: gunlukDakika,
        aylik_ucret_kurus: aylikUcretKurus,
      }),
    }),
  listCustomerPackages: (customerId: number) =>
    request<CustomerPackage[]>(`/customers/${customerId}/packages`),
  getCustomerPackageStatus: (customerId: number) =>
    request<PackageStatus>(`/customers/${customerId}/package-status`),
  purchasePackage: (
    customerId: number,
    packageDefinitionId: number,
    odemeTipi: "nakit" | "kredi_karti"
  ) =>
    request<CustomerPackage>(`/customers/${customerId}/packages`, {
      method: "POST",
      body: JSON.stringify({ package_definition_id: packageDefinitionId, odeme_tipi: odemeTipi }),
    }),
};
