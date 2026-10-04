# Parla Oyun Evi — Üretim Kurulumu (Deploy)

Üretim ortamı tek bir Docker Compose dosyasıyla çalışır (`docker-compose.prod.yml`):

| Servis   | Görevi |
|----------|--------|
| `db`     | PostgreSQL 16. Portu dışarı açık değil. |
| `app`    | Go backend + derlenmiş frontend (tek imaj). Açılışta eksik migration'ları uygular. |
| `caddy`  | Dışarıya açılan tek kapı (80/443). Alan adı verilirse HTTPS sertifikasını otomatik alır. |
| `backup` | Her gün 03:00'te `backups/prod/` klasörüne `pg_dump` alır, 30 günden eskileri siler. |

Geliştirme ortamı (`docker-compose.yml`, `start.ps1`) değişmedi; ikisi ayrı proje adı ve ayrı veriyle çalışır.

## 1. Sunucu gereksinimleri

- Docker Engine + Docker Compose v2 (Linux sunucu) **veya** Docker Desktop (Windows kasa bilgisayarı)
- En az 1 CPU, 1 GB RAM, 10 GB disk
- Saat senkronizasyonu açık olmalı (NTP). TOTP kodları saat 90 saniyeden fazla kayarsa reddedilir.
- İnternete açık kurulumda: sunucuyu gösteren bir alan adı (DNS A kaydı), 80 ve 443 portları açık

## 2. Ayarlar (.env)

```bash
cp .env.prod.example .env
```

Rastgele değerleri üretin:

```bash
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 32   # JWT_SECRET
```

Windows'ta (PowerShell):

```powershell
-join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
```

`SITE_ADDRESS`:
- Yerel ağ (kasa + tablet): `:80` → `http://<kasa-bilgisayarı-IP>`
- İnternet: `parla.ornekalanadi.com` → HTTPS otomatik

## 3. İlk kurulum

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps          # hepsi "healthy"/"running" olmalı
docker compose -f docker-compose.prod.yml exec app /app/seed admin
```

Son komut yönetici şifresini sorar (en az 6 karakter; 12+ önerilir). İlk girişte telefona Google Authenticator / Microsoft Authenticator ile QR kod okutulur.

## 4. Mevcut verileri taşıma (eski kurulumdan)

Eski bilgisayarda `start.ps1` ile çalışan sistemin verisini (müşteriler, oturumlar, paketler,
kullanıcılar, TOTP kayıtları) yeni kuruluma aktarmak için. Bu adımı **3. adımdaki `seed`
komutundan önce** yapın; kullanıcılar zaten dump ile gelir.

**Eski bilgisayarda** (proje klasöründe, PowerShell):

```powershell
# Dump konteyner içinde dosyaya yazılır — PowerShell'in ">" yönlendirmesi dosyayı bozar
docker exec parla-oyun-evi-db pg_dump -U parla -d parla_oyun_evi --format=custom -f /tmp/tasima.dump
docker cp parla-oyun-evi-db:/tmp/tasima.dump .\tasima.dump
```

`tasima.dump` dosyasını yeni bilgisayardaki kurulum klasörüne kopyalayın (USB bellek vb.).
Dosyada TC kimlik numaraları var: taşıma bitince USB'den ve eski bilgisayardan silin.

**Yeni bilgisayarda** (kurulum klasöründe, `.env` hazırlandıktan sonra):

```powershell
# 1) Sadece veritabanını başlat
docker compose -f docker-compose.prod.yml up -d --wait db

# 2) Dump'ı geri yükle
docker compose -f docker-compose.prod.yml cp .\tasima.dump db:/tmp/tasima.dump
docker compose -f docker-compose.prod.yml exec db pg_restore -U parla -d parla_oyun_evi --no-owner /tmp/tasima.dump

# 3) Tüm sistemi başlat
docker compose -f docker-compose.prod.yml up -d --build --wait
```

Giriş yapıp verilerin geldiğini kontrol ettikten sonra **eski bilgisayarda** `.\stop.ps1` ile
eski sistemi durdurun. Aynı gün iki sistemde birden işlem yapılmasın; eski sistemde dump'tan
sonra açılan oturumlar yeni sisteme geçmez.

`JWT_SECRET` değiştiği için herkes bir kez yeniden giriş yapar; TOTP (Authenticator) kodları
aynen çalışmaya devam eder.

## 5. Güncelleme

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Yeni migration dosyaları `app` açılırken otomatik uygulanır. Güncellemeden önce elle yedek almak için:

```bash
docker compose -f docker-compose.prod.yml exec backup /bin/sh /usr/local/bin/parla-backup.sh now
```

## 6. Yedekten geri dönme

```bash
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml exec db pg_restore -U parla -d parla_oyun_evi --clean --if-exists --no-owner /backups/...   # bkz. not
docker compose -f docker-compose.prod.yml start app
```

Not: yedekler `backup` servisinde `/backups` altındadır; `db` servisine önce kopyalayın:
`docker compose -f docker-compose.prod.yml cp backups/prod/<dosya>.dump db:/tmp/geri.dump`

Yedekleri sunucu dışına da kopyalayın (harici disk / bulut). Yedeklerde TC kimlik numaraları var: şifreli ortamda saklayın (KVKK).

## 7. İzleme

```bash
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs backup
curl http://localhost/api/health     # {"durum":"ok"}
```

## 8. Otomatik güncelleme (GitHub + hazır imaj)

Kod GitHub'da özel bir depoda tutulur. `main` dalına her gönderimde GitHub
uygulamayı derleyip hazır imajı `ghcr.io`'ya yayınlar
(`.github/workflows/imaj-yayinla.yml`). İş bilgisayarı yalnızca bu imajı
indirir; o bilgisayarda derleme yapılmaz.

**Depo özel, imaj herkese açıktır.** Böylece iş bilgisayarında hiçbir kimlik
bilgisi (token/şifre) saklanmaz: makine imajı anonim olarak indirir. İmajın
içinde yalnızca derlenmiş uygulama vardır — müşteri verisi, `.env`, yedekler
ve belgeler imaja girmez (bkz. `.dockerignore`). Müşteri verisi hiçbir zaman
GitHub'a gönderilmez; yalnızca iş bilgisayarındaki veritabanında durur.

**GitHub'da bir kez yapılacak:** ilk imaj yayınlandıktan sonra paket
görünürlüğünü herkese açık yapın — depo sayfası → sağdaki **Packages** →
`parla-oyun-evi` → **Package settings** → **Change visibility** → **Public**.

**İş bilgisayarında bir kez yapılacak kurulum:**

1. `.env` dosyasına imaj adını ekleyin (küçük harf):
   ```
   APP_IMAGE=ghcr.io/<github-kullanici-adi>/parla-oyun-evi:latest
   ```
2. Otomatik güncellemeyi kurun (gece görevi + masaüstü kısayolu):
   ```powershell
   .\deploy\otomatik-guncelleme-kur.ps1
   ```

**Bundan sonra:** her gece 03:30'da yeni sürüm kontrol edilir. Yeni sürüm
yoksa hiçbir şey yapılmaz. Varsa önce yedek alınır, imaj indirilip uygulanır,
sağlık kontrolü yapılır; başarısız olursa otomatik olarak eski sürüme dönülür.
Kasada açık oturum varsa gece güncellemesi ertelenir. Elle güncellemek için
masaüstündeki **Parla Oyun Evi - Güncelle** kısayolu kullanılır.

Kayıtlar: `deploy\guncelleme.log`. Güncelleme komutları `docker-compose.auto.yml`
dosyasını kullanır; bu dosya `docker-compose.prod.yml` ile aynı proje adını ve
aynı veritabanı volume'ünü kullandığı için veri taşımaya gerek yoktur.

## Ortam değişkenleri (app)

| Değişken | Açıklama |
|----------|----------|
| `APP_ENV=production` | Eksik `DATABASE_URL` / kısa `JWT_SECRET` ile açılmayı reddeder |
| `DATABASE_URL` | Postgres bağlantı adresi |
| `JWT_SECRET` | ≥ 32 karakter |
| `AUTO_MIGRATE` | `true` ise açılışta eksik migration'lar uygulanır |
| `STATIC_DIR` | Derlenmiş frontend dizini (imajda `/app/web`) |
| `TRUST_PROXY` | Caddy arkasında `true`: rate limit gerçek istemci IP'sine göre çalışır. Proxy yoksa kapalı tutun. |
| `CORS_ALLOWED_ORIGINS` | Opsiyonel, virgülle ayrılmış ek origin'ler |
| `PORT` | Varsayılan 8080 |
