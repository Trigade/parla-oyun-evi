import { test, expect } from "@playwright/test";
import * as api from "../utils/api";
import { API_BASE } from "../utils/api";
import { genValidTC, genValidPhone, genUsername } from "../utils/tc";
import { oturumGirisiniGeriCek, psql, testMusterileriniSil } from "../utils/db";

// İşlem kaydı (islem_log): yalnızca DB'den okunur, API'de okuma ucu yoktur. Yazım yanıttan sonra
// arka planda yapıldığı için satırlar kısa bir bekleme ile sorgulanır.

async function bekle(sql: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const sonuc = psql(sql);
    if (sonuc) return sonuc;
    await new Promise((r) => setTimeout(r, 250));
  }
  return "";
}

async function ham(path: string, method: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, { method, headers, body: JSON.stringify(body) });
}

test("başarılı işlem ve izinsiz kullanıcının reddedilen işlemi islem_log'a düşer", async () => {
  const adminTok = await api.adminToken();
  const username = genUsername("logkasa");
  const password = "GecerliSifre123";
  const kullanici = await api.createUser(adminTok, { username, password, is_admin: false, permissions: [] });
  try {
    const { token } = await api.login(username, password);
    const res = await ham("/users", "POST", { username: "x", password: "y" }, token);
    expect(res.status).toBe(403);
    const satir = await bekle(
      `SELECT sonuc || '|' || durum_kodu || '|' || mesaj FROM islem_log WHERE user_id = ${kullanici.id} AND yol = '/api/users' AND yontem = 'POST' ORDER BY id DESC LIMIT 1`
    );
    expect(satir).toBe("reddedildi|403|bu işlem için yönetici yetkisi gerekir");
  } finally {
    await api.deleteUser(adminTok, kullanici.id);
  }
});

test("bakiye paketten düşmede islem_log detayında kalan dakika önce/sonra doğru yazılır", async () => {
  const token = await api.adminToken();
  await api.ensureGunAcik(token);
  const tanim = await api.createPackageDefinition(token, { tur: "bakiye", ad: `E2E Log ${Date.now()}`, dakika: 600, aylik_ucret_kurus: 150000 });
  const tc = genValidTC();
  const c = await api.createCheckedInTestCustomer(token, { tc, ad: "E2ELog", soyad: "Musteri", telefon: genValidPhone() });
  const musteriId = c.customerId;
  try {
    await api.closeSession(token, c.sessionId);
    await api.purchasePackage(token, musteriId, tanim.id, "nakit");
    const s = await api.startSession(token, { tc_kimlik_no: tc, ad: "E2ELog", soyad: "Musteri", telefon: genValidPhone() });
    oturumGirisiniGeriCek(s.oturum.id, 60);
    const res = await ham(`/sessions/${s.oturum.id}/close`, "POST", { odeme_tipi: "paket", paket_modu: "ucretsiz", yuvarla: false, indirim_kurus: 0 }, token);
    expect(res.status).toBe(200);

    const satir = await bekle(
      `SELECT sonuc || '|' || (detay->>'kalan_dakika_once') || '|' || (detay->>'kalan_dakika_sonra') || '|' || (detay->>'paketten_dusulen_dakika') || '|' || (detay->>'customer_id')
       FROM islem_log WHERE yol = '/api/sessions/{id}/close' AND detay->>'session_id' = '${s.oturum.id}' ORDER BY id DESC LIMIT 1`
    );
    expect(satir).toBe(`yapildi|600|540|60|${musteriId}`);
  } finally {
    testMusterileriniSil([musteriId]);
    psql(`UPDATE package_definitions SET aktif = false WHERE id = ${tanim.id}`);
  }
});

test("hatalı girişte şifre islem_log'un hiçbir kolonunda geçmez; kullanıcı adı yazılır", async () => {
  const kullaniciAdi = genUsername("logsifre");
  const sifre = `GizliSifre_${Date.now()}`;
  const res = await ham("/auth/login", "POST", { username: kullaniciAdi, password: sifre });
  expect(res.status).toBe(401);

  const kayit = await bekle(`SELECT sonuc FROM islem_log WHERE kullanici_adi = '${kullaniciAdi}' AND yol = '/api/auth/login' LIMIT 1`);
  expect(kayit).toBe("reddedildi");
  expect(psql(`SELECT count(*) FROM islem_log l WHERE l::text LIKE '%${sifre}%'`)).toBe("0");
});
