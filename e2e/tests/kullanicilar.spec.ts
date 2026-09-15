import { test, expect, type Page } from "@playwright/test";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import * as api from "../utils/api";
import { genUsername } from "../utils/tc";
import { loginViaStorage, fieldInput } from "../utils/auth";

async function gotoKullanicilar(page: Page) {
  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/kullanicilar");
  await expect(page.getByRole("heading", { name: "Kullanıcı Yönetimi" })).toBeVisible();
}

test.describe("Kullanıcı Yönetimi — Oluşturma", () => {
  test("kısa şifreyle (6 karakterden az) 'Hesap Oluştur' butonu devre dışı kalır", async ({ page }) => {
    await gotoKullanicilar(page);
    await fieldInput(page, "Kullanıcı Adı").fill(genUsername());
    await fieldInput(page, "Şifre (en az 6 karakter)").fill("12345");
    await expect(page.getByRole("button", { name: "Hesap Oluştur" })).toBeDisabled();
  });

  test("geçerli bilgilerle yeni bir kasiyer hesabı oluşturulur ve listede görünür", async ({ page }) => {
    const username = genUsername("olustur");
    await gotoKullanicilar(page);

    await fieldInput(page, "Kullanıcı Adı").fill(username);
    await fieldInput(page, "Şifre (en az 6 karakter)").fill("GecerliSifre123");
    await page.getByLabel("Müşteriler").check();
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();

    await expect(page.getByText(`"${username}" hesabı oluşturuldu.`)).toBeVisible();
    await expect(page.getByRole("cell", { name: username })).toBeVisible();

    // temizlik
    const token = await api.adminToken();
    await api.deleteUserByUsername(token, username);
  });
});

test.describe("Kullanıcı Yönetimi — Düzenleme", () => {
  test("bir kullanıcının izinleri düzenlenebilir", async ({ page }) => {
    const token = await api.adminToken();
    const username = genUsername("duzenle");
    const created = await api.createUser(token, {
      username,
      password: "GecerliSifre123",
      is_admin: false,
      permissions: ["musteriler"],
    });

    await gotoKullanicilar(page);
    const satir = page.locator("tbody tr", { hasText: username }).first();
    await satir.getByRole("button", { name: "Düzenle" }).click();
    // "Yeni Hesap Oluştur" kartında da aynı etiketli checkbox'lar olduğundan,
    // sadece bu satırın hemen altında açılan düzenleme satırına scope ediyoruz.
    const duzenlemeSatiri = satir.locator('xpath=following-sibling::tr[1]');
    await duzenlemeSatiri.getByLabel("Gün Sonu").check();
    await duzenlemeSatiri.getByRole("button", { name: "Kaydet" }).click();

    await expect(page.getByText(`"${username}" hesabı güncellendi.`)).toBeVisible();
    const guncelSatir = page.locator("tbody tr", { hasText: username }).first();
    await expect(guncelSatir.getByText("Gün Sonu")).toBeVisible();
    await expect(guncelSatir.getByText("Müşteriler")).toBeVisible();

    await api.deleteUser(token, created.id);
  });
});

test.describe("Kullanıcı Yönetimi — Kendi hesabına yapılamayanlar", () => {
  test("bir yönetici kendi yönetici yetkisini kaldıramaz", async ({ page }) => {
    const adminTok = await api.adminToken();
    const username = genUsername("kendiadmin");
    const password = "GecerliSifre123";
    const tempAdmin = await api.createUser(adminTok, { username, password, is_admin: true, permissions: [] });

    try {
      await loginViaStorage(page, username, password);
      await page.goto("/kullanicilar");
      const satir = page.locator("tbody tr", { hasText: username }).first();
      await satir.getByRole("button", { name: "Düzenle" }).click();
      const duzenlemeSatiri = satir.locator('xpath=following-sibling::tr[1]');
      await duzenlemeSatiri.getByLabel(/Yönetici \(tüm ekranlar/).uncheck();
      await duzenlemeSatiri.getByRole("button", { name: "Kaydet" }).click();

      await expect(page.getByText("kendi yönetici yetkinizi kaldıramazsınız")).toBeVisible();
    } finally {
      await api.deleteUser(adminTok, tempAdmin.id);
    }
  });

  test("bir kullanıcı kendi hesabını silemez", async ({ page }) => {
    const adminTok = await api.adminToken();
    const username = genUsername("kendisil");
    const password = "GecerliSifre123";
    const tempAdmin = await api.createUser(adminTok, { username, password, is_admin: true, permissions: [] });

    try {
      await loginViaStorage(page, username, password);
      await page.goto("/kullanicilar");
      const satir = page.locator("tbody tr", { hasText: username }).first();
      await satir.getByRole("button", { name: "Sil" }).click();

      await expect(page.getByText("kendi hesabınızı silemezsiniz")).toBeVisible();
    } finally {
      await api.deleteUser(adminTok, tempAdmin.id);
    }
  });
});
