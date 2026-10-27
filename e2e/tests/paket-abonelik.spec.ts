import { test, expect } from "@playwright/test";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import * as api from "../utils/api";
import { genValidTC, genValidPhone } from "../utils/tc";
import { oturumGirisiniGeriCek, psql, testMusterileriniSil } from "../utils/db";
import { loginViaUIWithTotp } from "../utils/auth";

// Abonelik (haftada 5 gün, günde 4 saat): kasada kalan süre özeti görünmeli ve 1 saat "Paketten Düş"
// sonrası "Bugün kalan" 4 saatten 3 saate inmeli. Hafta içi kalan gün sayısı test anının gününe
// bağlı olduğundan yalnızca zamandan bağımsız kısım doğrulanır.

const ad = `E2EAbonelik${Date.now()}`;
let paketTanimId = 0;
let musteriId = 0;
let tc = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const token = await api.adminToken();
  await api.ensureGunAcik(token);
  const tanim = await api.createPackageDefinition(token, {
    tur: "abonelik",
    ad: `E2E Abonelik ${Date.now()}`,
    haftalik_gun: 5,
    gunluk_dakika: 240,
    aylik_ucret_kurus: 100000,
  });
  paketTanimId = tanim.id;

  tc = genValidTC();
  const c = await api.createCheckedInTestCustomer(token, { tc, ad, soyad: "Musteri", telefon: genValidPhone() });
  musteriId = c.customerId;
  await api.closeSession(token, c.sessionId);
  await api.purchasePackage(token, musteriId, paketTanimId, "nakit");
});

test.afterAll(async () => {
  if (musteriId) testMusterileriniSil([musteriId]);
  if (paketTanimId) psql(`UPDATE package_definitions SET aktif = false WHERE id = ${paketTanimId}`);
});

async function oturumAcVeSec(page: import("@playwright/test").Page, dakikaGeri: number) {
  const token = await api.adminToken();
  const s = await api.startSession(token, { tc_kimlik_no: tc, ad, soyad: "Musteri", telefon: genValidPhone() });
  oturumGirisiniGeriCek(s.oturum.id, dakikaGeri);
  await page.goto("/");
  await page.getByRole("cell", { name: `${ad} Musteri` }).click();
}

test("kasada abonelik özeti görünür; 1 saat 'Paketten Düş' sonrası bugün kalan 4 saatten 3 saate düşer", async ({ page }) => {
  await loginViaUIWithTotp(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await expect(page.getByRole("heading", { name: "Kasa Ekranı" })).toBeVisible();

  await oturumAcVeSec(page, 60);
  await expect(page.getByText(/Bu hafta kalan: .+ · Paketten kalan toplam: .+ · Paket bitişi: \d{2}\.\d{2}\.\d{4} \(\d+ gün kaldı\)/)).toBeVisible();
  await expect(page.getByText(/Bugün kalan: 4 saat · Bu hafta \d+\/5 gün kullanıldı/)).toBeVisible();
  await page.getByRole("button", { name: "Paketten Düş (Ücretsiz)" }).click();
  await expect(page.getByRole("cell", { name: `${ad} Musteri` })).toHaveCount(0, { timeout: 10000 });

  await oturumAcVeSec(page, 1);
  await expect(page.getByText(/Bugün kalan: 3 saat · Bu hafta \d+\/5 gün kullanıldı/)).toBeVisible();
  await page.getByRole("button", { name: "Nakit Ödendi" }).click();
  await expect(page.getByRole("cell", { name: `${ad} Musteri` })).toHaveCount(0, { timeout: 10000 });
});

test("Müşteriler listesinde abonelik 'Kalan Süre' hücresi bu hafta ve toplam süreyi gösterir", async ({ page }) => {
  await loginViaUIWithTotp(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/musteriler");
  await page.getByPlaceholder(/Örn: Ahmet/).fill(ad);
  const satir = page.getByRole("row", { name: new RegExp(`${ad} Musteri`) });
  await expect(satir.getByText(/Bu hafta .+ · Toplam .+/)).toBeVisible();
});

test("günlük hakkı aşan oturumda 'Paketten Düş' uyarı paneli açar; Vazgeç kapatır, Aşanı Tahsil Et aşanı tahsil eder", async ({ page }) => {
  // Aynı günün önceki testlerinden kalan kullanım etkilemesin diye yeni müşteri.
  const token = await api.adminToken();
  const tc2 = genValidTC();
  const ad2 = `E2EAsim${Date.now()}`;
  const c = await api.createCheckedInTestCustomer(token, { tc: tc2, ad: ad2, soyad: "Musteri", telefon: genValidPhone() });
  try {
    await api.closeSession(token, c.sessionId);
    await api.purchasePackage(token, c.customerId, paketTanimId, "nakit");
    const s = await api.startSession(token, { tc_kimlik_no: tc2, ad: ad2, soyad: "Musteri", telefon: genValidPhone() });
    oturumGirisiniGeriCek(s.oturum.id, 360);

    await loginViaUIWithTotp(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await page.getByRole("cell", { name: `${ad2} Musteri` }).click();
    await expect(page.getByText(/Günlük hakkı 2 saat aşıyor/)).toBeVisible();
    await page.getByRole("button", { name: "Paketten Düş (Ücretsiz)" }).click();
    await expect(page.getByRole("heading", { name: "Günlük paket hakkı aşıldı" })).toBeVisible();
    await expect(page.getByText(/2 saat fazla/)).toBeVisible();

    await page.getByRole("button", { name: "Vazgeç" }).click();
    await expect(page.getByRole("heading", { name: "Günlük paket hakkı aşıldı" })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: `${ad2} Musteri` })).toBeVisible();

    await page.getByRole("button", { name: "Paketten Düş (Ücretsiz)" }).click();
    await page.getByRole("dialog").or(page.locator(".modal")).getByRole("button", { name: "Aşanı Tahsil Et: Nakit" }).click();
    await expect(page.getByRole("cell", { name: `${ad2} Musteri` })).toHaveCount(0, { timeout: 10000 });

    const oturum = (await api.getCustomerSessions(token, c.customerId)).find((x) => x.id === s.oturum.id)!;
    expect(oturum.paketten_dusulen_dakika).toBe(240);
    expect(oturum.tahsil_tutar_kurus).toBeGreaterThan(0);
  } finally {
    testMusterileriniSil([c.customerId]);
  }
});
