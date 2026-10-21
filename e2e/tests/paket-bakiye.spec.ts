import { test, expect } from "@playwright/test";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import * as api from "../utils/api";
import { genValidTC, genValidPhone } from "../utils/tc";
import { oturumGirisiniGeriCek, psql, testMusterileriniSil } from "../utils/db";
import { loginViaUIWithTotp } from "../utils/auth";

// Saat bakiyeli paket: 10 saatlik paketten 1 saat kullanılınca 9 saat kalmalı ve değeri de
// azalmalı; bakiyeyi aşan oturum ücretsiz düşülemez, aşanı tahsil edilir. Kurulum API ile,
// kritik adımlar (giriş, müşteri seçimi, paketten düş) UI'dan. Gerçek 1 saat beklenemeyeceği
// için yalnızca bu testin kendi oturumlarının giriş zamanı DB'den geriye çekilir.

const PAKET_KURUS = 150000;
const ad = `E2EBakiye${Date.now()}`;
let paketTanimId = 0;
let musteriId = 0;
let tc = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const token = await api.adminToken();
  await api.ensureGunAcik(token);
  const tanim = await api.createPackageDefinition(token, {
    tur: "bakiye",
    ad: `E2E 10 Saatlik ${Date.now()}`,
    dakika: 600,
    aylik_ucret_kurus: PAKET_KURUS,
  });
  paketTanimId = tanim.id;

  // Müşteri, ilk oturumla birlikte oluşur; paketi sattıktan sonra oturumu kapatıp yeniden açacağız.
  tc = genValidTC();
  const c = await api.createCheckedInTestCustomer(token, { tc, ad, soyad: "Musteri", telefon: genValidPhone() });
  musteriId = c.customerId;
  await api.closeSession(token, c.sessionId);
  await api.purchasePackage(token, musteriId, paketTanimId, "nakit");
});

test.afterAll(async () => {
  // Hata olsa da çalışır; yalnızca bu testin ürettiği kayıtlara dokunur.
  if (musteriId) testMusterileriniSil([musteriId]);
  if (paketTanimId) psql(`UPDATE package_definitions SET aktif = false WHERE id = ${paketTanimId}`);
});

async function oturumAcVeSec(page: import("@playwright/test").Page, dakikaGeri: number) {
  const token = await api.adminToken();
  const s = await api.startSession(token, { tc_kimlik_no: tc, ad, soyad: "Musteri", telefon: genValidPhone() });
  oturumGirisiniGeriCek(s.oturum.id, dakikaGeri);
  await page.goto("/");
  await page.getByRole("cell", { name: `${ad} Musteri` }).click();
  return s.oturum.id;
}

test("1 saat kullanılıp 'Paketten Düş' ile kapatılınca bakiye 9 saate ve değer 1.350 TL'ye düşer", async ({ page }) => {
  const token = await api.adminToken();
  await loginViaUIWithTotp(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await expect(page.getByRole("heading", { name: "Kasa Ekranı" })).toBeVisible();

  const oturumId = await oturumAcVeSec(page, 60);
  await expect(page.getByText(/Kalan bakiye: 10 saat \(.*1\.500,00.* değerinde\) \/ toplam 10 saat/)).toBeVisible();
  await page.getByRole("button", { name: "Paketten Düş (Ücretsiz)" }).click();
  await expect(page.getByRole("cell", { name: `${ad} Musteri` })).toHaveCount(0, { timeout: 10000 });

  const [paket] = await api.listCustomerPackages(token, musteriId);
  expect(paket.kalan_dakika).toBe(540);
  expect(paket.kalan_deger_kurus).toBe((PAKET_KURUS * 9) / 10);
  const oturum = (await api.getCustomerSessions(token, musteriId)).find((s) => s.id === oturumId)!;
  expect(oturum.paketten_dusulen_dakika).toBe(60);
  expect(oturum.tahsil_tutar_kurus).toBe(0);

  // Yeni oturum açılınca kasada 9 saat görünür.
  await oturumAcVeSec(page, 1);
  await expect(page.getByText(/Kalan bakiye: 9 saat \(.*1\.350,00.* değerinde\) \/ toplam 10 saat/)).toBeVisible();
  await page.getByRole("button", { name: "Nakit Ödendi" }).click(); // 1 dk'lık oturum: bakiyeden değil normal ücretle kapanır
  await expect(page.getByRole("cell", { name: `${ad} Musteri` })).toHaveCount(0, { timeout: 10000 });
});

test("kalan bakiyeyi aşan oturumda 'Paketten Düş' devre dışıdır; 'Aşanı Tahsil Et: Nakit' bakiyeyi sıfırlar", async ({ page }) => {
  const token = await api.adminToken();
  await loginViaUIWithTotp(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await expect(page.getByRole("heading", { name: "Kasa Ekranı" })).toBeVisible();

  const oturumId = await oturumAcVeSec(page, 600); // 540 dk kalanı 60 dk aşar
  await expect(page.getByText(/Kalan bakiye: 9 saat/)).toBeVisible();
  await expect(page.getByText(/Kalan bakiyeyi 1 saat aşıyor/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Paketten Düş (Ücretsiz)" })).toBeDisabled();
  await page.getByRole("button", { name: "Aşanı Tahsil Et: Nakit" }).click();
  await expect(page.getByRole("cell", { name: `${ad} Musteri` })).toHaveCount(0, { timeout: 10000 });

  const [paket] = await api.listCustomerPackages(token, musteriId);
  expect(paket.kalan_dakika ?? 0).toBe(0); // omitempty: 0 alanda görünmez
  expect((await api.getPackageStatus(token, musteriId)).var).toBe(false);
  const oturum = (await api.getCustomerSessions(token, musteriId)).find((s) => s.id === oturumId)!;
  expect(oturum.paketten_dusulen_dakika).toBe(540);
  expect(oturum.tahsil_tutar_kurus).toBeGreaterThan(0);
});
