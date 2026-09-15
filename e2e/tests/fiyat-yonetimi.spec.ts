import { test, expect, type Page } from "@playwright/test";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import * as api from "../utils/api";
import { loginViaStorage } from "../utils/auth";

async function gotoFiyatYonetimi(page: Page) {
  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/fiyat-yonetimi");
  await expect(page.getByRole("heading", { name: "Fiyat Yönetimi" })).toBeVisible();
}

test.describe("Fiyat Yönetimi", () => {
  test("aktif fiyat kuralı stat kartlarında görüntülenir", async ({ page }) => {
    await gotoFiyatYonetimi(page);
    await expect(page.locator(".stat-card__label", { hasText: "Güncel Saatlik Ücret" })).toBeVisible();
    await expect(page.locator(".stat-card__label", { hasText: "Dakika Başı Ücret" })).toBeVisible();
    await expect(page.locator(".stat-card__label", { hasText: "Geçerlilik Başlangıcı" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Fiyat Geçmişi" })).toBeVisible();
  });

  test("negatif saatlik ücret client-side hata mesajıyla engellenir (kaydedilmez)", async ({ page }) => {
    await gotoFiyatYonetimi(page);
    await page.getByPlaceholder("Örn: 60").fill("-25");
    await page.getByRole("button", { name: "Kaydet ve Uygula" }).click();

    await expect(page.getByText("Geçerli bir saatlik ücret girin.")).toBeVisible();
  });

  test("yeni fiyat kuralı eklenince aktif kural güncellenir (ve test sonunda eski değere geri döndürülür)", async ({ page }) => {
    // Bu test GERÇEK/canlı dakika ücretini değiştirir — bundan sonra kapanan tüm
    // oturumların tutar hesaplaması etkilenir. Bu yüzden varsayılan olarak ATLANIR;
    // bilinçli olarak çalıştırmak isteyen RUN_DESTRUCTIVE_TESTS=1 ayarlamalıdır.
    test.skip(
      !process.env.RUN_DESTRUCTIVE_TESTS,
      "Canlı fiyat kuralını değiştiren yıkıcı bir test; sadece RUN_DESTRUCTIVE_TESTS=1 ile çalışır."
    );

    const token = await api.adminToken();
    const orijinalKural = await api.getActivePricingRule(token);

    try {
      await gotoFiyatYonetimi(page);
      await page.getByPlaceholder("Örn: 60").fill("77");
      await page.getByRole("button", { name: "Kaydet ve Uygula" }).click();

      await expect(page.getByText(/itibarıyla geçerli\.$/)).toBeVisible();
      const yeniKural = await api.getActivePricingRule(token);
      expect(yeniKural.kurus_per_dakika).toBe(Math.round((77 * 100) / 60));
    } finally {
      await api.createPricingRule(token, orijinalKural.kurus_per_dakika);
    }
  });
});
