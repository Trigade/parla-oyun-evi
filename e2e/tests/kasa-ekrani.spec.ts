import { test, expect, type Page } from "@playwright/test";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import * as api from "../utils/api";
import { genValidTC, genValidPhone } from "../utils/tc";
import { loginViaStorage, fieldInput } from "../utils/auth";
import { testMusterileriniSil } from "../utils/db";

// Bu dosyadaki testler, gerçek/paylaşımlı veritabanına karşı çalıştığı
// için her test kendi benzersiz TC/telefon/ad-soyad'ını üretir ve
// oluşturduğu açık oturumları (varsa) test sonunda kapatır — mevcut
// gerçek müşteri/oturum verisine dokunulmaz.

const musterilerToCleanup: number[] = [];
const tcToCleanup: string[] = []; // UI'dan kaydedilen müşteriler: id, TC ile afterEach'te çözülür

// Test başarısız olsa da, yalnızca bu testlerin ürettiği müşteriler (oturum/paketleriyle) silinir.
test.afterEach(async () => {
  const token = await api.adminToken();
  for (const tc of tcToCleanup.splice(0)) {
    const id = await api.findCustomerIdByTC(token, tc);
    if (id) musterilerToCleanup.push(id);
  }
  testMusterileriniSil(musterilerToCleanup.splice(0));
});

async function gotoKasaEkrani(page: Page) {
  const token = await api.adminToken();
  await api.ensureGunAcik(token);
  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kasa Ekranı" })).toBeVisible();
}

test.describe("Kasa Ekranı — TC ile sorgulama", () => {
  test("kayıtlı müşteri TC ile bulunur ve giriş yapılabilir", async ({ page }) => {
    const token = await api.adminToken();
    // Müşteriyi oluştur ama içeride bırakma (önce kapat) — "kayıtlı ama dışarıda" durumu.
    const created = await api.createCheckedInTestCustomer(token, {
      tc: genValidTC(),
      ad: "SorguTC",
      soyad: "Bulunan",
      telefon: genValidPhone(),
    });
    musterilerToCleanup.push(created.customerId);
    await api.closeSession(token, created.sessionId);

    await gotoKasaEkrani(page);
    await page.getByPlaceholder("12345678901").fill(created.tc);
    await page.getByRole("button", { name: "Sorgula" }).click();

    await expect(page.getByText("Kayıt bulundu")).toBeVisible();
    await expect(page.getByText(`${created.ad} ${created.soyad}`)).toBeVisible();

    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await expect(page.getByRole("cell", { name: `${created.ad} ${created.soyad}` })).toBeVisible();
  });

  test("kayıtsız TC ile sorgulanınca 'kayıt gerekli' formu açılır", async ({ page }) => {
    await gotoKasaEkrani(page);
    const yeniTC = genValidTC();
    await page.getByPlaceholder("12345678901").fill(yeniTC);
    await page.getByRole("button", { name: "Sorgula" }).click();

    await expect(page.getByText("ile kayıtlı müşteri bulunamadı")).toBeVisible();
    const tcAlani = page.locator('input[placeholder="12345678901"]');
    await expect(tcAlani).toBeDisabled();
    await expect(tcAlani).toHaveValue(yeniTC);
  });

  test("geçersiz TC formatında Sorgula butonu devre dışı kalır", async ({ page }) => {
    await gotoKasaEkrani(page);
    await page.getByPlaceholder("12345678901").fill("1234567890"); // 10 hane, eksik
    await expect(page.getByRole("button", { name: "Sorgula" })).toBeDisabled();

    await page.getByPlaceholder("12345678901").fill("12345678901"); // 11 hane ama checksum hatalı
    await expect(page.getByText("Geçersiz TC Kimlik No")).toBeVisible();
  });
});

test.describe("Kasa Ekranı — Telefon ile sorgulama", () => {
  test("kayıtlı müşteri telefon ile bulunur (TC otomatik doldurulur)", async ({ page }) => {
    const token = await api.adminToken();
    const created = await api.createCheckedInTestCustomer(token, {
      tc: genValidTC(),
      ad: "SorguTel",
      soyad: "Bulunan",
      telefon: genValidPhone(),
    });
    musterilerToCleanup.push(created.customerId);
    await api.closeSession(token, created.sessionId);

    await gotoKasaEkrani(page);
    await page.getByRole("button", { name: "Telefon ile" }).click();
    await page.getByPlaceholder("05xxxxxxxxx").fill(created.telefon);
    await page.getByRole("button", { name: "Sorgula" }).click();

    await expect(page.getByText("Kayıt bulundu")).toBeVisible();
    await expect(page.getByText(created.tc)).toBeVisible();
  });

  test("kayıtsız telefon ile sorgulanınca kayıt formu telefon kilitli açılır", async ({ page }) => {
    await gotoKasaEkrani(page);
    await page.getByRole("button", { name: "Telefon ile" }).click();
    const yeniTel = genValidPhone();
    await page.getByPlaceholder("05xxxxxxxxx").fill(yeniTel);
    await page.getByRole("button", { name: "Sorgula" }).click();

    await expect(page.getByText("ile kayıtlı müşteri bulunamadı")).toBeVisible();
    const telAlanlari = page.locator('input[placeholder="05xxxxxxxxx"]');
    await expect(telAlanlari.first()).toBeDisabled();
    await expect(telAlanlari.first()).toHaveValue(yeniTel);
  });

  test("geçersiz telefon formatında Sorgula butonu devre dışı kalır", async ({ page }) => {
    await gotoKasaEkrani(page);
    await page.getByRole("button", { name: "Telefon ile" }).click();
    await page.getByPlaceholder("05xxxxxxxxx").fill("123");
    await expect(page.getByRole("button", { name: "Sorgula" })).toBeDisabled();
  });
});

test.describe("Kasa Ekranı — İsim ile Ara", () => {
  test("2+ karakterden itibaren canlı arama sonuçları listelenir", async ({ page }) => {
    const token = await api.adminToken();
    const benzersizAd = `AramaTest${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, {
      tc: genValidTC(),
      ad: benzersizAd,
      soyad: "Kisi",
      telefon: genValidPhone(),
    });
    musterilerToCleanup.push(created.customerId);
    await api.closeSession(token, created.sessionId);

    await gotoKasaEkrani(page);
    await page.getByRole("button", { name: "İsim ile Ara" }).click();
    await page.getByPlaceholder("Örn: Ahmet Yılmaz").fill(benzersizAd);

    await expect(page.getByText(`${benzersizAd} Kisi`)).toBeVisible({ timeout: 5000 });
  });

  test("eşleşme yoksa 'bulunamadı' mesajı gösterilir", async ({ page }) => {
    await gotoKasaEkrani(page);
    await page.getByRole("button", { name: "İsim ile Ara" }).click();
    await page.getByPlaceholder("Örn: Ahmet Yılmaz").fill(`YokBoyleBirMusteri${Date.now()}`);

    await expect(page.getByText("Eşleşen müşteri bulunamadı.")).toBeVisible({ timeout: 5000 });
  });

  test("arama sonucundaki Giriş Yap ile ek sorgulama olmadan direkt giriş yapılır", async ({ page }) => {
    const token = await api.adminToken();
    const benzersizAd = `HizliGiris${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, {
      tc: genValidTC(),
      ad: benzersizAd,
      soyad: "Musteri",
      telefon: genValidPhone(),
    });
    musterilerToCleanup.push(created.customerId);
    await api.closeSession(token, created.sessionId);

    await gotoKasaEkrani(page);
    await page.getByRole("button", { name: "İsim ile Ara" }).click();
    await page.getByPlaceholder("Örn: Ahmet Yılmaz").fill(benzersizAd);

    const satir = page.locator("tbody tr", { hasText: benzersizAd });
    await expect(satir).toBeVisible({ timeout: 5000 });
    await satir.getByRole("button", { name: "Giriş Yap" }).click();

    // Sorgu ekranına döner (form sıfırlanır) ve müşteri içeride listesine düşer.
    await expect(page.getByRole("cell", { name: `${benzersizAd} Musteri` })).toBeVisible();
  });

  test("zaten içeride olan müşteri 'İçeride' rozetiyle işaretlenir ve tekrar giriş yapılamaz", async ({ page }) => {
    const token = await api.adminToken();
    const benzersizAd = `IcerideOlan${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, {
      tc: genValidTC(),
      ad: benzersizAd,
      soyad: "Musteri",
      telefon: genValidPhone(),
    });
    musterilerToCleanup.push(created.customerId);

    await gotoKasaEkrani(page);
    await page.getByRole("button", { name: "İsim ile Ara" }).click();
    await page.getByPlaceholder("Örn: Ahmet Yılmaz").fill(benzersizAd);

    const satir = page.locator("tbody tr", { hasText: benzersizAd });
    await expect(satir).toBeVisible({ timeout: 5000 });
    await expect(satir.getByText("İçeride")).toBeVisible();
    await expect(satir.getByText("Zaten içeride")).toBeVisible();
    await expect(satir.getByRole("button", { name: "Giriş Yap" })).toHaveCount(0);
  });
});

test.describe("Kasa Ekranı — Yeni müşteri kaydı", () => {
  test("ad/soyad/telefon eksikken Kaydet ve Giriş Yap devre dışı kalır", async ({ page }) => {
    await gotoKasaEkrani(page);
    const yeniTC = genValidTC();
    await page.getByPlaceholder("12345678901").fill(yeniTC);
    await page.getByRole("button", { name: "Sorgula" }).click();
    await expect(page.getByText("ile kayıtlı müşteri bulunamadı")).toBeVisible();

    await expect(page.getByRole("button", { name: "Kaydet ve Giriş Yap" })).toBeDisabled();
    await page.getByPlaceholder("Ad", { exact: true }).fill("Yeni");
    await expect(page.getByRole("button", { name: "Kaydet ve Giriş Yap" })).toBeDisabled();
    await page.getByPlaceholder("Soyad").fill("Musteri");
    await expect(page.getByRole("button", { name: "Kaydet ve Giriş Yap" })).toBeDisabled(); // telefon hâlâ boş
  });

  test("tüm alanlar geçerliyken kayıt oluşturulur ve oturum açılır (veli telefonu boş bırakılabilir)", async ({ page }) => {
    await gotoKasaEkrani(page);
    const yeniTC = genValidTC();
    tcToCleanup.push(yeniTC);
    const yeniTel = genValidPhone();
    const soyad = `Kayit${Date.now()}`;

    await page.getByPlaceholder("12345678901").fill(yeniTC);
    await page.getByRole("button", { name: "Sorgula" }).click();
    await expect(page.getByText("ile kayıtlı müşteri bulunamadı")).toBeVisible();

    await page.getByPlaceholder("Ad", { exact: true }).fill("Yeni");
    await page.getByPlaceholder("Soyad").fill(soyad);
    const telAlanlari = page.locator('input[placeholder="05xxxxxxxxx"]');
    await telAlanlari.first().fill(yeniTel);
    // veli telefonu (ikinci telefon alanı) bilerek boş bırakılıyor
    // Telefon alanının onBlur doğrulama isteğinin tamamlanması için odağı
    // ayırıp bekliyoruz — aksi halde bu istekle "Kaydet" tıklaması çakışabilir.
    await telAlanlari.nth(1).click();
    await page.waitForTimeout(500);

    await expect(page.getByRole("button", { name: "Kaydet ve Giriş Yap" })).toBeEnabled();
    await page.getByRole("button", { name: "Kaydet ve Giriş Yap" }).click();

    await expect(page.getByRole("cell", { name: `Yeni ${soyad}` })).toBeVisible();
  });

  test("Vazgeç butonu formu ve sorgu ekranını sıfırlar", async ({ page }) => {
    await gotoKasaEkrani(page);
    const yeniTC = genValidTC();
    await page.getByPlaceholder("12345678901").fill(yeniTC);
    await page.getByRole("button", { name: "Sorgula" }).click();
    await expect(page.getByText("ile kayıtlı müşteri bulunamadı")).toBeVisible();

    await page.getByRole("button", { name: "Vazgeç" }).click();

    await expect(page.getByRole("button", { name: "TC Kimlik No ile" })).toBeVisible();
    await expect(page.getByPlaceholder("12345678901")).toHaveValue("");
  });
});

test.describe("Kasa Ekranı — Gün kapalı durumu", () => {
  test("gün kapalıyken müşteri girişi formu yerine uyarı gösterilir", async ({ page }) => {
    const token = await api.adminToken();
    const durum = await api.getCurrentBusinessDay(token);
    test.skip(
      durum.acik,
      "Gün şu anda açık; gerçek/paylaşımlı ortamda günü kapatmak diğer testleri ve olası gerçek " +
        "kullanımı etkileyeceğinden bu senaryo yalnızca gün zaten kapalıyken çalıştırılır."
    );

    await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await page.goto("/");
    await expect(page.getByText("Güne başlamadan müşteri girişi yapılamaz.")).toBeVisible();
    await expect(page.getByRole("button", { name: "TC Kimlik No ile" })).toHaveCount(0);
  });
});

test.describe("Kasa Ekranı — İçeride Olanlar ve ödeme kapatma", () => {
  test("satıra tıklayınca ödeme paneli açılır ve 'Kapat' sadece paneli gizler, oturumu kapatmaz", async ({ page }) => {
    const token = await api.adminToken();
    const ad = `PanelTest${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, { tc: genValidTC(), ad, soyad: "Musteri", telefon: genValidPhone() });
    musterilerToCleanup.push(created.customerId);

    await gotoKasaEkrani(page);
    await page.getByRole("cell", { name: `${ad} Musteri` }).click();

    await expect(page.getByRole("heading", { name: `${ad} Musteri` })).toBeVisible();
    await expect(page.getByText("Geçen Süre", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nakit Ödendi" })).toBeVisible();

    await page.getByRole("button", { name: "Kapat" }).click();
    await expect(page.getByRole("heading", { name: `${ad} Musteri` })).toHaveCount(0);

    // oturum hâlâ İçeride Olanlar listesinde olmalı (kapatılmadı)
    const acikOturumlar = await api.listOpenSessions(token);
    expect(acikOturumlar.some((s) => s.id === created.sessionId)).toBe(true);
  });

  test("Yuvarla ve İndirim kontrolleri panelde etkileşime açıktır", async ({ page }) => {
    const token = await api.adminToken();
    const ad = `IndirimTest${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, { tc: genValidTC(), ad, soyad: "Musteri", telefon: genValidPhone() });
    musterilerToCleanup.push(created.customerId);

    await gotoKasaEkrani(page);
    await page.getByRole("cell", { name: `${ad} Musteri` }).click();

    const yuvarlaKutusu = page.getByLabel("Yuvarla (en yakın 10 TL'ye)");
    await expect(yuvarlaKutusu).not.toBeChecked();
    await yuvarlaKutusu.check();
    await expect(yuvarlaKutusu).toBeChecked();

    await page.getByRole("button", { name: "İndirim Uygula" }).click();
    await expect(fieldInput(page, "İndirim Değeri")).toBeVisible();
    await expect(page.getByRole("button", { name: "İndirimi Kaldır" })).toBeVisible();
  });

  test("Nakit Ödendi ile oturum kapanır ve İçeride Olanlar listesinden düşer", async ({ page }) => {
    const token = await api.adminToken();
    const ad = `NakitKapat${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, { tc: genValidTC(), ad, soyad: "Musteri", telefon: genValidPhone() });
    musterilerToCleanup.push(created.customerId);

    await gotoKasaEkrani(page);
    await page.getByRole("cell", { name: `${ad} Musteri` }).click();
    await page.getByRole("button", { name: "Nakit Ödendi" }).click();

    await expect(page.getByRole("cell", { name: `${ad} Musteri` })).toHaveCount(0, { timeout: 10000 });

    const acikOturumlar = await api.listOpenSessions(token);
    expect(acikOturumlar.some((s) => s.id === created.sessionId)).toBe(false);
  });

  test("Kredi Kartı Ödendi ile oturum kapanır", async ({ page }) => {
    const token = await api.adminToken();
    const ad = `KartKapat${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, { tc: genValidTC(), ad, soyad: "Musteri", telefon: genValidPhone() });
    musterilerToCleanup.push(created.customerId);

    await gotoKasaEkrani(page);
    await page.getByRole("cell", { name: `${ad} Musteri` }).click();
    await page.getByRole("button", { name: "Kredi Kartı Ödendi" }).click();

    await expect(page.getByRole("cell", { name: `${ad} Musteri` })).toHaveCount(0, { timeout: 10000 });

    const acikOturumlar = await api.listOpenSessions(token);
    expect(acikOturumlar.some((s) => s.id === created.sessionId)).toBe(false);
  });
});
