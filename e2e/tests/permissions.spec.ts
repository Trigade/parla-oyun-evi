import { test, expect } from "@playwright/test";
import * as api from "../utils/api";
import { genUsername } from "../utils/tc";
import { loginViaStorage } from "../utils/auth";

test.describe("Yetkilendirme / Navigasyon", () => {
  test("sadece 'musteriler' iznine sahip kullanıcı: navbar sadece izinli linkleri gösterir, izinsiz sayfalara erişemez", async ({ page }) => {
    const adminTok = await api.adminToken();
    const username = genUsername("izinli");
    const password = "GecerliSifre123";
    const kullanici = await api.createUser(adminTok, {
      username,
      password,
      is_admin: false,
      permissions: ["musteriler"],
    });

    try {
      await loginViaStorage(page, username, password);
      await page.goto("/");

      const nav = page.locator("nav.topnav");
      await expect(nav.getByRole("link", { name: "Kasa Ekranı" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Müşteriler" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Yönetici Dashboard" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Gün Sonu" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Kullanıcı Yönetimi" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Fiyat Politikası" })).toHaveCount(0);

      // izinli sayfa sorunsuz açılır
      await page.goto("/musteriler");
      await expect(page.getByRole("heading", { name: "Müşteriler" })).toBeVisible();

      // izinsiz sayfalar erişimi reddeder (yönlendirmez, uyarı gösterir)
      for (const url of ["/dashboard", "/gun-sonu", "/kullanicilar", "/fiyat-politikasi"]) {
        await page.goto(url);
        await expect(page.getByText("Bu sayfaya erişim yetkiniz yok.")).toBeVisible();
      }
    } finally {
      await api.deleteUser(adminTok, kullanici.id);
    }
  });

  test("hiçbir izni olmayan (sadece kasa ekranı) kullanıcı Müşteriler'e de erişemez", async ({ page }) => {
    const adminTok = await api.adminToken();
    const username = genUsername("sadecekasa");
    const password = "GecerliSifre123";
    const kullanici = await api.createUser(adminTok, { username, password, is_admin: false, permissions: [] });

    try {
      await loginViaStorage(page, username, password);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Kasa Ekranı" })).toBeVisible();

      await page.goto("/musteriler");
      await expect(page.getByText("Bu sayfaya erişim yetkiniz yok.")).toBeVisible();
    } finally {
      await api.deleteUser(adminTok, kullanici.id);
    }
  });
});
