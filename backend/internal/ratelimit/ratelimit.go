// Package ratelimit basit, bağımlılıksız bir bellek-içi hız sınırlayıcı
// sağlar. Amaç DDoS koruması değil, /api/auth/login gibi uçlara karşı
// otomatik şifre deneme (brute-force) saldırılarını LAN ortamında dahi
// makul bir eşikte engellemektir.
package ratelimit

import (
	"sync"
	"time"
)

type bucket struct {
	deneme      int
	pencereBasi time.Time
}

// Limiter, anahtar (ör. istemci IP'si) başına belirli bir zaman penceresinde
// izin verilen maksimum deneme sayısını uygular.
type Limiter struct {
	mu      sync.Mutex
	limit   int
	pencere time.Duration
	kovalar map[string]*bucket
}

func New(limit int, pencere time.Duration) *Limiter {
	return &Limiter{
		limit:   limit,
		pencere: pencere,
		kovalar: make(map[string]*bucket),
	}
}

// Izinli, verilen anahtar için bu istekte hakkın olup olmadığını döner.
// Pencere süresi dolmuşsa sayaç sıfırlanır.
func (l *Limiter) Izinli(anahtar string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	// Uzun süre çalışan bir sunucuda, bir kez deneyip bir daha gelmeyen
	// IP'lerin kovaları haritada birikmesin diye süresi dolanlar temizlenir.
	if len(l.kovalar) > 1000 {
		for k, eski := range l.kovalar {
			if now.Sub(eski.pencereBasi) > l.pencere {
				delete(l.kovalar, k)
			}
		}
	}
	b, ok := l.kovalar[anahtar]
	if !ok || now.Sub(b.pencereBasi) > l.pencere {
		l.kovalar[anahtar] = &bucket{deneme: 1, pencereBasi: now}
		return true
	}
	if b.deneme >= l.limit {
		return false
	}
	b.deneme++
	return true
}

// Basarili, başarılı bir işlemden sonra o anahtarın deneme sayacını sıfırlar
// (ör. doğru şifreyle giriş yapıldığında, aynı IP'nin önceki başarısız
// denemeleri onu bir sonraki gerçek ihtiyaçta cezalandırmasın).
func (l *Limiter) Basarili(anahtar string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.kovalar, anahtar)
}
