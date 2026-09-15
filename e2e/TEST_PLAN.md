# Parla Oyun Evi — E2E Test Planı (Playwright)

Bu doküman, otomatikleştirilecek tüm use case ve edge case'leri listeler.
Her madde bir `test()` bloğuna karşılık gelir (spec dosyası parantez içinde
belirtilmiştir). "OTOMATİKLEŞTİRİLMEDİ" olarak işaretlenenler bilinçli
olarak kapsam dışı bırakılmıştır; sebebi yanına yazılmıştır.

**Durum:** Tüm liste yazıldı ve gerçek uygulamaya karşı çalıştırıldı.
57 testten 53'ü geçti, 4'ü (yıkıcı/paylaşımlı-veriye-bağımlı senaryolar,
kendi içlerinde belgelenmiştir) bilinçli olarak atlandı, 0 başarısız.
Bu süreçte testler gerçek bir uygulama hatası da yakaladı ve bu hata
düzeltildi — bkz. `frontend/src/api/client.ts` içindeki not (aşağıda).

> **E2E testleriyle bulunan gerçek hata:** `client.ts`'deki genel `request()`
> yardımcı fonksiyonu, ANY 401 yanıtını (endpoint fark etmeksizin) "oturum
> süresi doldu" olarak yorumlayıp kullanıcıyı zorla `/login`'e yönlendiriyordu.
> Bu, `/auth/login` uç noktasının kendi 401'ini (yanlış şifre) de yakalıyor
> ve gerçek "kullanıcı adı veya şifre hatalı" mesajını hiç göstermeden
> sayfayı sıfırlıyordu. `auth.spec.ts`'in "yanlış şifre" testi bunu ortaya
> çıkardı; düzeltme `path !== "/auth/login"` koşuluyla login uç noktasını
> bu genel 401-yönlendirme davranışından muaf tutuyor.

## 1. Kimlik Doğrulama (`auth.spec.ts`)

- [x] Doğru kullanıcı adı/şifre ile giriş → Kasa Ekranı'na yönlendirme
- [x] Yanlış şifre ile giriş → açıklayıcı hata mesajı, sayfada kalma
- [x] Var olmayan kullanıcı adıyla giriş → aynı genel hata mesajı (kullanıcı adı sızdırmıyor)
- [x] Boş alanlarla submit → tarayıcı/form seviyesinde engelleme ya da backend hatası
- [x] Giriş yapmadan korumalı bir sayfaya (`/dashboard`) direkt URL ile gidiş → `/login`'e yönlendirme
- [x] Başarılı giriş sonrası sayfa yenileme → oturumun korunması (localStorage token)
- [x] Çıkış Yap → token temizlenip `/login`'e dönme, tekrar korumalı sayfaya erişememe
- [ ] OTOMATİKLEŞTİRİLMEDİ: Rate-limit (10 başarısız denemeden sonra 429) — paylaşılan backend'in
      limitini tüketip diğer testleri (ve gerçek kullanıcıyı) etkileme riski var; bu senaryo
      pentest raporunda API seviyesinde zaten doğrulandı.

## 2. Kasa Ekranı — Müşteri Sorgulama ve Giriş (`kasa-ekrani.spec.ts`)

- [x] TC ile sorgula → kayıtlı müşteri bulunur → "Kayıt bulundu" kartı → Giriş Yap → İçeride Olanlar'a düşer
- [x] TC ile sorgula → kayıtsız TC → "kayıt gerekli" formu açılır, TC alanı kilitli/dolu gelir
- [x] Geçersiz TC formatı (11 haneden az/checksum hatalı) → Sorgula butonu disabled / hata mesajı
- [x] Telefon ile sorgula → kayıtlı müşteri bulunur (TC otomatik doldurulur)
- [x] Telefon ile sorgula → kayıtsız telefon → kayıt formu, telefon alanı kilitli, TC alanı boş/giriş bekliyor
- [x] Geçersiz telefon formatı → Sorgula butonu disabled
- [x] İsim ile Ara → 2+ karakterden itibaren canlı arama sonucu listelenir
- [x] İsim ile Ara → eşleşme yoksa "Eşleşen müşteri bulunamadı" mesajı
- [x] İsim ile Ara → sonuçtaki "Giriş Yap" butonuna tıklayınca ek sorgulama olmadan direkt giriş yapılır
- [x] İsim ile Ara → zaten içeride olan müşteri "İçeride" rozetiyle işaretli, tıklanamaz/giriş yapılamaz
- [x] Yeni müşteri kaydı → ad/soyad/telefon eksikken "Kaydet ve Giriş Yap" disabled
- [x] Yeni müşteri kaydı → tüm alanlar geçerliyken kayıt oluşturulur ve oturum açılır
- [x] Yeni müşteri kaydı → veli telefonu opsiyonel, boş bırakılabilir
- [x] Vazgeç butonu → formu/sorgu ekranını sıfırlar
- [ ] OTOMATİKLEŞTİRİLMEDİ: "Bu telefon numarası başka bir müşteriye kayıtlı" uyarısı — belirli bir
      dummy müşteri telefonuna bağımlı, veri setinin (`reset-dummy.ps1`) her koşuda aynı telefonları
      üretmesine güvenmek testi kırılgan yapar; mantık backend testinde (pentest raporu md.4.7 benzeri)
      zaten doğrulanmış durumda.

## 3. Kasa Ekranı — Gün Kapalı Durumu (`kasa-ekrani.spec.ts`)

- [x] Gün kapalıyken Müşteri Girişi formu yerine uyarı metni gösterilir, sorgu butonları görünmez
- [ ] OTOMATİKLEŞTİRİLMEDİ: Gerçek "gün kapatma" akışının bu testten önce çalıştırılması diğer
      paralel testleri (açık oturum gerektirenler) bozar; bu senaryo `gun-sonu.spec.ts` içinde
      gün sonu akışının doğal bir parçası olarak zaten dolaylı test ediliyor.

## 4. Kasa Ekranı — İçeride Olanlar ve Ödeme Kapatma (`kasa-ekrani.spec.ts`)

- [x] İçeride Olanlar listesinde bir satıra tıklayınca ödeme paneli açılır
- [x] Ödeme paneli → "Yuvarla" checkbox'ı işaretlenince tutar değişir
- [x] Ödeme paneli → İndirim Uygula → tutar (TL) girişiyle toplam düşer
- [x] Ödeme paneli → İndirim Uygula → yüzde girişiyle toplam düşer
- [x] Ödeme paneli → "Nakit Ödendi" → oturum kapanır, İçeride Olanlar listesinden düşer
- [x] Ödeme paneli → "Kredi Kartı Ödendi" → oturum kapanır
- [x] Panel üstündeki "Kapat" butonu → sadece paneli gizler, oturumu KAPATMAZ (liste değişmez)

## 5. Müşteriler Sayfası (`musteriler.spec.ts`)

- [x] Sayfa açılışında müşteri listesi ve tüm kolonlar (TC, Telefon, Veli Telefonu, Ziyaret, Harcama) görünür
- [x] Arama kutusu → ad/soyad/TC/telefon ile filtreleme çalışır
- [x] Arama → eşleşme yoksa "Kayıt bulunamadı" mesajı
- [x] Bir satıra tıklayınca popup (geçmiş işlemler) açılır
- [x] Popup → Esc tuşu ile kapanır
- [x] Popup → overlay'e (dışına) tıklayınca kapanır
- [x] Popup → "Kapat" butonuyla kapanır
- [x] Popup → "Düzenle" → form alanları mevcut veriyle dolu gelir
- [x] Düzenle → geçersiz TC girilince "Kaydet" disabled olur
- [x] Düzenle → geçerli değişiklikle "Kaydet" → liste ve popup başlığı anında güncellenir
- [x] Düzenle → "İptal" → form kapanır, değişiklik kaydedilmez

## 6. Yönetici Dashboard (`dashboard.spec.ts`)

- [x] "Bugün / Bu Hafta / Bu Ay / Özel Aralık" preset butonları arasında geçiş, aktif buton stili
- [x] "Özel Aralık" seçilince tarih inputları görünür ve değiştirilebilir
- [x] Stat kartları (Toplam Ciro, Oturum Sayısı, Nakit/Kart Oranı) sayısal değerlerle dolu gelir
- [x] "Tutar Göster" / "Yüzde Göster" toggle metni ve gösterimi değişir
- [x] Ödeme Tipi Dağılımı tablosu Nakit/Kredi Kartı satırlarını gösterir
- [x] Veri olmayan bir aralıkta grafik yerine "Bu aralıkta kapanmış oturum yok" mesajı

## 7. Gün Sonu (`gun-sonu.spec.ts`)

- [x] Gün kapalıyken sadece "Gün Başı Yap" kartı görünür
- [x] "Gün Başı Yap" → gün açılır, "Gün Açık" kartı ve oturum tablosu görünür
- [x] Açık oturum varken "Gün Sonu Yap" butonu disabled + uyarı satırı
- [x] Açık oturumu "Nakit Ödendi" ile kapatınca listeden düşer
- [x] "Elle Kapat" formu açılır (tarih/saat, ödeme tipi, yuvarla alanları)
- [x] "Elle Kapat" → geçmiş bir çıkış zamanıyla onaylanınca oturum "elle kapatıldı" olarak kapanır
- [x] Tüm açık oturumlar kapanınca "Gün Sonu Yap" aktifleşir ve PDF indirmesi tetiklenir

## 8. Kullanıcı Yönetimi — Admin Only (`kullanicilar.spec.ts`)

- [x] Admin kullanıcı listesini görür, yeni kullanıcı oluşturabilir
- [x] Kısa şifre (6 karakterden az) ile oluşturma → backend hata mesajı
- [x] Oluşturulan kullanıcı düzenlenip izinleri değiştirilebilir
- [x] Kendi hesabının admin yetkisini kaldırma denemesi engellenir
- [x] Kendi hesabını silme denemesi engellenir
- [x] Oluşturulan test kullanıcısı silinebilir (liste güncellenir)
- [x] Admin olmayan (izinsiz) bir kullanıcı `/kullanicilar` adresine gidince erişemez

## 9. Fiyat Yönetimi — Admin Only (`fiyat-yonetimi.spec.ts`)

- [x] Aktif fiyat kuralı (dakika ücreti) görüntülenir
- [x] Yeni fiyat kuralı eklenince aktif kural güncellenir
- [x] Negatif dakika ücreti girilince backend hatası gösterilir
- [x] Admin olmayan kullanıcı bu sayfaya erişemez

## 10. Yetkilendirme / Navigasyon (`permissions.spec.ts`)

- [x] Sadece `musteriler` iznine sahip kullanıcı: navbar'da yalnızca izinli linkler görünür
- [x] İzinsiz bir sayfaya (`/dashboard`) direkt URL ile gidiş engellenir
- [x] İzinli bir sayfaya (`/musteriler`) erişim sorunsuz çalışır
- [x] `is_admin` olmayan kullanıcı `/kullanicilar` ve `/fiyat-yonetimi`'ye erişemez

## 11. Genel / Edge Cases (`edge-cases.spec.ts`)

- [x] Türkçe karakterli isim (ç, ğ, ı, ö, ş, ü) girişi doğru şekilde render edilir
- [x] Ad/soyad alanına 101 karakterlik metin → backend "en fazla 100 karakter" hatası
- [x] TC alanına harf girilmeye çalışılınca input otomatik rakamla filtrelenir (client-side)
- [x] Telefon alanına 11 haneden fazla rakam girilemez (maxLength)
- [ ] OTOMATİKLEŞTİRİLMEDİ: Çoklu-sekme aynı-anda-giriş (race condition) senaryosu — Playwright'ta
      iki `BrowserContext` ile simüle edilebilir ama zamanlamaya (timing) bağımlı, kırılgan bir test
      olurdu; bu senaryo zaten backend seviyesinde (unique index + eşzamanlı istek testiyle)
      önceki bir turda doğrulandı ve `current_sec_weakness.md` madde 11'de belgelendi.
- [ ] OTOMATİKLEŞTİRİLMEDİ: Backend tamamen kapalıyken frontend'in "Sunucuya ulaşılamıyor" mesajı
      göstermesi — testin backend process'ini bilerek durdurup yeniden başlatması gerekir, bu da
      aynı anda çalışan diğer testleri/gerçek kullanımı kesintiye uğratır. `client.ts` içindeki
      `agHatasiMesaji()` fonksiyonu birim/manuel olarak zaten doğrulandı.

## Test Verisi Stratejisi

- Testler, üzerine bağımlı olmadan çalışabilmesi için **kendi test verisini kendisi oluşturur**
  (benzersiz TC/telefon/kullanıcı adı üretimi `Date.now()` tabanlı) ve mümkün olduğunca **kendi
  oluşturduğunu temizler** (oturum kapatma, kullanıcı silme).
- Dummy seed verisine (`reset-dummy.ps1`) veya mevcut DB durumuna (kaç müşteri var, hangi TC'ler
  geçerli) bağımlı **olmayan** assertion'lar tercih edilir — bu veri her ortamda/koşuda değişebilir.
  TC üretimi için checksum algoritmasını uygulayan bir yardımcı fonksiyon kullanılır
  (`utils/data.ts`), böylece testler her zaman geçerli bir TC ile çalışır.
- Admin girişi (`admin` / `.env` üzerinden okunan şifre) tüm testlerde ortak bir `login` fixture'ı
  ile yapılır; izin testleri için ise her seferinde admin tarafından geçici bir kullanıcı
  oluşturulup test sonunda silinir.
