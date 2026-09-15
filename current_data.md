# Parla Oyun Evi — Güncel Durum

> Bu dosya projenin şu anki durumunu özetler. Her yeni iş bittiğinde bu dosya güncellenir.
> Yeni bir konuşmaya başlarken önce bu dosyayı oku, buradan devam et.

Son güncelleme: 2026-07-28 (TC Kimlik No doğrulaması eklendi)

## 1. Proje Nedir

Süreye dayalı ücretlendirme yapan oyun/eğlence merkezi (FEC) için müşteri giriş-çıkış takibi,
otomatik ücret hesaplama, manuel ödeme kapatma ve ciro analitiği sistemi. Mimari özet:
[fec-proje-mimari-ozet.md](fec-proje-mimari-ozet.md).

## 2. Teknoloji Yığını

- **Backend**: Go (chi router, pgx/v5), `backend/`
- **Veritabanı**: PostgreSQL 16 (Docker, `docker-compose.yml`)
- **Frontend**: React + TypeScript + Vite, `frontend/`
- **Auth**: JWT (bcrypt şifre hash), izin modeli aşağıda

## 3. Nasıl Çalıştırılır

```bash
# Veritabanı
docker compose up -d

# Migration'ları uygula (ilk kurulumda)
docker exec -i parla-oyun-evi-db psql -U parla -d parla_oyun_evi < backend/migrations/0001_init.sql
docker exec -i parla-oyun-evi-db psql -U parla -d parla_oyun_evi < backend/migrations/0002_permissions.sql
docker exec -i parla-oyun-evi-db psql -U parla -d parla_oyun_evi < backend/migrations/0003_business_days.sql
docker exec -i parla-oyun-evi-db psql -U parla -d parla_oyun_evi < backend/migrations/0004_indirim.sql

# Backend (port 8080)
cd backend && go run ./cmd/api

# İlk yönetici kullanıcısı (sadece ilk kurulumda)
cd backend && go run ./cmd/seed <username> <password>

# Dummy veri (opsiyonel, test için)
cd backend && go run ./cmd/seed_dummy

# Frontend (port 5173)
cd frontend && npm run dev
```

LAN/telefon erişimi için Vite `server.host: true` ile 0.0.0.0'da dinliyor
([vite.config.ts](frontend/vite.config.ts)); frontend API adresini `window.location.hostname`
üzerinden otomatik belirliyor. Backend CORS, isteğin Origin'ini yansıtıyor (dev ortamı).
LAN'dan erişim için Windows Güvenlik Duvarı'nda 5173/8080 portlarına izin verilmesi gerekebilir
(kullanıcı tarafından, PowerShell'de yönetici olarak `New-NetFirewallRule`).

## 4. Veritabanı Şeması (özet)

- `customers`: id, tc_kimlik_no (unique), ad, soyad, created_at
- `sessions`: id, customer_id, giris_zamani, cikis_zamani, durum (acik/kapali/iptal),
  pricing_rule_id, toplam_dakika, orijinal_tutar_kurus (ham), **indirim_kurus** (uygulanan
  indirim, tutar/yüzdeden hesaplanıp kuruş olarak gönderilir), tahsil_tutar_kurus (yuvarlama ve
  indirim sonrası), odeme_tipi (nakit/kredi_karti), manuel_kapatildi, kapatan_user_id
- `pricing_rules`: id, kurus_per_dakika, effective_from (versiyonlu — geçmiş oturumları etkilemez)
- `users`: id, username, password_hash, role (legacy/kullanılmıyor), **is_admin**, **permissions**
  (text[]: `gun_sonu`, `dashboard`, `musteriler`)
- `audit_log`: user_id, action, target_table, target_id, detail (jsonb)
- `business_days`: id, acilis_zamani, acilis_user_id, kapanis_zamani, kapanis_user_id,
  durum (acik/kapali) — gün başı/gün sonu akışı için

Tüm parasal tutarlar **kuruş cinsinden BIGINT** (FLOAT kullanılmıyor).

## 5. Yetkilendirme Modeli

- `is_admin=true`: tam yetki (tüm ekranlar + fiyat kuralları + kullanıcı yönetimi)
- `is_admin=false` + `permissions` dizisi: sadece o ekranlara erişim
  (`gun_sonu`, `dashboard`, `musteriler`). `kasa_ekrani` herkese açık.
- JWT claims: `user_id`, `is_admin`, `permissions`
- Backend middleware: `auth.RequireAuth`, `auth.RequireAdmin`, `auth.RequirePermission(perm)`
- Şu anki kullanıcılar: `admin`/`Kaya` (is_admin), `kasiyer1` (permissions: gun_sonu, musteriler)

## 6. Ekranlar ve Akışlar

### Kasa Ekranı (`/`, herkese açık)
- TC kimlik no ile sorgu → kayıtlıysa direkt "Giriş Yap", değilse ad/soyad formu ("Kaydet ve Giriş Yap")
- **TC Kimlik No doğrulaması**: input sadece rakam kabul eder, maks 11 hane; ilk 10 hanenin
  toplamının birler basamağı 11. haneye eşit olmalı (hem frontend'de canlı uyarı + Sorgula butonu
  11 haneye kadar devre dışı, hem backend'de `StartSession` içinde sunucu tarafında da doğrulanır)
- **Gün başlatılmadı ise giriş engellenir** (backend 409 + frontend uyarı)
- İçeride olanlar listesi; satıra tıklayınca detay paneli: canlı geçen dakika + canlı hesaplanan
  tutar (aktif fiyat kuralına göre) + **Yuvarla checkbox'ı** + **İndirim Uygula** (TL veya %
  seçilebilir, canlı hesaplanan indirim ve son tutar gösterilir) + Nakit Ödendi / Kredi Kartı Ödendi
  — hesaplama sırası: ham tutar → (varsa) yuvarla → (varsa) indirim düş, indirim tutarı hiçbir
  zaman kalan tutarı geçemez (backend'de de sınırlanır)

### Gün Sonu (`/gun-sonu`, izin: `gun_sonu`)
- Gün kapalıysa: sadece "Gün Başı Yap" butonu
- Gün açıksa: açık oturumlar listelenir (Nakit Ödendi / Kredi Kartı Ödendi / Elle Kapat — elle
  kapatmada tarih/ödeme tipi/yuvarla seçilebilir)
- Açık oturum varken "Gün Sonu Yap" **devre dışı** (backend da 409 ile engeller)
- Tüm oturumlar kapatılınca "Gün Sonu Yap" → o günün tüm işlemlerini içeren **.docx raporu**
  otomatik iner (logo sol üstte, "Parla Oyun Evi" / "Gün Sonu Raporu" ortada, tarih sağ üstte,
  tablo — Müşteri/Giriş/Çıkış/Süre/**İndirim**/Tutar/Ödeme Tipi/Kapatma Şekli — özet satırında
  "Toplam İndirim" de var, sayfa altında "Sadece Yönetici Görebilir")

### Yönetici Dashboard (`/dashboard`, izin: `dashboard`)
- Bugün/Bu Hafta/Bu Ay/Özel Aralık sekmeleri (seçilince veri otomatik güncellenir)
- Toplam ciro, oturum sayısı, Nakit/Kart oranı (yüzde ⇄ tutar toggle butonu)
- Ödeme tipi dağılım tablosu
- Grafik başlığı seçili sekmeye göre değişir: Günlük Ciro / Haftalık Ciro / Aylık Ciro /
  Özel Aralık Cirosu; her çubukta tutar her zaman görünür
- "Excel Olarak İndir" (.xlsx, seçili tarih aralığı, İndirim (TL) kolonu dahil)

### Müşteriler (`/musteriler`, izin: `musteriler`)
- Arama (Türkçe karekter-duyarlı büyük/küçük harf normalizasyonu ile, ad/soyad/TC)
- Müşteri listesi (ziyaret sayısı, toplam harcama, son ziyaret, "İçeride" etiketi)
- Satır seçilince geçmiş işlemler tablosu + "Excel Olarak İndir" (o müşteriye özel, İndirim (TL)
  kolonu dahil)

### Kullanıcı Yönetimi (`/kullanicilar`, sadece is_admin)
- Yeni hesap oluşturma (kullanıcı adı, şifre, is_admin veya ekran izinleri)
- Mevcut hesapları listeleme, **düzenleme** (kullanıcı adı/şifre/izin güncelleme — inline form),
  silme (kendi hesabını silemez, kendi is_admin'ini kaldıramaz)

### Fiyat Yönetimi (`/fiyat-yonetimi`, sadece is_admin)
- Güncel saatlik ücret + dakika başı ücret + geçerlilik başlangıcı
- Yeni saatlik ücret girme → kaydedildiği andan itibaren geçerli olur, geçmiş oturumları etkilemez
- Fiyat geçmişi tablosu

## 7. Tasarım Sistemi

`frontend/src/index.css` — logo.jpeg renklerinden türetilmiş palet (hardal sarısı, adaçayı yeşili,
terracotta, krem), "Baloo 2" (başlık) + "Quicksand" (gövde) fontları. Ortak sınıflar: `.card`,
`.stat-card`, `.badge`, `.alert`, `.field`, `.field-row`, `.two-col` (responsive iki panel düzeni).
Mobil breakpoint `@media (max-width: 640px)` mevcut; tüm sayfalar 375px genişlikte test edildi,
yatay taşma yok.

## 8. Bilinen Kısıtlar / Yapılmadı

- KVKK/TC kimlik verisi saklama politikası netleştirilmedi (mimari özette not edilmişti)
- Otomatik/periyodik veritabanı yedeklemesi yok (sadece manuel Excel export var)
- Audit log ekranı (görüntüleme arayüzü) yok — veri tutuluyor ama UI'da gösterilmiyor
- `role` sütunu (users tablosunda) artık kullanılmıyor, sadece eski CHECK kısıtını karşılamak için
  otomatik dolduruluyor (is_admin'e göre 'yonetici'/'kasiyer')

## 9. Yapılan İşler (kronolojik özet)

1. Proje iskeleti: Go backend + React/TS/Vite frontend + Postgres (docker-compose)
2. JWT tabanlı giriş/kimlik doğrulama
3. Gün sonu / manuel oturum kapatma (ilk versiyon)
4. Dashboard raporlama (tarih aralığı, ciro, ödeme dağılımı)
5. Excel export (genel oturumlar + müşteri bazlı)
6. Frontend tasarımı logo.jpeg'e göre yenilendi (renk paleti, tipografi, bileşenler)
7. Müşteriler ekranı (liste, arama, geçmiş, export)
8. Kasa Ekranı: TC sorgula → bulundu/kayıt gerekli akışı
9. Ekran bazlı esnek izin sistemi (is_admin + permissions), Kullanıcı Yönetimi ekranı
10. Kullanıcı düzenleme (PATCH), müşteri aramada Türkçe karakter düzeltmesi (Go tarafında normalize)
11. Dashboard: grafik tutar etiketleri, Nakit/Kart oranı toggle, sekmeye göre grafik başlığı
12. Mevcut veriler temizlendi, dummy veri seed script'i (`cmd/seed_dummy`) eklendi
13. Kasa Ekranı: müşteriye tıklayınca canlı dakika/tutar + ödeme işaretleme paneli
14. **Gün Başı / Gün Sonu iş akışı yeniden yapıldı**: `business_days` tablosu, açık oturum varken
    gün sonu engellenmesi, gün sonunda otomatik **.docx raporu** (harici kütüphanesiz, elle OOXML
    üretimi — `backend/internal/docx`)
15. Word raporu formatı: sol üstte logo (gömülü, `backend/internal/assets`), ortada başlık/alt
    başlık, sağ üstte tarih, altta işlem tablosu, sayfa altında "Sadece Yönetici Görebilir" footer
16. LAN/telefon erişimi için Vite host + dinamik API_BASE + dinamik CORS
17. Gün başı yapılmadan müşteri girişi engellendi (backend + frontend)
18. Kasa Ekranı'na Yuvarla seçeneği eklendi (detay panelinde)
19. Responsive/mobil düzen düzeltmeleri: `.two-col` sınıfı, `min-width:0`, `.card` overflow-x,
    mobil breakpoint — tüm sayfalarda yatay taşma giderildi
20. **İndirim özelliği**: `sessions.indirim_kurus` kolonu (migration 0004), `CloseSession`
    endpoint'i tutar/yüzde bazlı indirimi hesaplayıp uyguluyor (indirim asla kalan tutarı geçemez,
    sunucu tarafında sınırlanır). Kasa Ekranı detay paneline "İndirim Uygula" butonu + TL/%
    seçici eklendi (yuvarlamadan sonraki tutar üzerinden hesaplanır). Gün sonu .docx raporuna ve
    her iki Excel export'una (genel + müşteri bazlı) "İndirim" kolonu eklendi; gün sonu raporunun
    özetinde "Toplam İndirim" satırı var. Uçtan uca test edildi (tutar/yüzde/sınırlama/rapor).
21. **TC Kimlik No doğrulaması**: Kasa Ekranı'ndaki TC input'u sadece rakam kabul eder, maks 11
    hane; basit checksum kuralı (ilk 10 hanenin toplamının birler basamağı 11. haneye eşit
    olmalı) hem frontend'de (canlı uyarı, buton 11 haneye kadar disabled) hem backend'de
    (`isValidTCKimlikNo`, `StartSession` içinde) uygulanıyor. Uçtan uca test edildi.
22. **Üretim (prod) kurulumu** (2026-09-14): `Dockerfile` (frontend build + Go, distroless),
    `docker-compose.prod.yml` (db + app + caddy + backup, proje adı `parla-prod`), `deploy/Caddyfile`,
    `deploy/backup.sh`, `.env.prod.example`, [DEPLOY.md](DEPLOY.md). Backend: `STATIC_DIR` ile SPA
    sunumu, gömülü migration'lar (`AUTO_MIGRATE`, `internal/migrate`, aynı `schema_migrations`
    tablosu), HTTP zaman aşımları + graceful shutdown, güvenlik başlıkları/CSP, `api healthcheck`,
    `APP_ENV=production` iken eksik `DATABASE_URL`/kısa `JWT_SECRET` ile açılmama, `TRUST_PROXY`
    (rate limit gerçek IP'ye göre), sabit ngrok CORS adresi → `CORS_ALLOWED_ORIGINS`. `seed` şifreyi
    stdin'den de okuyor. **`backup.ps1` düzeltildi**: PowerShell 5.1 `>` yönlendirmesi dump'ı UTF-16
    yazıyordu, eski `backups/*.sql` dosyaları psql ile doğrudan geri yüklenemez.

## 10. Sistem Durumu (şu an)

**KAPALI.** 2026-07-28 sonunda kullanıcı isteğiyle tamamen durduruldu:
- Backend (Go, port 8080) durduruldu
- Frontend (Vite, port 5173) durduruldu
- Postgres konteyneri `docker compose down` ile durduruldu/kaldırıldı — **volume korunuyor**,
  veri kaybı yok. Tekrar başlatmak için `docker compose up -d` yeterli, migration'ları tekrar
  uygulamaya gerek yok (volume'de zaten mevcut).

## 11. Bir Sonraki Konuşmada

Devam etmeden önce şunları yap:
- §3'teki komutlarla sırayla başlat: `docker compose up -d` → backend → frontend
  (migration'lar zaten volume'de uygulanmış durumda, tekrar çalıştırmaya gerek yok)
- `docker ps` ile Postgres konteynerinin (`parla-oyun-evi-db`) çalıştığını doğrula
- Backend/frontend'in çalışıp çalışmadığını kontrol et (`netstat -ano | grep ":8080"`,
  `mcp__Claude_Browser__preview_list`)
- Kullanıcı canlı test yapıyor olabilir (örn. rastgele TC/isimlerle oluşturulmuş test kayıtları
  görülebilir) — onun verisini/oturumunu silme veya günü kapatma gibi yıkıcı işlemler yapmadan önce sor
