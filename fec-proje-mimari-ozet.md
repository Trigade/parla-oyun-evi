# Süre Bazlı Müşteri Takip ve Adisyon Sistemi — Proje ve Mimari Özeti

## 1. Proje Tanımı

Bu proje, oyun/eğlence merkezleri (FEC) gibi süreye dayalı ücretlendirme yapan işletmeler için geliştirilen; müşteri giriş-çıkış takibini, süreye bağlı otomatik ücret hesaplamasını, manuel ödeme kapatma işlemlerini ve işletme sahibine yönelik ciro analitiğini tek bir sistem üzerinden yöneten web tabanlı bir uygulamadır.

Sistemin temel amacı, kasadaki operasyonel işi (müşteri kaydı, süre takibi, ödeme kapatma) hızlı ve hatasız hale getirirken, işletme sahibine geçmişe dönük finansal görünürlük sağlamaktır.

## 2. Temel İşlevsel Akış

1. **Müşteri Girişi**: Müşteri geldiğinde TC kimlik no, ad ve soyad bilgisiyle sisteme kaydedilir. Daha önce kayıtlıysa mevcut kayıt bulunarak yeni bir oturum (giriş kaydı) açılır.
2. **Süre Takibi**: Giriş anı sistemde tutulur; müşteri içeride olduğu sürece kasa ekranında geçen süre canlı olarak izlenebilir.
3. **Çıkış ve Ücretlendirme**: Müşteri çıkış yaptığında çıkış saati kaydedilir, içeride geçirilen toplam dakika üzerinden önceden tanımlı fiyatlandırma kurallarına göre tutar otomatik hesaplanır.
4. **Ödeme Kapatma (Manuel)**: Kasa görevlisi tahsilatı fiziksel olarak (nakit veya kart okuyucu üzerinden, sisteme entegre olmadan) aldıktan sonra, ekrandan sadece ödeme tipini ("Nakit" / "Kredi Kartı") seçerek oturumu kapatır. Sistem bir ödeme API'siyle konuşmaz; sadece işlemi kayıt altına alır.
5. **Raporlama**: İşletme sahibi, günlük/haftalık/aylık veya özel tarih aralığı seçerek toplam ciroyu, oturum sayısını ve ödeme tipi dağılımını (nakit/kart oranı) bir dashboard üzerinden görüntüler.

## 3. Genel Mimari Yaklaşım

Sistem, klasik ve kanıtlanmış bir **3 katmanlı web mimarisi** üzerine kurulmuştur:

```
┌─────────────────────┐
│   Frontend (SPA)     │  ← Kasa ekranı + Yönetici dashboard'u
└──────────┬───────────┘
           │ REST API (JSON)
┌──────────▼───────────┐
│   Backend (API)       │  ← İş mantığı, hesaplama, doğrulama
└──────────┬───────────┘
           │ SQL
┌──────────▼───────────┐
│   Veritabanı           │  ← Müşteri, oturum, ödeme kayıtları
└───────────────────────┘
```

Bu ayrım, kasa ekranı ile yönetici dashboard'unun aynı backend üzerinden ama farklı arayüzlerle beslenmesine imkân tanır; ileride mobil bir uygulama ya da ikinci bir şube eklenmesi durumunda da backend değişmeden yeni istemciler bağlanabilir.

### 3.1 Backend Katmanı

Backend, tüm iş mantığının (süre hesaplama, oturum durumu yönetimi, raporlama sorguları) merkezileştiği katmandır. REST API prensipleriyle tasarlanır; her kaynak (müşteri, oturum, ödeme, rapor) kendi uç noktalarına sahiptir. Performanslı, az kaynak tüketen ve deploy'u basit bir dil/çatı tercih edilmesi, özellikle tek sunucuda çalışacak bir FEC sistemi için maliyet ve bakım avantajı sağlar.

### 3.2 Veritabanı Katmanı

Veriler doğası gereği ilişkiseldir: bir müşterinin birden çok oturumu, her oturumun bir ödeme kaydı vardır. Bu nedenle ilişkisel bir veritabanı tercih edilir. Zaman damgalı alanlar (giriş/çıkış saatleri) ve parasal tutarlar için hassas veri tipleri kullanılması, hem süre hesaplamalarının hem de raporlamanın doğruluğu açısından kritiktir. Raporlama ihtiyacının (tarih aralığına göre gruplama, ödeme tipi dağılımı) büyük kısmı, veritabanı seviyesindeki sorgularla karşılanacak şekilde tasarlanır; bu da backend'de ayrı bir analitik motoru yazma ihtiyacını ortadan kaldırır.

### 3.3 Frontend Katmanı

Frontend iki farklı kullanım senaryosuna hizmet eder:

- **Kasa Ekranı**: Operasyonel, hızlı, büyük butonlu, canlı süre gösteren bir arayüz. Kullanıcı hatasını en aza indirecek sade bir tasarım önceliklidir.
- **Yönetici Dashboard'u**: Filtrelenebilir tarih aralıkları, ciro grafikleri ve ödeme tipi dağılım görselleştirmeleri içeren, analiz odaklı bir arayüz.

Her iki arayüz de tek bir tek-sayfa uygulaması (SPA) içinde, farklı rotalar/yetkilendirme seviyeleri olarak organize edilir. Canlı süre gösterimi gibi sürekli güncellenen veriler, sunucuya gereksiz yük bindirmeden istemci tarafında hesaplanır; sunucudan yalnızca periyodik doğrulama ve kesin (çıkışta hesaplanan) veriler alınır.

## 4. Teknik Kararlar (Netleştirilmiş)

### 4.1 Teknoloji Yığını

- **Backend**: Go — performans, düşük kaynak tüketimi ve tek binary olarak basit deploy avantajı.
- **Veritabanı**: PostgreSQL — ilişkisel yapı, zaman damgası ve hassas sayısal tip desteği (`NUMERIC`).
- **Frontend**: React + TypeScript + Vite — kasa ekranı ve yönetici dashboard'u aynı SPA içinde farklı rotalar olarak.

### 4.2 Kimlik Doğrulama / Yetkilendirme

- İki rol: `kasiyer` (giriş/çıkış/ödeme kapatma) ve `yönetici` (+ raporlama, gün sonu işlemleri, düzeltmeler).
- Rol bazlı endpoint yetkilendirmesi backend tarafında uygulanır.

### 4.3 Fiyatlandırma ve Hesaplama Kuralı

- Tutar, geçen süre **tam dakika** üzerinden hesaplanır (yuvarlama yok, ham hesap).
- Ödeme ekranında bir **"Yuvarla" butonu** bulunur; kasiyer isterse tutarı aşağı yuvarlayabilir (ör. 123 → 120). Yuvarlama opsiyonel ve manuel bir kasiyer eylemidir, otomatik uygulanmaz.
- Veritabanında iki ayrı alan tutulur: **orijinal hesaplanan tutar** (ham, tam dakika üzerinden) ve **tahsil edilen (yuvarlanmış) tutar**. Ödeme kaydına (tahsilat/raporlama) yuvarlanmış tutar; oturum kaydına ise orijinal tutar da ayrıca yazılır. Bu sayede raporlama hem gerçekte tahsil edileni hem de hesaplama doğruluğunu (yuvarlamadan kaynaklı fark) ayrı ayrı gösterebilir.
- Tüm parasal alanlarda `FLOAT` kullanılmaz; veritabanında `NUMERIC`/`DECIMAL`, backend (Go) tarafında da tam sayı (kuruş bazlı `int64` veya `decimal` paketi) ile çalışılır — yuvarlama hatası birikimi engellenir.

### 4.4 Gün Sonu ve Açık Oturum Yönetimi

- Yönetici panelinde bir **"Gün Sonu"** butonu bulunur.
- Gün sonu tetiklendiğinde sistem açık (çıkışı yapılmamış) oturumları tespit eder; bu oturumlar **manuel olarak elle kapatılabilir** (yönetici çıkış saatini ve ödeme durumunu girer).
- Bu işlem audit amaçlı kayıt altına alınır (kim, ne zaman, hangi oturumu elle kapattı).

### 4.5 Yedekleme

- Veriler sunucuda (PostgreSQL) tutulur, ana veri kaynağı budur.
- Buna ek olarak, istenildiğinde **manuel Excel export** özelliği sağlanır: kullanıcı tarih aralığı seçerek o aralıktaki oturum/ödeme kayıtlarını `.xlsx` olarak indirebilir. Bu, düzenli otomatik yedeklemenin yerine değil, ek bir manuel dışa aktarma/rapor imkânı olarak konumlanır.

## 5. Genişleyebilirlik Notu

Mimari, başlangıçta tek şube/tek kasa senaryosunu hedefleyecek şekilde sade tutulur. Ancak katmanlar arasındaki net ayrım (REST API üzerinden haberleşme, ilişkisel veri modeli) sayesinde ileride şu genişlemeler mevcut yapıyı bozmadan eklenebilir:

- Çoklu şube desteği
- Gerçek zamanlı çoklu kasa senkronizasyonu (ör. WebSocket katmanı)
- Fiziksel POS/banka API entegrasyonu
- Mobil uygulama veya farklı istemci türleri

## 6. Özet

Sistem; operasyonel basitliği (hızlı müşteri girişi/çıkışı, canlı süre takibi, manuel ödeme kapatma) ile yönetimsel görünürlüğü (esnek, tarih bazlı ciro ve ödeme analitiği) tek bir mimari altında birleştirir. İlişkisel veri modeli ve REST tabanlı katmanlı yapı, hem mevcut gereksinimleri sade bir şekilde karşılar hem de işletmenin büyümesi durumunda sistemin adım adım genişletilmesine uygun bir temel sunar.
