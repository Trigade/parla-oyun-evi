import { test, expect } from "@playwright/test";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import * as api from "../utils/api";
import { genValidTC, genValidPhone } from "../utils/tc";
import { loginViaStorage } from "../utils/auth";
import { testMusterileriniSil } from "../utils/db";

const tcToCleanup: string[] = []; // UI'dan kaydedilen müşteriler: id, TC ile afterEach'te çözülür

// Test başarısız olsa da, yalnızca bu testlerin ürettiği müşteriler (oturum/paketleriyle) silinir.
test.afterEach(async () => {
  const token = await api.adminToken();
  const ids: number[] = [];
  for (const tc of tcToCleanup.splice(0)) {
    const id = await api.findCustomerIdByTC(token, tc);
    if (id) ids.push(id);
  }
  testMusterileriniSil(ids);
});

test.describe("Genel / Edge Case'ler", () => {
  test("Türkçe karakterli isim (ç, ğ, ı, ö, ş, ü) doğru şekilde kaydedilir ve render edilir", async ({ page }) => {
    const token = await api.adminToken();
    await api.ensureGunAcik(token);
    await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await page.goto("/");

    const tc = genValidTC();
    tcToCleanup.push(tc);
    const soyad = `Öztürk-Çağlış${Date.now()}`;
    await page.getByPlaceholder("12345678901").fill(tc);
    await page.getByRole("button", { name: "Sorgula" }).click();
    await expect(page.getByText("ile kayıtlı müşteri bulunamadı")).toBeVisible();

    await page.getByPlaceholder("Ad", { exact: true }).fill("Şükrü İğde");
    await page.getByPlaceholder("Soyad").fill(soyad);
    const telAlanlari1 = page.locator('input[placeholder="05xxxxxxxxx"]');
    await telAlanlari1.first().fill(genValidPhone());
    // telefonun onBlur doğrulama isteğiyle "Kaydet" tıklamasının çakışmaması için odağı ayır
    await telAlanlari1.nth(1).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Kaydet ve Giriş Yap" }).click();

    await expect(page.getByRole("cell", { name: `Şükrü İğde ${soyad}` })).toBeVisible();
  });

  test("101 karakterlik ad backend tarafından reddedilir (100 karakter sınırı)", async ({ page }) => {
    const token = await api.adminToken();
    await api.ensureGunAcik(token);
    await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await page.goto("/");

    const tc = genValidTC();
    tcToCleanup.push(tc); // reddedilmesi beklenir; yine de kayıt sızarsa temizlensin
    await page.getByPlaceholder("12345678901").fill(tc);
    await page.getByRole("button", { name: "Sorgula" }).click();
    await expect(page.getByText("ile kayıtlı müşteri bulunamadı")).toBeVisible();

    const cokUzunAd = "A".repeat(101);
    await page.getByPlaceholder("Ad", { exact: true }).fill(cokUzunAd);
    await page.getByPlaceholder("Soyad").fill("Soyad");
    const telAlanlari2 = page.locator('input[placeholder="05xxxxxxxxx"]');
    await telAlanlari2.first().fill(genValidPhone());
    await telAlanlari2.nth(1).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Kaydet ve Giriş Yap" }).click();

    await expect(page.getByText("en fazla 100 karakter olabilir")).toBeVisible();
    // reddedildiği için İçeride Olanlar'a düşmemeli
    await expect(page.getByRole("cell", { name: new RegExp(`^${cokUzunAd} Soyad$`) })).toHaveCount(0);
  });

  test("TC alanına harf girilmeye çalışılınca otomatik olarak rakamla filtrelenir", async ({ page }) => {
    await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await page.goto("/");

    const tcAlani = page.getByPlaceholder("12345678901");
    await tcAlani.fill("abc123def456ghi");
    const deger = await tcAlani.inputValue();
    expect(deger).toMatch(/^\d*$/); // sadece rakam kalmalı, harf kalmamalı
    expect(deger.length).toBeGreaterThan(0);
  });

  test("telefon alanına 11 haneden fazla rakam girilemez", async ({ page }) => {
    await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await page.goto("/");
    await page.getByRole("button", { name: "Telefon ile" }).click();

    const telAlani = page.getByPlaceholder("05xxxxxxxxx");
    await telAlani.fill("055512345678999");
    const deger = await telAlani.inputValue();
    expect(deger.length).toBeLessThanOrEqual(11);
  });
});
