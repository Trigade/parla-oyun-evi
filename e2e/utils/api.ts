import * as dotenv from "dotenv";
import { genValidTC, genValidPhone } from "./tc";
dotenv.config({ quiet: true });

export const API_BASE = process.env.API_BASE_URL ?? "http://localhost:8080/api";
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

export async function login(username: string, password: string): Promise<{
  token: string;
  user_id: number;
  is_admin: boolean;
  permissions: string[];
}> {
  return req("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

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
