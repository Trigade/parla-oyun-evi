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
  await expect(page.getByText(/Bugün kalan: 4 saat · Bu hafta kalan: \d+ gün \(toplam .+\) · Paket bitişi: \d{2}\.\d{2}\.\d{4} \(\d+ gün kaldı\)/)).toBeVisible();
  await page.getByRole("button", { name: "Paketten Düş (Ücretsiz)" }).click();
  await expect(page.getByRole("cell", { name: `${ad} Musteri` })).toHaveCount(0, { timeout: 10000 });

  await oturumAcVeSec(page, 1);
  await expect(page.getByText(/Bugün kalan: 3 saat · Bu hafta kalan:/)).toBeVisible();
  await page.getByRole("button", { name: "Nakit Ödendi" }).click();
  await expect(page.getByRole("cell", { name: `${ad} Musteri` })).toHaveCount(0, { timeout: 10000 });
});
