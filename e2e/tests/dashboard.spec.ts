import { test, expect, type Page } from "@playwright/test";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import { loginViaStorage } from "../utils/auth";

async function gotoDashboard(page: Page) {
  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Yönetici Dashboard'u" })).toBeVisible();
}

test.describe("Yönetici Dashboard", () => {
  test("preset butonları arasında geçiş yapılabilir ve aktif buton değişir", async ({ page }) => {
    await gotoDashboard(page);

    const bugun = page.getByRole("button", { name: "Bugün" });
    const buHafta = page.getByRole("button", { name: "Bu Hafta" });
    const buAy = page.getByRole("button", { name: "Bu Ay" });

    await expect(bugun).toHaveClass(/preset-active/);
    await buHafta.click();
    await expect(buHafta).toHaveClass(/preset-active/);
    await expect(page.getByRole("heading", { name: "Haftalık Ciro" })).toBeVisible();

    await buAy.click();
    await expect(buAy).toHaveClass(/preset-active/);
    await expect(page.getByRole("heading", { name: "Aylık Ciro" })).toBeVisible();
  });

  test("Özel Aralık seçilince tarih inputları görünür ve değiştirilebilir", async ({ page }) => {
    await gotoDashboard(page);
    await page.getByRole("button", { name: "Özel Aralık" }).click();

    const tarihInputlari = page.locator('input[type="date"]');
    await expect(tarihInputlari).toHaveCount(2);
    await tarihInputlari.first().fill("2000-01-01");
    await tarihInputlari.last().fill("2000-01-31");

    await expect(page.getByRole("heading", { name: "Özel Aralık Cirosu" })).toBeVisible();
  });

  test("veri olmayan bir aralıkta uyarı mesajı gösterilir", async ({ page }) => {
    await gotoDashboard(page);
    await page.getByRole("button", { name: "Özel Aralık" }).click();
    const tarihInputlari = page.locator('input[type="date"]');
    await tarihInputlari.first().fill("2000-01-01");
    await tarihInputlari.last().fill("2000-01-02");

    await expect(page.getByText("Bu aralıkta kapanmış oturum yok.")).toBeVisible();
    // Oturum Sayısı stat kartı 0 olmalı (bu tarih aralığında hiç veri yok).
    const oturumSayisiKart = page.locator(".stat-card", { hasText: "Oturum Sayısı" });
    await expect(oturumSayisiKart.locator(".stat-card__value")).toHaveText("0");
  });

  test("stat kartları ve ödeme tipi dağılım tablosu görünür", async ({ page }) => {
    await gotoDashboard(page);
    await expect(page.locator(".stat-card__label", { hasText: "Toplam Ciro" })).toBeVisible();
    await expect(page.locator(".stat-card__label", { hasText: "Oturum Sayısı" })).toBeVisible();
    await expect(page.locator(".stat-card__label", { hasText: "Nakit / Kart Oranı" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Ödeme Tipi Dağılımı" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Nakit", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Kredi Kartı", exact: true })).toBeVisible();
  });

  test("Tutar Göster / Yüzde Göster geçişi gösterimi değiştirir", async ({ page }) => {
    await gotoDashboard(page);
    const toggle = page.getByRole("button", { name: /Tutar Göster|Yüzde Göster/ });
    await expect(toggle).toHaveText("Tutar Göster"); // varsayılan: yüzde gösteriliyor, buton tutara geçirir
    await toggle.click();
    await expect(toggle).toHaveText("Yüzde Göster");
  });

  test("PDF Olarak İndir butonu bir dosya indirmesi tetikler", async ({ page }) => {
    await gotoDashboard(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "📄 PDF Olarak İndir" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^oturumlar_.*\.pdf$/);
  });
});
