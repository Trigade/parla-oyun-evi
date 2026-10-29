import { test, expect } from "@playwright/test";
import { join } from "path";
import * as api from "../utils/api";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../utils/api";
import { genUsername } from "../utils/tc";
import { psql, testMusterileriniSil } from "../utils/db";
import { fieldInput, loginViaStorage } from "../utils/auth";

// Paket düzenleme (yönetici): paket türü tanımı ve müşterinin satın aldığı paket, tür geçişi dahil.
// Yalnızca testin kendi oluşturduğu kayıtlara dokunur.

const sonek = Date.now();
const musteriIdleri: number[] = [];
const tanimIdleri: number[] = [];
const EKRAN_DIR = process.env.E2E_EKRAN_GORUNTUSU_DIR;

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  if (musteriIdleri.length) testMusterileriniSil(musteriIdleri);
  for (const id of tanimIdleri) psql(`UPDATE package_definitions SET aktif = false WHERE id = ${id}`);
});

async function tanim(token: string, ek: Partial<Parameters<typeof api.createPackageDefinition>[1]> = {}) {
  const t = await api.createPackageDefinition(token, {
    tur: "abonelik",
    ad: `E2E Duzenle ${sonek}`,
    haftalik_gun: 3,
    gunluk_dakika: 240,
    aylik_ucret_kurus: 100000,
    ...ek,
  });
  tanimIdleri.push(t.id);
  return t.id;
}

async function musteri(token: string, soyad: string) {
  const c = await api.createCheckedInTestCustomer(token, { ad: `E2EPaketD${sonek}`, soyad });
  musteriIdleri.push(c.customerId);
  await api.closeSession(token, c.sessionId);
  return c.customerId;
}

function gelecekTarih(gun: number) {
  const d = new Date(Date.now() + gun * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("API: paket tanımı abonelikten bakiyeye çevrilir; geçersiz haftalık gün 400 döner", async () => {
  const token = await api.adminToken();
  const id = await tanim(token);

  const res = await api.patch(`/package-definitions/${id}`, token, {
    tur: "bakiye", ad: `E2E Duzenle ${sonek}`, dakika: 600, aylik_ucret_kurus: 100000,
  });
  expect(res.status).toBe(200);
  const gelen = await res.json();
  expect(gelen.tur).toBe("bakiye");
  expect(gelen.dakika).toBe(600);
  expect(gelen.haftalik_gun ?? 0).toBe(0);

  const hatali = await api.patch(`/package-definitions/${id}`, token, {
    tur: "abonelik", ad: `E2E Duzenle ${sonek}`, haftalik_gun: 9, gunluk_dakika: 240, aylik_ucret_kurus: 100000,
  });
  expect(hatali.status).toBe(400);
});

test("API: satın alınan paket bakiyeye çevrilir; başka müşterinin id'siyle 404, yönetici olmayan 403", async () => {
  const token = await api.adminToken();
  const id = await tanim(token);
  const musteriId = await musteri(token, "Api");
  const digerId = await musteri(token, "Diger");
  await api.purchasePackage(token, musteriId, id, "nakit");
  const [paket] = await api.listCustomerPackages(token, musteriId);

  const bitis = gelecekTarih(10);
  const govde = { tur: "bakiye", ad: `E2E Duzenli ${sonek}`, toplam_dakika: 600, kalan_dakika: 540, gecerlilik_bitis: bitis };
  const res = await api.patch(`/customers/${musteriId}/packages/${paket.id}`, token, govde);
  expect(res.status).toBe(200);
  const [guncel] = await api.listCustomerPackages(token, musteriId);
  expect(guncel.tur).toBe("bakiye");
  expect(guncel.kalan_dakika).toBe(540);
  expect(guncel.gecerlilik_bitis).toMatch(new RegExp(`^${bitis}`));

  expect((await api.patch(`/customers/${digerId}/packages/${paket.id}`, token, govde)).status).toBe(404);

  const username = genUsername("paketduz");
  const password = "GecerliSifre123";
  const kullanici = await api.createUser(token, { username, password, is_admin: false, permissions: [] });
  try {
    const kt = (await api.login(username, password)).token;
    expect((await api.patch(`/customers/${musteriId}/packages/${paket.id}`, kt, govde)).status).toBe(403);
  } finally {
    await api.deleteUser(token, kullanici.id);
  }
});

test("UI: Satın Alma'da paket tanımı Düzenle ile yeniden adlandırılır", async ({ page }) => {
  const token = await api.adminToken();
  const id = await tanim(token, { ad: `E2E Eski ${sonek}` });
  const yeniAd = `E2E Yeni ${sonek}`;

  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/satin-alma");
  await page.getByRole("row", { name: new RegExp(`E2E Eski ${sonek}`) }).getByRole("button", { name: "Düzenle" }).click();
  await expect(page.getByRole("heading", { name: "Paketi Düzenle" })).toBeVisible();
  await fieldInput(page, "Paket Adı").fill(yeniAd);
  if (EKRAN_DIR) await page.screenshot({ path: join(EKRAN_DIR, "satinalma-duzenle.png"), fullPage: true });
  await page.getByRole("button", { name: "Kaydet" }).click();

  await expect(page.getByRole("cell", { name: yeniAd, exact: true })).toBeVisible();
  const liste = await api.listPackageDefinitionsRaw(token);
  expect(liste.find((t) => t.id === id)?.ad).toBe(yeniAd);
});

test("UI: Müşteriler'de satın alınan paketin kalan süresi 5 saate düzeltilir", async ({ page }) => {
  const token = await api.adminToken();
  const id = await tanim(token, { tur: "bakiye", dakika: 600, ad: `E2E Bakiye ${sonek}` });
  const musteriId = await musteri(token, "Ui");
  await api.purchasePackage(token, musteriId, id, "nakit");

  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/musteriler");
  await page.getByPlaceholder(/Örn: Ahmet/).fill(`E2EPaketD${sonek}`);
  await page.getByRole("row", { name: new RegExp(`E2EPaketD${sonek} Ui`) }).click();
  await page.getByRole("button", { name: "Paketi Düzenle" }).click();
  await fieldInput(page, "Kalan Süre (saat)").fill("5");
  if (EKRAN_DIR) await page.screenshot({ path: join(EKRAN_DIR, "musteri-paket-duzenle.png"), fullPage: true });
  await page.getByRole("button", { name: "Kaydet" }).click();

  await expect(page.getByText(/Kalan: 5 saat/)).toBeVisible();
  const [paket] = await api.listCustomerPackages(token, musteriId);
  expect(paket.kalan_dakika).toBe(300);
});
