# Parla Oyun Evi — E2E Testleri (Playwright)

Bu klasör, ana uygulamadan (backend/frontend) bağımsız, ayrı bir Playwright
projesidir. Test edilecek use case/edge case listesi için [TEST_PLAN.md](./TEST_PLAN.md)
dosyasına bakın.

## Kurulum

```bash
cd e2e
npm install
npx playwright install chromium
cp .env.example .env   # gerekirse değerleri düzenleyin
```

## Çalıştırmadan önce

Uygulamanın ayakta olması gerekir (bu proje backend/frontend'i kendi başına
başlatmaz — canlı/paylaşımlı bir örneğe karşı test eder):

```bash
cd ..
.\start.ps1
```

## Testleri çalıştırma

```bash
npm test              # tüm testler, headless
npm run test:headed   # tarayıcıyı görerek
npm run test:ui       # Playwright'ın interaktif UI modu
npm run report        # son çalıştırmanın HTML raporunu açar
```

Tek bir dosya/test çalıştırmak için:

```bash
npx playwright test tests/kasa-ekrani.spec.ts
npx playwright test -g "Nakit Ödendi"
```

## Önemli tasarım kararları

- **Paylaşımlı canlı veritabanına karşı çalışır.** Testler kendi ürettikleri
  benzersiz TC/telefon/kullanıcı adlarıyla kendi test verilerini oluşturur ve
  (mümkün olduğunca) test sonunda temizler; mevcut gerçek müşteri/kullanıcı
  verisine dokunmaz.
- **Yıkıcı senaryolar varsayılan olarak kapalıdır.** Gerçek iş gününü
  sonlandıran (`Gün Sonu Yap`) ve canlı dakika ücretini değiştiren (`Fiyat
  Yönetimi`) testler, paylaşımlı ortamı bozabileceğinden yalnızca
  `RUN_DESTRUCTIVE_TESTS=1` ortam değişkeni ayarlandığında çalışır — ve fiyat
  testi orijinal değeri test sonunda geri yükler.
- **Testler sıralı çalışır** (`workers: 1`, `fullyParallel: false`) — aynı anda
  tek bir paylaşımlı backend/DB kullanıldığından, paralel çalıştırma yarış
  durumlarına (ör. aynı anda iki testin günü açmaya çalışması) yol açabilir.
- Otomatikleştirilmeyen senaryolar (`TEST_PLAN.md`'de işaretli) ya kırılgan/
  zamanlamaya bağımlı testler üretir ya da başka bir seviyede (backend
  testleri, önceki pentest turu) zaten doğrulanmıştır; gerekçeleri ilgili
  maddenin yanında belgelenmiştir.
