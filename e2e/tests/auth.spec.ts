import { test, expect } from "@playwright/test";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import { loginViaUI, expectLoggedIn } from "../utils/auth";

test.describe("Kimlik Doğrulama", () => {
  test("doğru kullanıcı adı/şifre ile giriş yapar ve Kasa Ekranı'na yönlendirir", async ({ page }) => {
    await loginViaUI(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Kasa Ekranı" })).toBeVisible();
    await expectLoggedIn(page);
  });

  test("yanlış şifre ile açıklayıcı hata mesajı gösterir ve sayfada kalır", async ({ page }) => {
    await loginViaUI(page, ADMIN_USERNAME, "kesinlikle-yanlis-bir-sifre");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("kullanıcı adı veya şifre hatalı")).toBeVisible();
  });

  test("var olmayan kullanıcı adıyla da aynı genel hata mesajını gösterir (kullanıcı adı sızdırmaz)", async ({ page }) => {
    await loginViaUI(page, "kesinlikle_yok_boyle_biri", "herhangi123");
    await expect(page.getByText("kullanıcı adı veya şifre hatalı")).toBeVisible();
  });

  test("boş alanlarla submit backend'den hata döner, sayfada kalır", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("kullanıcı adı veya şifre hatalı")).toBeVisible();
  });

  test("giriş yapmadan korumalı bir sayfaya gidilirse /login'e yönlendirilir", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("başarılı girişten sonra sayfa yenilenince oturum korunur", async ({ page }) => {
    await loginViaUI(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await expectLoggedIn(page);
    await page.reload();
    await expectLoggedIn(page);
    await expect(page).toHaveURL("/");
  });

  test("Çıkış Yap, oturumu kapatır ve korumalı sayfaya tekrar erişimi engeller", async ({ page }) => {
    await loginViaUI(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await expectLoggedIn(page);
    await page.getByRole("button", { name: "Çıkış Yap" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});
