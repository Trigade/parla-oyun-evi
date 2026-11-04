import { test, expect } from "@playwright/test";
import * as api from "../utils/api";
import { ADMIN_USERNAME, ADMIN_PASSWORD, API_BASE } from "../utils/api";
import { genUsername } from "../utils/tc";
import { oturumGirisiniGeriCek, psql, testMusterileriniSil } from "../utils/db";
import { fieldInput, loginViaStorage } from "../utils/auth";

// Yönetici kapanışta süreyi düzeltebilir (sure_duzeltme_dakika); paket aşımı tolerans
// içindeyse ücretsizdir. Gerçek süre beklenemeyeceği için yalnızca bu testin kendi
// oturumlarının giriş zamanı DB'den geriye çekilir. Tolerans API'den okunur.

const ad = `E2ESure${Date.now()}`;
const musteriIdleri: number[] = [];
const paketTanimIdleri: number[] = [];

test.afterAll(async () => {
  if (musteriIdleri.length) testMusterileriniSil(musteriIdleri);
  for (const id of paketTanimIdleri) psql(`UPDATE package_definitions SET aktif = false WHERE id = ${id}`);
});

function post(path: string, token: string, body: unknown) {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

// Backend tierUcretiSaf ile aynı mantık: ücret max(1, dakika-tolerans) dakikanın bloğudur.
function blokUcreti(policy: Awaited<ReturnType<typeof api.getActivePricingPolicy>>, dakika: number) {
  const d = Math.max(1, dakika - policy.yuvarlama_tolerans_dakika);
  const son = policy.tiers[policy.tiers.length - 1];
  const tur = d > son.max_dakika ? Math.floor(d / son.max_dakika) : 0;
  const kalan = d > son.max_dakika ? d % son.max_dakika : d;
  if (kalan === 0) return tur * son.tutar_kurus;
  return tur * son.tutar_kurus + policy.tiers.find((t) => kalan >= t.min_dakika && kalan <= t.max_dakika)!.tutar_kurus;
}

async function oturumlar(token: string, customerId: number) {
  return api.getCustomerSessions(token, customerId);
}

test("API: yönetici sure_duzeltme_dakika=60 ile kapatır; süre ve ücret 60 dk bloğuna göre", async () => {
  const token = await api.adminToken();
  const policy = await api.getActivePricingPolicy(token);
  const c = await api.createCheckedInTestCustomer(token, { ad, soyad: "Api" });
  musteriIdleri.push(c.customerId);
  oturumGirisiniGeriCek(c.sessionId, 150);

  const res = await post(`/sessions/${c.sessionId}/close`, token, {
    odeme_tipi: "nakit", yuvarla: false, indirim_kurus: 0, sure_duzeltme_dakika: 60,
  });
  expect(res.status).toBe(200);
  const govde = (await res.json()) as { toplam_dakika: number; tahsil_tutar_kurus: number };
  expect(govde.toplam_dakika).toBe(60);
  expect(govde.tahsil_tutar_kurus).toBe(blokUcreti(policy, 60));
  const oturum = (await oturumlar(token, c.customerId)).find((s) => s.id === c.sessionId)!;
  expect(oturum.toplam_dakika).toBe(60);
  expect(psql(`SELECT gercek_dakika FROM sessions WHERE id = ${c.sessionId}`)).toContain("150");
});

test("API: yönetici olmayan kullanıcının sure_duzeltme_dakika içeren kapatma isteği 403 döner", async () => {
  const token = await api.adminToken();
  const username = genUsername("surekasa");
  const password = "GecerliSifre123";
  const kasiyer = await api.createUser(token, { username, password, is_admin: false, permissions: [] });
  const c = await api.createCheckedInTestCustomer(token, { ad, soyad: "Kasiyer" });
  musteriIdleri.push(c.customerId);
  try {
    const kt = (await api.login(username, password)).token;
    const res = await post(`/sessions/${c.sessionId}/close`, kt, {
      odeme_tipi: "nakit", yuvarla: false, indirim_kurus: 0, sure_duzeltme_dakika: 60,
    });
    expect(res.status).toBe(403);
  } finally {
    await api.deleteUser(token, kasiyer.id);
  }
});

test("UI: yönetici kasada Süreyi Düzenle ile 1 saat girip Nakit kapatır", async ({ page }) => {
  const token = await api.adminToken();
  const c = await api.createCheckedInTestCustomer(token, { ad, soyad: "Arayuz" });
  musteriIdleri.push(c.customerId);
  oturumGirisiniGeriCek(c.sessionId, 150);

  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/");
  await page.getByRole("cell", { name: `${ad} Arayuz` }).click();
  await page.getByRole("button", { name: "Süreyi Düzenle" }).click();
  await fieldInput(page, "Saat").fill("1");
  await fieldInput(page, "Dakika").fill("0");
  await expect(page.getByText(/Süre düzeltildi/)).toBeVisible();
  await page.getByRole("button", { name: "Nakit Ödendi" }).click();
  await expect(page.getByRole("cell", { name: `${ad} Arayuz` })).toHaveCount(0, { timeout: 10000 });

  const oturum = (await oturumlar(token, c.customerId)).find((s) => s.id === c.sessionId)!;
  expect(oturum.toplam_dakika).toBe(60);
});

test("paket aşımı tolerans içindeyse ücretsiz, üstündeyse aşan süre ücretlendirilir", async () => {
  const token = await api.adminToken();
  const tolerans = (await api.getActivePricingPolicy(token)).yuvarlama_tolerans_dakika;
  test.skip(tolerans < 2, "tolerans 2 dakikadan küçükse 'tolerans içi' senaryosu kurulamaz");
  const tanim = await api.createPackageDefinition(token, {
    tur: "bakiye", ad: `E2E Tolerans ${Date.now()}`, dakika: 60, aylik_ucret_kurus: 10000,
  });
  paketTanimIdleri.push(tanim.id);

  // Her senaryoda ayrı müşteri + 60 dk bakiyeli paket; paket satılabilsin diye ilk oturum kapatılır.
  async function asimKapat(soyad: string, gecenDakika: number) {
    const c = await api.createCheckedInTestCustomer(token, { ad, soyad });
    musteriIdleri.push(c.customerId);
    await api.closeSession(token, c.sessionId);
    await api.purchasePackage(token, c.customerId, tanim.id, "nakit");
    const s = await api.startSession(token, { tc_kimlik_no: c.tc, ad, soyad, telefon: c.telefon });
    oturumGirisiniGeriCek(s.oturum.id, gecenDakika);
    const res = await post(`/sessions/${s.oturum.id}/close`, token, {
      odeme_tipi: "nakit", yuvarla: false, indirim_kurus: 0, paket_modu: "asim",
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { tahsil_tutar_kurus: number; paketten_dusulen_dakika: number };
  }

  const icinde = await asimKapat("TolIci", 60 + tolerans - 2);
  expect(icinde.paketten_dusulen_dakika).toBe(60);
  expect(icinde.tahsil_tutar_kurus).toBe(0);

  const ustunde = await asimKapat("TolUstu", 60 + tolerans + 20);
  expect(ustunde.paketten_dusulen_dakika).toBe(60);
  expect(ustunde.tahsil_tutar_kurus).toBeGreaterThan(0);
});

test("UI: bakiye aşımı tolerans içindeyse 'Paketten Düş' açık ve 0 TL ile kapatır", async ({ page }) => {
  const token = await api.adminToken();
  const tolerans = (await api.getActivePricingPolicy(token)).yuvarlama_tolerans_dakika;
  test.skip(tolerans < 2, "tolerans 2 dakikadan küçükse 'tolerans içi' senaryosu kurulamaz");
  const tanim = await api.createPackageDefinition(token, {
    tur: "bakiye", ad: `E2E TolUI ${Date.now()}`, dakika: 60, aylik_ucret_kurus: 10000,
  });
  paketTanimIdleri.push(tanim.id);
  const c = await api.createCheckedInTestCustomer(token, { ad, soyad: "TolUI" });
  musteriIdleri.push(c.customerId);
  await api.closeSession(token, c.sessionId);
  await api.purchasePackage(token, c.customerId, tanim.id, "nakit");
  const s = await api.startSession(token, { tc_kimlik_no: c.tc, ad, soyad: "TolUI", telefon: c.telefon });
  oturumGirisiniGeriCek(s.oturum.id, 60 + tolerans - 2);

  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/");
  await page.getByRole("cell", { name: `${ad} TolUI` }).click();
  await expect(page.getByText(/tolerans içinde, aşan süre ücretsiz/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Aşanı Tahsil Et/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Paketten Düş (Ücretsiz)" }).click();
  await expect(page.getByRole("cell", { name: `${ad} TolUI` })).toHaveCount(0, { timeout: 10000 });

  const oturum = (await api.getCustomerSessions(token, c.customerId)).find((x) => x.id === s.oturum.id) as
    | { tahsil_tutar_kurus: number }
    | undefined;
  expect(oturum?.tahsil_tutar_kurus).toBe(0);
});
