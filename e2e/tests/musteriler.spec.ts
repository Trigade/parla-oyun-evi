import { test, expect, type Page } from "@playwright/test";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import * as api from "../utils/api";
import { genValidTC, genValidPhone } from "../utils/tc";
import { loginViaStorage, fieldInput } from "../utils/auth";
import { testMusterileriniSil, psql } from "../utils/db";

const musterilerToCleanup: number[] = [];

// Test başarısız olsa da, yalnızca bu testlerin ürettiği müşteriler silinir.
test.afterEach(() => {
  testMusterileriniSil(musterilerToCleanup.splice(0));
});

async function gotoMusteriler(page: Page) {
  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/musteriler");
  await expect(page.getByRole("heading", { name: "Müşteriler" })).toBeVisible();
}

test.describe("Müşteriler — Liste ve Arama", () => {
  test("sayfa açılışında liste ve tüm kolonlar görünür", async ({ page }) => {
    await gotoMusteriler(page);
    await expect(page.getByRole("columnheader", { name: "Ad Soyad" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "TC Kimlik No" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Telefon", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Veli Telefonu" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Ziyaret", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Toplam Harcama" })).toBeVisible();
  });

  test("arama kutusu ada göre filtreler", async ({ page }) => {
    const token = await api.adminToken();
    const ad = `AramaFiltre${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, { tc: genValidTC(), ad, soyad: "Kisi", telefon: genValidPhone() });
    musterilerToCleanup.push(created.customerId);
    await api.closeSession(token, created.sessionId);

    await gotoMusteriler(page);
    await page.getByPlaceholder("Örn: Ahmet ya da 12345678901").fill(ad);
    await expect(page.getByRole("cell", { name: `${ad} Kisi` })).toBeVisible({ timeout: 5000 });
  });

  test("eşleşme yoksa 'Kayıt bulunamadı' mesajı gösterilir", async ({ page }) => {
    await gotoMusteriler(page);
    await page.getByPlaceholder("Örn: Ahmet ya da 12345678901").fill(`YokBoyleBiri${Date.now()}xyz`);
    await expect(page.getByText("Kayıt bulunamadı.")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Müşteriler — Geçmiş popup'ı", () => {
  test("satıra tıklayınca popup açılır; Esc, overlay ve Kapat ile kapanır", async ({ page }) => {
    const token = await api.adminToken();
    const ad = `PopupTest${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, { tc: genValidTC(), ad, soyad: "Musteri", telefon: genValidPhone() });
    musterilerToCleanup.push(created.customerId);
    await api.closeSession(token, created.sessionId);

    await gotoMusteriler(page);
    await page.getByPlaceholder("Örn: Ahmet ya da 12345678901").fill(ad);
    await page.getByRole("cell", { name: `${ad} Musteri` }).click();

    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("heading", { name: `${ad} Musteri` })).toBeVisible();

    // Esc ile kapanır
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);

    // tekrar aç, overlay'e tıklayarak kapat
    await page.getByRole("cell", { name: `${ad} Musteri` }).click();
    await expect(page.locator(".modal")).toBeVisible();
    await page.locator(".modal-overlay").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".modal")).toHaveCount(0);

    // tekrar aç, Kapat butonuyla kapat
    await page.getByRole("cell", { name: `${ad} Musteri` }).click();
    const modal2 = page.locator(".modal");
    await expect(modal2).toBeVisible();
    await modal2.getByRole("button", { name: "Kapat" }).click();
    await expect(page.locator(".modal")).toHaveCount(0);
  });
});

test.describe("Müşteriler — Düzenleme", () => {
  test("Düzenle formu mevcut veriyle dolu gelir, geçersiz TC ile Kaydet devre dışı kalır", async ({ page }) => {
    const token = await api.adminToken();
    const ad = `DuzenleTest${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, { tc: genValidTC(), ad, soyad: "Musteri", telefon: genValidPhone() });
    musterilerToCleanup.push(created.customerId);
    await api.closeSession(token, created.sessionId);

    await gotoMusteriler(page);
    await page.getByPlaceholder("Örn: Ahmet ya da 12345678901").fill(ad);
    await page.getByRole("cell", { name: `${ad} Musteri` }).click();
    await page.getByRole("button", { name: "✏️ Düzenle" }).click();

    const modal = page.locator(".modal");
    await expect(fieldInput(modal, "Ad")).toHaveValue(ad);
    await expect(fieldInput(modal, "Soyad")).toHaveValue("Musteri");
    await expect(fieldInput(modal, "TC Kimlik No (isteğe bağlı)")).toHaveValue(created.tc);

    await fieldInput(modal, "TC Kimlik No (isteğe bağlı)").fill("12345678901"); // checksum hatalı
    await expect(modal.getByRole("button", { name: "Kaydet" })).toBeDisabled();
  });

  test("geçerli değişiklikle Kaydet, liste ve popup başlığını anında günceller", async ({ page }) => {
    const token = await api.adminToken();
    const ad = `KayitGuncelle${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, { tc: genValidTC(), ad, soyad: "Eski", telefon: genValidPhone() });
    musterilerToCleanup.push(created.customerId);
    await api.closeSession(token, created.sessionId);

    await gotoMusteriler(page);
    await page.getByPlaceholder("Örn: Ahmet ya da 12345678901").fill(ad);
    await page.getByRole("cell", { name: `${ad} Eski` }).click();
    await page.getByRole("button", { name: "✏️ Düzenle" }).click();

    const modal = page.locator(".modal");
    await fieldInput(modal, "Soyad").fill("Yeni");
    await modal.getByRole("button", { name: "Kaydet" }).click();

    await expect(modal.getByRole("heading", { name: `${ad} Yeni` })).toBeVisible();
    await modal.getByRole("button", { name: "Kapat" }).click();
    await expect(page.getByRole("cell", { name: `${ad} Yeni` })).toBeVisible();
  });

  test("İptal, formu kapatır ve değişikliği kaydetmez", async ({ page }) => {
    const token = await api.adminToken();
    const ad = `IptalTest${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, { tc: genValidTC(), ad, soyad: "Musteri", telefon: genValidPhone() });
    musterilerToCleanup.push(created.customerId);
    await api.closeSession(token, created.sessionId);

    await gotoMusteriler(page);
    await page.getByPlaceholder("Örn: Ahmet ya da 12345678901").fill(ad);
    await page.getByRole("cell", { name: `${ad} Musteri` }).click();
    await page.getByRole("button", { name: "✏️ Düzenle" }).click();

    const modal = page.locator(".modal");
    await fieldInput(modal, "Soyad").fill("BuKaydedilmemeli");
    await modal.getByRole("button", { name: "İptal" }).click();

    await expect(modal.getByRole("heading", { name: `${ad} Musteri` })).toBeVisible();
    await expect(fieldInput(modal, "Soyad")).toHaveCount(0);
  });
});

test.describe("Müşteriler — TC isteğe bağlı", () => {
  test("arayüzden ad+soyad+telefon ile TC'siz müşteri kaydedilir", async ({ page }) => {
    const ad = `TcsizUI${Date.now()}`;
    const telefon = genValidPhone();
    await gotoMusteriler(page);
    await page.getByRole("button", { name: "Yeni Müşteri Ekle" }).click();
    await page.locator("#yeni-ad").fill(ad);
    await page.locator("#yeni-soyad").fill("Tcsiz");
    await page.locator("#yeni-telefon").fill(telefon);
    try {
      await expect(page.getByRole("button", { name: "Kaydet", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(page.locator(".alert--success")).toBeVisible();
    } finally {
      const id = Number(psql(`SELECT id FROM customers WHERE telefon = '${telefon}'`));
      if (id > 0) musterilerToCleanup.push(id);
    }
    await page.getByPlaceholder("Örn: Ahmet ya da 12345678901").fill(ad);
    const satir = page.getByRole("row", { name: new RegExp(`${ad} Tcsiz`) });
    await expect(satir).toContainText("—");
  });

  test("API: TC'siz kayıt 201 döner, bozuk dolu TC 400 döner", async () => {
    const token = await api.adminToken();
    const telefon = genValidPhone();
    const ok = await api.createCustomerRaw(token, { ad: "TcsizAPI", soyad: "Musteri", telefon });
    expect(ok.status).toBe(201);
    musterilerToCleanup.push((ok.body as { id: number }).id);
    expect((ok.body as { tc_kimlik_no: string }).tc_kimlik_no).toBe("");

    const bozuk = await api.createCustomerRaw(token, { tc_kimlik_no: "12345678901", ad: "Bozuk", soyad: "Tc", telefon: genValidPhone() });
    expect(bozuk.status).toBe(400);

    const ayniTelefon = await api.createCustomerRaw(token, { ad: "Ikinci", soyad: "Kisi", telefon });
    expect(ayniTelefon.status).toBe(409);
  });

  test("API: TC'siz müşteri kasaya ikinci kez aynı telefonla girince aynı kayıt kullanılır", async () => {
    const token = await api.adminToken();
    await api.ensureGunAcik(token);
    const telefon = genValidPhone();
    const ilk = await api.startSession(token, { tc_kimlik_no: "", ad: "TcsizKasa", soyad: "Musteri", telefon });
    musterilerToCleanup.push(ilk.musteri.id);
    await api.closeSession(token, ilk.oturum.id);
    const ikinci = await api.startSession(token, { tc_kimlik_no: "", ad: "TcsizKasa", soyad: "Musteri", telefon });
    expect(ikinci.musteri.id).toBe(ilk.musteri.id);
    await api.closeSession(token, ikinci.oturum.id);
  });
});
