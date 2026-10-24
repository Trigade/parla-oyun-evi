import { test, expect, type Page } from "@playwright/test";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import * as api from "../utils/api";
import { loginViaStorage } from "../utils/auth";

// Fiyatlandırma artık dakika başı kural değil, sabit süre blokları (Fiyat Politikası) üzerinden.
async function gotoFiyatPolitikasi(page: Page) {
  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/fiyat-politikasi");
  await expect(page.getByRole("heading", { name: "Fiyat Politikası" })).toBeVisible();
}

test.describe("Fiyat Politikası", () => {
  test("sabit süre blokları ve fiyat geçmişi görüntülenir", async ({ page }) => {
    await gotoFiyatPolitikasi(page);
    await expect(page.getByRole("heading", { name: "Ücretleri Güncelle" })).toBeVisible();
    for (const etiket of ["30 Dakika", "60 Dakika", "90 Dakika", "2 Saat", "3 Saat", "5 Saat", "10 Saat"]) {
      await expect(page.getByLabel(etiket, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Fiyat Geçmişi" })).toBeVisible();
  });

  test("negatif ücret client-side hata mesajıyla engellenir (kaydedilmez)", async ({ page }) => {
    await gotoFiyatPolitikasi(page);
    await page.getByLabel("30 Dakika", { exact: true }).fill("-25");
    await page.getByRole("button", { name: "Kaydet ve Uygula" }).click();

    await expect(page.getByText("30 Dakika için geçerli bir ücret girin.")).toBeVisible();
  });

  test("yeni fiyat politikası eklenince aktif politika güncellenir (ve test sonunda eski değere geri döndürülür)", async ({ page }) => {
    // Bu test GERÇEK/canlı fiyatları değiştirir — bundan sonra kapanan tüm
    // oturumların tutar hesaplaması etkilenir. Bu yüzden varsayılan olarak ATLANIR;
    // bilinçli olarak çalıştırmak isteyen RUN_DESTRUCTIVE_TESTS=1 ayarlamalıdır.
    test.skip(
      process.env.RUN_DESTRUCTIVE_TESTS !== "1",
      "Canlı fiyat politikasını değiştiren yıkıcı bir test; sadece RUN_DESTRUCTIVE_TESTS=1 ile çalışır."
    );

    const token = await api.adminToken();
    const orijinal = await api.getActivePricingPolicy(token);
    const orijinalTiers = orijinal.tiers.map(({ min_dakika, max_dakika, tutar_kurus }) => ({ min_dakika, max_dakika, tutar_kurus }));

    try {
      await gotoFiyatPolitikasi(page);
      await page.getByLabel("30 Dakika", { exact: true }).fill("77");
      await page.getByRole("button", { name: "Kaydet ve Uygula" }).click();

      await expect(page.getByText(/itibarıyla geçerli\.$/)).toBeVisible();
      const yeni = await api.getActivePricingPolicy(token);
      expect(yeni.tiers[0].tutar_kurus).toBe(7700);
    } finally {
      await api.createPricingPolicy(token, orijinalTiers, orijinal.yuvarlama_tolerans_dakika);
    }
  });
});
