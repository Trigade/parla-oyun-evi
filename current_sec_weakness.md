# Güvenlik Zayıflıkları — Parla Oyun Evi

Bu dosya, backend/frontend kod tabanında yapılan güvenlik taramasında bulunan
zayıflıkları ve bunların nasıl kapatıldığını kaydeder. Uygulama LAN-only
(internete açık olmayan, tek bir işletmenin kasasında çalışan) bir sistem
olduğu için önceliklendirme buna göre yapılmıştır.

Tarama tarihi: 2026-07-28

## Bulgular

| # | Başlık | Dosya:Satır | Önem |
|---|---|---|---|
| 1 | JWT secret, ortam değişkeni yoksa herkese bilinen sabit bir metne düşüyor | `backend/cmd/api/main.go` | **Yüksek** |
| 2 | Postgres portu (5432) tüm ağ arayüzlerine, zayıf sabit şifreyle açık | `docker-compose.yml`, `backend/cmd/api/main.go` | **Orta-Yüksek** |
| 3 | `/api/auth/login` üzerinde brute-force / deneme sınırlaması yok | `backend/cmd/api/main.go`, `backend/internal/handlers/auth.go` | **Orta** |
| 4 | CORS herhangi bir Origin'i koşulsuz yansıtıyor | `backend/cmd/api/main.go` | **Orta** |
| 5 | Login'de kullanıcı adı var/yok zamanlama farkıyla anlaşılabiliyor | `backend/internal/handlers/auth.go` | **Düşük** |
| 6 | Sunucu hatalarında ham `err.Error()` metni istemciye dönüyor | çoğu handler dosyası | **Düşük-Orta** |
| 7 | Ad/Soyad/Kullanıcı adı alanlarında üst uzunluk sınırı yok | `customers.go`, `auth.go` | **Düşük** |
| 8 | Düz HTTP — kimlik bilgileri/JWT ağda şifresiz taşınıyor | `backend/cmd/api/main.go` | **Orta** (kabul edilen risk, aşağıya bakın) |
| 9 | JWT localStorage'da tutuluyor (XSS ile çalınabilir) | `frontend/src/api/client.ts` | **Düşük-Orta** (kabul edilen risk) |
| 10 | 12 saatlik token süresi boyunca sunucu taraflı iptal mekanizması yok | `backend/internal/auth/auth.go` | **Düşük** (kabul edilen risk) |
| 11 | Müşteri oturumu başlatmada (StartSession) kilitsiz kontrol → iki eşzamanlı istek aynı müşteri için iki açık oturum oluşturabiliyordu | `backend/internal/handlers/customers.go` | **Orta** (race condition) |
| 12 | "Gün Başı" işleminde aynı race pattern → iki eşzamanlı istek iki açık iş günü oluşturabiliyordu | `backend/internal/handlers/business_day.go` | **Düşük-Orta** (race condition) |
| 13 | Hata mesajları çıplak HTTP kodu / ham tarayıcı hatası / teknik alan adı içeriyordu | `frontend/src/api/client.ts`, çoğu handler dosyası | **Düşük** (kullanılabilirlik) |

SQL injection, komut enjeksiyonu, path traversal veya eksik yetkilendirme
middleware'i bulunmadı — parametreli sorgular ve route-grubu izin zinciri
tutarlıydı.

### İkinci tarama: İş mantığı hataları / Race Condition / IDOR / XSS

Kullanıcı isteği üzerine dört ek başlık özel olarak incelendi:

- **İş mantığı hataları:** `CloseSession`/`ManualCloseSession` tutarları
  tamamen sunucu tarafında (aktif fiyat kuralı × geçen dakika) hesaplıyor,
  istemciden gelen hiçbir tutar doğrudan güvenilmiyor; indirim tutarı
  toplam tutarı aşamayacak şekilde sunucuda sınırlanıyor (`indirimKurus >
  tahsilTutar` kontrolü). Burada bir açık bulunmadı. Ancak bu incelemede
  **StartSession** ve **StartBusinessDay** akışlarında race condition (aşağıya
  bakın) tespit edildi — bunlar da bir tür iş mantığı ihlaline yol açıyordu
  ("bir müşterinin tek açık oturumu olur" / "tek açık gün olur" kuralı
  eşzamanlı istekle atlanabiliyordu).
- **Race Conditions:** Bulundu ve kapatıldı — bkz. madde 11 ve 12 yukarıda,
  detay için aşağıdaki kapatma kayıtlarına bakın. Diğer tüm çok-adımlı
  işlemler (`CloseSession`, `ManualCloseSession`, `EndBusinessDay`) zaten
  `SELECT ... FOR UPDATE` ile satır kilidi kullanıyordu, orada sorun yoktu.
- **IDOR / Broken Access Control:** Tüm route'lar `main.go`'da doğru
  middleware zincirleriyle sarılı (kimlik doğrulama → izin bazlı gruplar →
  admin-only gruplar) ve her handler'da tekrar kontrol edilmiş durumda; route
  gruplaması dışında kalan bir uç bulunmadı. Uygulama tek-kiracılı (tüm
  personel aynı işletmenin ortak müşteri/oturum verisini görür) bir kasa
  sistemi olduğundan, `{id}` parametresiyle erişilen müşteri/oturum
  kayıtlarının "sahiplik" kontrolüne tabi tutulmaması IDOR değil, iş
  modelinin gereğidir (bir kasiyer başka bir kasiyerin açtığı oturumu
  görüp kapatabilmeli). Klasik anlamda IDOR açığı bulunmadı.
- **XSS:** Frontend kod tabanında (`frontend/src`) `dangerouslySetInnerHTML`,
  `innerHTML`, `document.write` veya `eval` kullanımı bulunmadı; tüm kullanıcı
  girdisi (ad, soyad, telefon vb.) React JSX üzerinden render ediliyor ve
  React bunu varsayılan olarak escape ediyor. Stored/reflected XSS açığı
  bulunmadı.

---

## Kapatma Kayıtları

### 1. JWT secret sabit varsayılana düşüyordu — **KAPATILDI**
`backend/internal/auth/secret.go` içine `LoadOrCreateJWTSecret` eklendi:
`JWT_SECRET` ortam değişkeni ayarlıysa onu kullanır; ayarlı değilse
herkese bilinen sabit metne düşmek yerine `crypto/rand` ile 32 baytlık
rastgele bir anahtar üretir ve `backend/jwt_secret.local` dosyasına
(0600 izinle) yazar — sonraki başlatmalarda aynı dosyadan okunduğu için
mevcut oturumlar backend her yeniden başladığında bozulmaz, ama anahtar
artık hiçbir zaman kaynak kodda bilinen bir sabit olarak durmuyor.
`backend/cmd/api/main.go` bu fonksiyonu çağıracak şekilde güncellendi.
Dosya `.gitignore`'a eklendi. Test: backend yeniden başlatıldı,
`jwt_secret.local` oluştuğu doğrulandı (64 hex karakter = 32 bayt),
`admin/admin123456` ile giriş başarıyla yeni anahtarla token üretti.

### 2. Postgres portu tüm arayüzlere açıktı — **KAPATILDI**
`docker-compose.yml`'da `ports: "5432:5432"` → `"127.0.0.1:5432:5432"`
yapıldı. Backend zaten aynı makinede `localhost` üzerinden bağlandığı
için işlevsellik etkilenmedi; artık LAN'daki başka bir cihaz, uygulama
katmanını (JWT/izinler) tamamen atlayıp doğrudan veritabanına
bağlanamaz. Test: container yeniden oluşturuldu, backend health-check
`localhost` üzerinden sorunsuz çalıştı.

### 3. `/api/auth/login`'de brute-force koruması yoktu — **KAPATILDI**
Bağımlılıksız, bellek-içi bir hız sınırlayıcı eklendi
(`backend/internal/ratelimit/ratelimit.go`): aynı IP'den 5 dakika
içinde 10'dan fazla giriş denemesi `429 Too Many Requests` ile
reddediliyor; başarılı girişte o IP'nin sayacı sıfırlanıyor
(`handlers/auth.go` → `Login`). `handlers.API` struct'ına
`LoginLimiter` alanı eklendi, `main.go`'da `ratelimit.New(10, 5*time.Minute)`
ile kuruldu. Test: aynı IP'den 12 art arda yanlış şifre denemesi
gönderildi → ilk 10'u `401`, 11. ve 12'si `429` döndü (doğrulandı).

### 4. CORS herhangi bir Origin'i koşulsuz yansıtıyordu — **KAPATILDI**
`main.go`'ya `izinliOrigin()` fonksiyonu eklendi: Origin başlığı sadece
`localhost` veya özel IP aralıklarından (`10.0.0.0/8`, `172.16.0.0/12`,
`192.168.0.0/16` — LAN'daki telefon/tablet erişimi için gereken aralık)
geliyorsa `Access-Control-Allow-Origin` olarak yansıtılıyor; `Vary: Origin`
başlığı eklendi. Test: `http://evil-site.com` Origin'iyle istek atıldığında
`Access-Control-Allow-Origin` başlığı **dönmedi**; `192.168.1.50:5173` ve
`localhost:5173` Origin'leriyle doğru şekilde yansıtıldığı doğrulandı.

### 5. Login'de zamanlama farkıyla kullanıcı adı enumerasyonu — **KAPATILDI**
`handlers/auth.go`'ya sabit bir `dummyPasswordHash` eklendi; kullanıcı
adı veritabanında bulunamadığında bile `bcrypt.CompareHashAndPassword`
bu sabit hash'e karşı çalıştırılıyor (önceden hiç çalıştırılmıyordu),
böylece "kullanıcı yok" ile "kullanıcı var, şifre yanlış" yollarının
işlem süresi arasındaki ölçülebilir fark ortadan kalktı. Davranış/hata
mesajı değişmedi (`build` ile doğrulandı, mevcut testler etkilenmedi).

### 6. Ham `err.Error()` istemciye dönüyordu — **KAPATILDI**
`handlers/handlers.go`'ya `writeServerError(w, status, publicMsg, err)`
yardımcı fonksiyonu eklendi: ham hatayı sadece sunucu loguna (`log.Printf`)
yazar, istemciye yalnızca önceden yazılmış genel mesajı döner. 7 handler
dosyasındaki (`business_day.go`, `auth.go`, `sessions.go`, `pricing.go`,
`reports.go`, `export.go`, `customers.go`) toplam 34 adet
`writeError(w, status, "mesaj: "+err.Error())` çağrısı bu yeni
fonksiyona geçirildi (`perl` ile toplu regex değişimi, ardından
`gofmt`). Test: `go build ./...` ve `go vet ./...` hatasız geçti.

### 7. Ad/Soyad/Kullanıcı adı alanlarında üst sınır yoktu — **KAPATILDI**
`customers.go`'ya `adSoyadGecerliMi()` (1-100 karakter) eklendi ve
`StartSession`/`UpdateCustomer`'da kullanıldı. `auth.go`'da
`CreateUser`/`UpdateUser`'a kullanıcı adı ≤64, şifre ≤200 karakter
sınırı eklendi. Ayrıca `main.go`'ya genel bir istek gövdesi boyutu
sınırı (`http.MaxBytesReader`, 1 MiB) eklendi — tüm uçlar için ek bir
savunma katmanı.

### 8. Düz HTTP (TLS yok) — **KABUL EDİLEN RİSK, kapatılmadı**
Bilinçli olarak ertelendi: bu, tek bir kasa cihazının bulunduğu
kapalı bir LAN'da çalışan bir uygulama; TLS eklemek (kendinden imzalı
sertifika + tarayıcı uyarıları, ya da gerçek bir sertifika için alan
adı/CA gereksinimi) kullanılabilirliği bozacak ve LAN-only tehdit
modeline göre getirisi (paylaşılan/güvenilmeyen Wi-Fi olmadığı sürece)
düşük. Eğer işletme misafir Wi-Fi'siyle aynı ağı paylaşıyorsa veya
cihaz taşınabilir hâle geliyorsa bu risk yeniden değerlendirilmeli;
o durumda `mkcert` ile yerel bir CA kurup backend'e TLS desteği
eklemek önerilir.

### 9. JWT localStorage'da tutuluyor — **KABUL EDİLEN RİSK, kapatılmadı**
İncelemede stored/reflected XSS açığı bulunmadı (bkz. yukarıdaki "İkinci
tarama" bölümü), yani bu riskin fiilen istismar edilebileceği bir yol şu
an yok. httpOnly cookie'ye geçmek CSRF koruması (SameSite/CSRF token)
gerektiren, mimariyi değiştiren bir iş; XSS açığı olmadığı sürece bu
maliyeti bu aşamada haklı çıkarmıyor. XSS bulunursa öncelik bu maddeye
kayar.

### 10. 12 saatlik token için sunucu taraflı iptal yok — **KABUL EDİLEN RİSK, kapatılmadı**
Bir oturum/token kara listesi (DB'de veya Redis'te) eklemek, bu ölçekteki
bir uygulama için orantısız bir mimari karmaşıklık getirir. Personel
hesabı silindiğinde/güncellendiğinde o kullanıcının aktif tokenı en fazla
12 saat daha geçerli kalabilir; bu, LAN-only tek-kasa senaryosunda kabul
edilebilir bulundu. Daha kısa TTL (ör. 2 saat + sessiz yenileme) ileride
değerlendirilebilir.

### 11. StartSession'da race condition — **KAPATILDI**
`backend/migrations/0006_race_condition_fix.sql` ile
`sessions(customer_id)` üzerinde `WHERE durum = 'acik'` koşullu bir
**kısmi unique index** eklendi (`idx_sessions_one_open_per_customer`) —
bir müşterinin aynı anda birden fazla açık oturumu olması artık
veritabanı seviyesinde imkansız. `customers.go`'da `StartSession`,
bu constraint'in tetiklediği Postgres `unique_violation` (23505) hatasını
`pgUniqueViolation()` ile yakalayıp kullanıcıya zaten var olan
"bu müşterinin zaten açık bir oturumu var" mesajını dönecek şekilde
güncellendi (önceden bu senaryoda genel bir 500 hatası dönerdi).
**Test:** Aynı yeni müşteri için 5 eşzamanlı `POST /sessions/start`
isteği gönderildi → yalnızca 1 tanesi `201` ile başarılı oldu, diğer 4'ü
`409` döndü; veritabanında o müşteri için gerçekten tek bir açık oturum
olduğu doğrulandı (fix öncesi bu senaryo iki açık oturum oluşturabilirdi).

### 12. StartBusinessDay'de aynı race condition — **KAPATILDI**
Aynı migration dosyasına `business_days` tablosunda `(1)` sabit ifadesi
üzerinde `WHERE durum = 'acik'` koşullu bir kısmi unique index eklendi
(`idx_business_days_single_open`) — aynı anda en fazla bir açık iş günü
olabileceği kuralı artık veritabanı seviyesinde garanti ediliyor.
`business_day.go`'da `StartBusinessDay`, bu constraint ihlalini
yakalayıp uygun "zaten açık bir gün var" mesajını dönecek şekilde
güncellendi. Migration, mevcut veride tekrar eden açık kayıt olmadığı
doğrulandıktan sonra uygulandı (`CREATE INDEX` hatasız tamamlandı).

### 13. Hata mesajları teknik/kod gibi görünüyordu — **KAPATILDI**
Kullanıcı, arkadaşının bir istekte (`/sessions/{id}/manual-close`) aldığı
hatayı anlayamadığını bildirdi. İnceleme sonucu iki ayrı sorun bulundu:

- **Frontend (`frontend/src/api/client.ts`):** Sunucudan açıklayıcı bir
  `hata` alanı gelmediğinde (ör. sunucu tamamen çökmüşse ya da yanıt JSON
  değilse) kullanıcıya `"İstek başarısız: 404"` gibi çıplak bir HTTP kodu
  gösteriliyordu; ayrıca ağ/CORS/bağlantı hatalarında tarayıcının ham
  `"Failed to fetch"` mesajı doğrudan ekrana yansıyordu. `statusMesaji()`
  (HTTP koduna göre Türkçe, açıklayıcı bir mesaj üretir) ve `agHatasiMesaji()`
  (fetch() başarısız olduğunda "Sunucuya ulaşılamıyor..." mesajı) eklendi;
  hem `request()` hem `downloadFile()` bunları kullanacak şekilde güncellendi.
  Test: `fetch('http://localhost:9999/...')` ile gerçek bir ağ hatası
  tetiklendi, tarayıcının döndürdüğü ham mesajın (`"Failed to fetch"`)
  artık `agHatasiMesaji()` ile değiştirildiği doğrulandı.
- **Backend (`backend/internal/handlers/*.go`):** Birkaç mesaj snake_case
  API alan adları (`odeme_tipi`, `indirim_kurus`, `tc_kimlik_no` vb.) veya
  teknik terimler (`token`, `hash`) içeriyordu — kod/komut gibi okunuyordu.
  Toplam ~15 mesaj daha anlaşılır Türkçe cümlelere çevrildi (ör.
  `"odeme_tipi 'nakit' veya 'kredi_karti' olmalıdır"` →
  `"Ödeme tipi 'Nakit' veya 'Kredi Kartı' olmalıdır."`, `"token üretilemedi"`
  → `"Oturum belirteci oluşturulamadı, lütfen tekrar deneyin."`).
  Test: backend yeniden başlatıldı, birkaç uç noktaya (`sessions/close`,
  `sessions/manual-close`, `sessions/start`) hatalı istek gönderildi,
  dönen `hata` alanlarının tamamının açıklayıcı cümleler olduğu doğrulandı.

**Arkadaşınızın gördüğü asıl hata** muhtemelen ya bu ham `"İstek başarısız:
404"` / `"Failed to fetch"` tipi mesajlardan biriydi (artık düzeltildi), ya
da `/sessions/{id}/manual-close` şu sebeplerden biriyle gerçekten
başarısız oluyordu: (a) hesabında `gun_sonu` izni/yöneticilik yok — 403,
(b) o `id`'ye sahip bir oturum kendi veritabanında yok — 404 "oturum
bulunamadı", (c) oturum zaten kapalı — 409, (d) girdiği çıkış zamanı,
oturumun giriş zamanından önceydi — 400 "çıkış zamanı giriş zamanından
önce olamaz". Bu dört durumun hepsi artık zaten açıklayıcı Türkçe mesajlar
döndürüyor.
