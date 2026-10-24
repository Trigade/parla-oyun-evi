import { test, expect } from "@playwright/test";
import * as api from "../utils/api";
import { ADMIN_USERNAME, ADMIN_PASSWORD, API_BASE } from "../utils/api";
import { genUsername } from "../utils/tc";
import { oturumGirisiniGeriCek, psql, testMusterileriniSil } from "../utils/db";
import { fieldInput, loginViaStorage } from "../utils/auth";

// Özel tutar (tek seferlik elle tutar) yalnızca yöneticiler içindir: kasada ve paket
// satın almada. Yönetici olmayan kullanıcıya alan görünmez, API de 403 döner.

const ad = `E2EOzel${Date.now()}`;
const musteriIdleri: number[] = [];
let paketTanimId = 0;

test.afterAll(async () => {
  if (musteriIdleri.length) testMusterileriniSil(musteriIdleri);
  if (paketTanimId) psql(`UPDATE package_definitions SET aktif = false WHERE id = ${paketTanimId}`);
});

async function geciciKullanici(adminTok: string) {
  const username = genUsername("ozelkasa");
  const password = "GecerliSifre123";
  const kullanici = await api.createUser(adminTok, { username, password, is_admin: false, permissions: [] });
  return { username, password, id: kullanici.id };
}

function post(path: string, token: string, body: unknown) {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test("yönetici kasada özel tutar (123,45 TL) ile Nakit kapatır; tahsilat bu tutar, normal ücret saklanır", async ({ page }) => {
  const token = await api.adminToken();
  const c = await api.createCheckedInTestCustomer(token, { ad, soyad: "Yonetici" });
  musteriIdleri.push(c.customerId);
  oturumGirisiniGeriCek(c.sessionId, 60);

  await loginViaStorage(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto("/");
  await page.getByRole("cell", { name: `${ad} Yonetici` }).click();
  await fieldInput(page, "Özel Tutar (TL)").fill("123,45");
  await expect(page.getByText(/Özel tutar uygulanıyor/)).toBeVisible();
  await page.getByRole("button", { name: "Nakit Ödendi" }).click();
  await expect(page.getByRole("cell", { name: `${ad} Yonetici` })).toHaveCount(0, { timeout: 10000 });

  const res = await fetch(`${API_BASE}/customers/${c.customerId}/sessions`, { headers: { Authorization: `Bearer ${token}` } });
  const oturum = ((await res.json()) as { id: number; tahsil_tutar_kurus: number; orijinal_tutar_kurus: number }[]).find(
    (s) => s.id === c.sessionId
  )!;
  expect(oturum.tahsil_tutar_kurus).toBe(12345);
  expect(oturum.orijinal_tutar_kurus).toBeGreaterThan(0);
});

test("yönetici olmayan kullanıcı kasada özel tutar alanını görmez", async ({ page }) => {
  const token = await api.adminToken();
  const kasiyer = await geciciKullanici(token);
  const c = await api.createCheckedInTestCustomer(token, { ad, soyad: "Kasiyer" });
  musteriIdleri.push(c.customerId);
  try {
    await loginViaStorage(page, kasiyer.username, kasiyer.password);
    await page.goto("/");
    await page.getByRole("cell", { name: `${ad} Kasiyer` }).click();
    await expect(page.getByRole("button", { name: "Nakit Ödendi" })).toBeVisible();
    await expect(page.getByText("Özel Tutar (TL)")).toHaveCount(0);
  } finally {
    await api.deleteUser(token, kasiyer.id);
  }
});

test("API: yönetici olmayan kullanıcının ozel_tutar_kurus içeren kapatma isteği 403 döner", async () => {
  const token = await api.adminToken();
  const kasiyer = await geciciKullanici(token);
  const c = await api.createCheckedInTestCustomer(token, { ad, soyad: "Api" });
  musteriIdleri.push(c.customerId);
  try {
    const kt = (await api.login(kasiyer.username, kasiyer.password)).token;
    const res = await post(`/sessions/${c.sessionId}/close`, kt, { odeme_tipi: "nakit", yuvarla: false, indirim_kurus: 0, ozel_tutar_kurus: 100 });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Özel tutar");
  } finally {
    await api.deleteUser(token, kasiyer.id);
  }
});

test("paket satın almada yönetici özel tutar girerse paketin tutarı girilen tutar olur", async () => {
  const token = await api.adminToken();
  const tanim = await api.createPackageDefinition(token, {
    tur: "bakiye",
    ad: `E2E Ozel ${Date.now()}`,
    dakika: 600,
    aylik_ucret_kurus: 150000,
  });
  paketTanimId = tanim.id;
  const c = await api.createCheckedInTestCustomer(token, { ad, soyad: "Paket" });
  musteriIdleri.push(c.customerId);
  await api.closeSession(token, c.sessionId);

  const res = await post(`/customers/${c.customerId}/packages`, token, {
    package_definition_id: paketTanimId,
    odeme_tipi: "nakit",
    ozel_tutar_kurus: 99900,
  });
  expect(res.status).toBe(201);
  const [paket] = await api.listCustomerPackages(token, c.customerId);
  expect(paket.tutar_kurus).toBe(99900);
});
