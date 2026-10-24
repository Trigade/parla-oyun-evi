import * as dotenv from "dotenv";
import { createHmac } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { psql } from "./db";
import { genValidTC, genValidPhone } from "./tc";
dotenv.config({ quiet: true });

export const API_BASE = process.env.API_BASE_URL ?? "http://localhost:5173/api";
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123456";

/**
 * Testlerin, UI'dan bağımsız olarak (hızlı ve güvenilir şekilde) ön koşul
 * verisi oluşturması/temizlemesi için backend'e doğrudan konuşan ince bir
 * yardımcı katman. UI testleri bu fonksiyonlarla test edilmiyor — sadece
 * UI testlerinin ihtiyaç duyduğu durumu (açık gün, test kullanıcısı,
 * test müşterisi vb.) hazırlamak/temizlemek için kullanılıyor.
 */

async function req<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${options.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export const TOTP_SECRET = process.env.E2E_TOTP_SECRET ?? "";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 6238 TOTP (SHA1, 6 hane, 30 sn) — backend/internal/auth/totp.go ile aynı parametreler. */
export function totpCode(secret: string = TOTP_SECRET, adim: number = Math.floor(Date.now() / 30000)): string {
  let bits = "";
  for (const c of secret.toUpperCase().replace(/[\s=]/g, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(adim));
  const h = createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// Backend aynı kullanıcı için kullanılmış 30 sn adımını (users.totp_son_adim) bir daha kabul etmez ve
// yalnızca daha büyük adımı kabul eder. Önceki koşulardan kalan durum için gerçek değeri DB'den okuruz.
/** `kullanici` için daha önce kullanılmamış (daha büyük) bir adımın kodunu üretir; gerekirse adım gelene kadar bekler. */
export async function totpKodu(kullanici: string, secret: string = TOTP_SECRET): Promise<string> {
  if (!/^[A-Za-z0-9_.-]+$/.test(kullanici)) throw new Error("geçersiz kullanıcı adı");
  const simdi = () => Math.floor(Date.now() / 30000);
  const hedef = () => {
    const son = psql(`SELECT totp_son_adim FROM users WHERE username = '${kullanici}'`);
    return Math.max((son === "" ? -Infinity : Number(son)) + 1, simdi());
  };
  let adim = hedef();
  // Şimdiki adım seçilir (UI'dan gönderim sürerken 30 sn sınırı geçilse bile -1 penceresi içinde kalır).
  // Backend -1/0/+1 kabul eder; adım bunun ötesindeyse sınırı bekle.
  while (adim > simdi() + 1) {
    await new Promise((r) => setTimeout(r, 500));
    adim = hedef();
  }
  return totpCode(secret, adim);
}

interface LoginResult {
  token: string;
  user_id: number;
  is_admin: boolean;
  permissions: string[];
}

/** Kullanıcı adı/şifre + (TOTP kuruluysa) E2E_TOTP_SECRET'tan üretilen kodla tam oturum token'ı alır. */
export const ADMIN_TOKEN_DOSYASI = join(__dirname, "..", ".auth", "admin-token.json");
const tokenOnbellek = new Map<string, LoginResult>();
export async function login(username: string, password: string): Promise<LoginResult> {
  // Aynı süreçte aynı kullanıcıyla tekrar TOTP girişi yapmamak için başarılı girişi önbelleğe al (token 12 saat geçerli).
  const key = `${username}:${password}`;
  const onbellekte = tokenOnbellek.get(key);
  if (onbellekte) return onbellekte;
  // Admin için global-setup'ın yazdığı oturum varsa kullan (TOTP beklemesi test timeout'una girmesin); geçersizse normal giriş.
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD && existsSync(ADMIN_TOKEN_DOSYASI)) {
    try {
      const kayit = JSON.parse(readFileSync(ADMIN_TOKEN_DOSYASI, "utf-8")) as LoginResult;
      await req("/business-day/current", {}, kayit.token); // 401 ise fırlatır
      tokenOnbellek.set(key, kayit);
      return kayit;
    } catch {}
  }
  const sonuc = await tamGiris(username, password);
  tokenOnbellek.set(key, sonuc);
  return sonuc;
}

async function tamGiris(username: string, password: string): Promise<LoginResult> {
  const res = await req<any>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  if (res.token) return res;
  // Test kullanıcıları (createUser) TOTP'siz doğar: ilk girişte kurulumu API'den tamamla.
  // Sır yalnızca bu çağrıda kullanılır; aynı kullanıcı sonradan tekrar girerse kod üretilemez.
  if (res.totp_setup_required) {
    const kurulum = await req<{ secret: string }>("/auth/totp/setup-init", { method: "POST" }, res.setup_token);
    return req("/auth/totp/setup-confirm", { method: "POST", body: JSON.stringify({ code: totpCode(kurulum.secret) }) }, res.setup_token);
  }
  if (!TOTP_SECRET) throw new Error("TOTP gerekli ama E2E_TOTP_SECRET tanımlı değil (.env)");
  // Aynı süreçte aynı kullanıcı için ilk TOTP hatasını sakla; tekrar denemeler 429'a dönüşmesin.
  const eski = totpHata.get(username);
  if (eski) throw eski;
  try {
    return await req("/auth/totp/verify-login", { method: "POST", body: JSON.stringify({ code: await totpKodu(username) }) }, res.pending_token);
  } catch (e) {
    totpHata.set(username, e as Error);
    throw e;
  }
}
const totpHata = new Map<string, Error>();

let cachedAdminToken: string | null = null;
export async function adminToken(): Promise<string> {
  if (cachedAdminToken) return cachedAdminToken;
  const res = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  cachedAdminToken = res.token;
  return cachedAdminToken;
}

export async function createUser(
  token: string,
  data: { username: string; password: string; is_admin: boolean; permissions: string[] }
): Promise<{ id: number; username: string; is_admin: boolean; permissions: string[] }> {
  return req("/users", { method: "POST", body: JSON.stringify(data) }, token);
}

export async function deleteUser(token: string, id: number): Promise<void> {
  await req(`/users/${id}`, { method: "DELETE" }, token);
}

export interface StaffUser {
  id: number;
  username: string;
  is_admin: boolean;
  permissions: string[];
}

export async function listUsers(token: string): Promise<StaffUser[]> {
  return req("/users", {}, token);
}

/** Kullanıcı adına göre bulup siler (id'yi elde tutmak istemeyen temizlik kodları için). */
export async function deleteUserByUsername(token: string, username: string): Promise<void> {
  const users = await listUsers(token);
  const found = users.find((u) => u.username === username);
  if (found) await deleteUser(token, found.id);
}

export async function getCurrentBusinessDay(
  token: string
): Promise<{ acik: boolean; gun?: { id: number; acilis_zamani: string; durum: string } }> {
  return req("/business-day/current", {}, token);
}

export async function startBusinessDay(token: string): Promise<{ id: number }> {
  return req("/business-day/start", { method: "POST" }, token);
}

/** Gün açık değilse açar; zaten açıksa hiçbir şey yapmaz (idempotent). */
export async function ensureGunAcik(token: string): Promise<void> {
  const durum = await getCurrentBusinessDay(token);
  if (!durum.acik) {
    await startBusinessDay(token);
  }
}

export interface OpenSession {
  id: number;
  customer_id: number;
  ad: string;
  soyad: string;
  giris_zamani: string;
  gecen_dakika: number;
}

export async function listOpenSessions(token: string): Promise<OpenSession[]> {
  return req("/sessions/open", {}, token);
}

export async function closeSession(
  token: string,
  id: number,
  odemeTipi: "nakit" | "kredi_karti" = "nakit"
): Promise<void> {
  await req(
    `/sessions/${id}/close`,
    { method: "POST", body: JSON.stringify({ odeme_tipi: odemeTipi, yuvarla: false, indirim_kurus: 0 }) },
    token
  );
}

export async function startSession(
  token: string,
  data: { tc_kimlik_no: string; ad: string; soyad: string; telefon: string; veli_telefon?: string }
): Promise<{ musteri: { id: number }; oturum: { id: number } }> {
  return req(
    "/sessions/start",
    { method: "POST", body: JSON.stringify({ veli_telefon: "", ...data }) },
    token
  );
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
  acik_oturum_var: boolean;
}

export async function listCustomers(token: string, q = ""): Promise<CustomerListItem[]> {
  return req(`/customers?q=${encodeURIComponent(q)}`, {}, token);
}

export async function getActivePricingRule(token: string): Promise<{ kurus_per_dakika: number }> {
  return req("/pricing-rules/active", {}, token);
}

export async function createPricingRule(token: string, kurusPerDakika: number): Promise<{ id: number }> {
  return req("/pricing-rules", { method: "POST", body: JSON.stringify({ kurus_per_dakika: kurusPerDakika }) }, token);
}

/**
 * Test amaçlı bir müşteri oluşturup içeri giriş yapar (oturum açar) ve
 * kapatmak için kullanılabilecek oturum id'sini döner. Gün kapalıysa
 * önce açar. Testin kendi ürettiği benzersiz TC/telefon ile çalışır,
 * mevcut/gerçek verilere dokunmaz.
 */
export async function createCheckedInTestCustomer(
  token: string,
  overrides: Partial<{ tc: string; ad: string; soyad: string; telefon: string }> = {}
): Promise<{ customerId: number; sessionId: number; ad: string; soyad: string; tc: string; telefon: string }> {
  await ensureGunAcik(token);
  const tc = overrides.tc ?? genValidTC();
  const ad = overrides.ad ?? "E2E";
  const soyad = overrides.soyad ?? "Test";
  const telefon = overrides.telefon ?? genValidPhone();
  const res = await startSession(token, { tc_kimlik_no: tc, ad, soyad, telefon });
  return { customerId: res.musteri.id, sessionId: res.oturum.id, ad, soyad, tc, telefon };
}

export interface PricingTier {
  min_dakika: number;
  max_dakika: number;
  tutar_kurus: number;
}

export async function getActivePricingPolicy(token: string): Promise<{ version_id: number; yuvarlama_tolerans_dakika: number; tiers: PricingTier[] }> {
  return req("/pricing-tiers/active", {}, token);
}

export async function createPricingPolicy(token: string, tiers: PricingTier[], yuvarlama_tolerans_dakika?: number): Promise<{ version_id: number }> {
  return req("/pricing-tiers", { method: "POST", body: JSON.stringify({ tiers, yuvarlama_tolerans_dakika }) }, token);
}

export interface CustomerPackage {
  id: number;
  tur: "abonelik" | "bakiye";
  toplam_dakika?: number;
  kalan_dakika?: number;
  kalan_deger_kurus?: number;
  tutar_kurus: number;
}

export async function createPackageDefinition(
  token: string,
  data: { tur: "abonelik" | "bakiye"; ad: string; dakika?: number; haftalik_gun?: number; gunluk_dakika?: number; aylik_ucret_kurus: number }
): Promise<{ id: number }> {
  return req("/package-definitions", { method: "POST", body: JSON.stringify(data) }, token);
}

export async function purchasePackage(
  token: string,
  customerId: number,
  packageDefinitionId: number,
  odemeTipi: "nakit" | "kredi_karti" = "nakit"
): Promise<CustomerPackage> {
  return req(
    `/customers/${customerId}/packages`,
    { method: "POST", body: JSON.stringify({ package_definition_id: packageDefinitionId, odeme_tipi: odemeTipi }) },
    token
  );
}

export async function listCustomerPackages(token: string, customerId: number): Promise<CustomerPackage[]> {
  return req(`/customers/${customerId}/packages`, {}, token);
}

export async function getPackageStatus(token: string, customerId: number): Promise<{ var: boolean; kalan_dakika?: number }> {
  return req(`/customers/${customerId}/package-status`, {}, token);
}

export async function getCustomerSessions(
  token: string,
  customerId: number
): Promise<{ id: number; durum: string; toplam_dakika?: number; tahsil_tutar_kurus?: number; paketten_dusulen_dakika: number }[]> {
  return req(`/customers/${customerId}/sessions`, {}, token);
}

export async function deleteCustomer(token: string, id: number): Promise<void> {
  await req(`/customers/${id}`, { method: "DELETE" }, token);
}

/** TC ile müşteri id'sini bulur (UI'dan oluşturulan test müşterilerini temizlemek için); yoksa null. */
export async function findCustomerIdByTC(token: string, tc: string): Promise<number | null> {
  const res = await req<{ bulundu: boolean; musteri?: { id: number } }>(`/customers/by-tc/${tc}`, {}, token);
  return res.bulundu && res.musteri ? res.musteri.id : null;
}
