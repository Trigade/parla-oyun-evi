import { test, expect, type Page } from "@playwright/test";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import * as api from "../utils/api";
import { genValidTC, genValidPhone } from "../utils/tc";
import { loginViaStorage } from "../utils/auth";

const sessionsToCleanup: number[] = [];
test.afterEach(async () => {
  const token = await api.adminToken();
  for (const id of sessionsToCleanup.splice(0)) {
    try {
      await api.closeSession(token, id);
    } catch {
      // zaten kapalı olabilir
    }
  }
});

async function gotoGunSonu(page: Page) {
  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/gun-sonu");
  await expect(page.getByRole("heading", { name: "Gün Sonu" })).toBeVisible();
}

test.describe("Gün Sonu — Gün Başı", () => {
  test("gün kapalıyken sadece 'Gün Başı Yap' kartı görünür; tıklanınca gün açılır", async ({ page }) => {
    const token = await api.adminToken();
    const durum = await api.getCurrentBusinessDay(token);
    test.skip(
      durum.acik,
      "Gün şu anda açık; paylaşımlı ortamda bu senaryo yalnızca gün zaten kapalıyken güvenle test edilebilir."
    );

    await gotoGunSonu(page);
    await expect(page.getByRole("heading", { name: "Gün Henüz Başlamadı" })).toBeVisible();
    await page.getByRole("button", { name: "Gün Başı Yap" }).click();

    await expect(page.getByRole("heading", { name: "Gün Açık" })).toBeVisible();
  });
});

test.describe("Gün Sonu — Açık oturum yönetimi", () => {
  test("açık oturum varken 'Gün Sonu Yap' devre dışı kalır ve uyarı gösterilir", async ({ page }) => {
    const token = await api.adminToken();
    const created = await api.createCheckedInTestCustomer(token, {
      tc: genValidTC(),
      ad: `GunSonuUyari${Date.now()}`,
      soyad: "Musteri",
      telefon: genValidPhone(),
    });
    sessionsToCleanup.push(created.sessionId);

    await gotoGunSonu(page);
    await expect(page.getByText(/açık oturum var — gün sonu yapmadan önce hepsini kapatın/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Gün Sonu Yap" })).toBeDisabled();
  });

  test("açık oturumu Nakit Ödendi ile kapatınca listeden düşer", async ({ page }) => {
    const token = await api.adminToken();
    const ad = `GunSonuNakit${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, { tc: genValidTC(), ad, soyad: "Musteri", telefon: genValidPhone() });

    await gotoGunSonu(page);
    const satir = page.locator("tbody tr", { hasText: `${ad} Musteri` });
    await expect(satir).toBeVisible();
    await satir.getByRole("button", { name: "Nakit Ödendi" }).click();

    await expect(page.locator("tbody tr", { hasText: `${ad} Musteri` })).toHaveCount(0, { timeout: 10000 });

    const acikOturumlar = await api.listOpenSessions(token);
    expect(acikOturumlar.some((s) => s.id === created.sessionId)).toBe(false);
  });

  test("'Elle Kapat' formu açılır ve geçerli bir çıkış zamanıyla oturumu elle kapatır", async ({ page }) => {
    const token = await api.adminToken();
    const ad = `ElleKapat${Date.now()}`;
    const created = await api.createCheckedInTestCustomer(token, { tc: genValidTC(), ad, soyad: "Musteri", telefon: genValidPhone() });

    await gotoGunSonu(page);
    const satir = page.locator("tbody tr", { hasText: `${ad} Musteri` });
    await expect(satir).toBeVisible();
    await satir.getByRole("button", { name: "Elle Kapat" }).click();

    // Giriş anıyla aynı dakikaya denk gelip "çıkış girişten önce olamaz" hatasını
    // tetiklememek için bilerek birkaç dakika ileri bir çıkış zamanı giriliyor.
    const ileriZaman = new Date(Date.now() + 5 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const deger = `${ileriZaman.getFullYear()}-${pad(ileriZaman.getMonth() + 1)}-${pad(ileriZaman.getDate())}T${pad(
      ileriZaman.getHours()
    )}:${pad(ileriZaman.getMinutes())}`;

    await page.locator('input[type="datetime-local"]').fill(deger);
    await page.getByRole("button", { name: "Onayla" }).click();

    await expect(page.getByText(`Oturum #${created.sessionId} elle kapatıldı.`)).toBeVisible({ timeout: 10000 });

    const acikOturumlar = await api.listOpenSessions(token);
    expect(acikOturumlar.some((s) => s.id === created.sessionId)).toBe(false);
  });
});

test.describe("Gün Sonu — Tam gün sonu akışı", () => {
  test("tüm açık oturumlar kapanınca 'Gün Sonu Yap' aktifleşir ve PDF indirir", async ({ page }) => {
    // Bu test GERÇEK iş gününü sonlandırır (EndBusinessDay) — paylaşımlı/canlı bir
    // ortamda bu geri alınamaz bir işlemdir ve işletmenin o günkü akışını keser.
    // Bu yüzden varsayılan olarak ATLANIR; bilinçli olarak çalıştırmak isteyen kişi
    // RUN_DESTRUCTIVE_TESTS=1 ortam değişkenini ayarlamalıdır (bkz. .env.example).
    test.skip(
      !process.env.RUN_DESTRUCTIVE_TESTS,
      "Gerçek iş gününü sonlandıran yıkıcı bir test; sadece RUN_DESTRUCTIVE_TESTS=1 ile çalışır."
    );

    const token = await api.adminToken();
    const mevcutAcikOturumlar = await api.listOpenSessions(token);
    test.skip(
      mevcutAcikOturumlar.length > 0,
      "Şu anda başka (gerçek/önceki testlere ait olabilecek) açık oturumlar var; bu test tüm açık " +
        "oturumların kapalı olmasını gerektirdiğinden ve onları kapatmak paylaşımlı veriye zarar " +
        "verebileceğinden, yalnızca hiç açık oturum yokken güvenle çalıştırılır."
    );

    const created = await api.createCheckedInTestCustomer(token, {
      tc: genValidTC(),
      ad: `TamGunSonu${Date.now()}`,
      soyad: "Musteri",
      telefon: genValidPhone(),
    });
    await api.closeSession(token, created.sessionId);

    await gotoGunSonu(page);
    await expect(page.getByText("Açık oturum yok — gün sonu yapabilirsiniz.")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Gün Sonu Yap" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^gun_sonu_.*\.pdf$/);
    await expect(page.getByText("Gün sonu yapıldı. Rapor (.pdf) indirildi.")).toBeVisible();
  });
});
