package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"parla-oyun-evi/backend/internal/models"
)

// pgUniqueViolation, hatanın Postgres "unique_violation" (23505) olup
// olmadığını kontrol eder — eşzamanlı isteklerin veritabanı seviyesindeki
// tekillik kısıtlarına (ör. bir müşterinin tek açık oturumu) çarpıp
// çarpmadığını ayırt etmek için kullanılır.
func pgUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// normalizeTR, Türkçe'ye özgü büyük/küçük harf katlamasını (İ/i, I/ı, Ç/Ğ/Ö/Ş/Ü)
// veritabanı locale'inden bağımsız şekilde uygular. Postgres konteynerinin
// varsayılan "C" locale'i sadece ASCII harfleri katladığından, ILIKE ile
// yapılan aramalarda Türkçe karakterler büyük/küçük harf duyarlı kalıp
// eşleşmeyi kaçırabiliyordu; bu nedenle arama filtrelemesi Go tarafında yapılır.
var turkishFoldReplacer = strings.NewReplacer(
	"İ", "i", "I", "ı",
	"Ç", "ç", "Ğ", "ğ", "Ö", "ö", "Ş", "ş", "Ü", "ü",
)

func normalizeTR(s string) string {
	return strings.ToLower(turkishFoldReplacer.Replace(s))
}

// isValidTCKimlikNo: tam 11 haneli olmalı ve ilk 10 hanenin toplamının birler
// basamağı 11. haneye eşit olmalıdır.
func isValidTCKimlikNo(tc string) bool {
	if len(tc) != 11 {
		return false
	}
	toplam := 0
	for i := 0; i < 10; i++ {
		if tc[i] < '0' || tc[i] > '9' {
			return false
		}
		toplam += int(tc[i] - '0')
	}
	if tc[10] < '0' || tc[10] > '9' {
		return false
	}
	return toplam%10 == int(tc[10]-'0')
}

// isValidTelefon: 10 ya da 11 haneli (başında 0 olsun olmasın) bir telefon
// numarası olmalıdır. Ayraç/boşluk kabul edilmez; frontend gönderirken temizler.
func isValidTelefon(tel string) bool {
	if len(tel) != 10 && len(tel) != 11 {
		return false
	}
	for i := 0; i < len(tel); i++ {
		if tel[i] < '0' || tel[i] > '9' {
			return false
		}
	}
	return true
}

// adSoyadUzunlugu100 dahilindeki alanlar için üst sınır kontrolü yapar;
// sınırsız uzunluktaki isim alanları depolama şişmesine ve üretilen
// Excel/Word raporlarının aşırı büyümesine yol açabilir.
const maksAdSoyadUzunlugu = 100

func adSoyadGecerliMi(s string) bool {
	return len(s) > 0 && len(s) <= maksAdSoyadUzunlugu
}

type startSessionRequest struct {
	TCKimlikNo       string `json:"tc_kimlik_no"`
	Ad               string `json:"ad"`
	Soyad            string `json:"soyad"`
	Telefon          string `json:"telefon"`
	VeliTelefon      string `json:"veli_telefon"`
	SureSecimiDakika *int64 `json:"sure_secimi_dakika"` // opsiyonel: belirtilmezse kalış süresi çıkışta hesaplanır
}

// LookupCustomerByTC verilen TC kimlik no'ya sahip bir müşteri kaydı olup
// olmadığını kontrol eder. Kasa ekranında girişten önce "kayıt var mı?"
// sorgusu için kullanılır; herhangi bir kimlik doğrulanmış kullanıcı erişebilir.
func (a *API) LookupCustomerByTC(w http.ResponseWriter, r *http.Request) {
	tc := chi.URLParam(r, "tc")
	var customer models.Customer
	err := a.DB.QueryRow(r.Context(),
		`SELECT id, tc_kimlik_no, ad, soyad, telefon, veli_telefon, created_at FROM customers WHERE tc_kimlik_no = $1 AND deleted_at IS NULL`,
		tc,
	).Scan(&customer.ID, &customer.TCKimlikNo, &customer.Ad, &customer.Soyad, &customer.Telefon, &customer.VeliTelefon, &customer.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"bulundu": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"bulundu": true, "musteri": customer})
}

// LookupCustomerByPhone verilen telefon numarasına sahip bir müşteri kaydı
// olup olmadığını kontrol eder. TC kimlik no sorgusuyla aynı mantıkla,
// kayıttan önce "bu numara zaten kayıtlı mı?" kontrolü için kullanılır.
func (a *API) LookupCustomerByPhone(w http.ResponseWriter, r *http.Request) {
	tel := chi.URLParam(r, "telefon")
	var customer models.Customer
	err := a.DB.QueryRow(r.Context(),
		`SELECT id, tc_kimlik_no, ad, soyad, telefon, veli_telefon, created_at FROM customers WHERE telefon = $1 AND deleted_at IS NULL`,
		tel,
	).Scan(&customer.ID, &customer.TCKimlikNo, &customer.Ad, &customer.Soyad, &customer.Telefon, &customer.VeliTelefon, &customer.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"bulundu": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"bulundu": true, "musteri": customer})
}

type createCustomerRequest struct {
	TCKimlikNo  string `json:"tc_kimlik_no"`
	Ad          string `json:"ad"`
	Soyad       string `json:"soyad"`
	Telefon     string `json:"telefon"`
	VeliTelefon string `json:"veli_telefon"`
}

// CreateCustomer, Müşteriler ekranından oturum açmadan yeni müşteri kaydı
// oluşturur (kasada sıra beklemeden önceden kayıt almak için). Doğrulamalar
// StartSession ile aynıdır; gün başı şartı aranmaz ve oturum başlatılmaz.
// Daha önce silinmiş (deleted_at dolu) bir TC kimlik no yeniden kaydedilirse
// eski kayıt güncel bilgilerle geri getirilir — geçmiş oturumları korunur.
func (a *API) CreateCustomer(w http.ResponseWriter, r *http.Request) {
	var req createCustomerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	if req.TCKimlikNo == "" || req.Ad == "" || req.Soyad == "" || req.Telefon == "" {
		writeError(w, http.StatusBadRequest, "TC kimlik no, ad, soyad ve telefon alanları zorunludur.")
		return
	}
	if !isValidTCKimlikNo(req.TCKimlikNo) {
		writeError(w, http.StatusBadRequest, "geçersiz TC kimlik no")
		return
	}
	if !adSoyadGecerliMi(req.Ad) || !adSoyadGecerliMi(req.Soyad) {
		writeError(w, http.StatusBadRequest, "ad/soyad boş olamaz ve en fazla 100 karakter olabilir")
		return
	}
	if !isValidTelefon(req.Telefon) {
		writeError(w, http.StatusBadRequest, "geçersiz telefon numarası")
		return
	}
	if req.VeliTelefon != "" && !isValidTelefon(req.VeliTelefon) {
		writeError(w, http.StatusBadRequest, "geçersiz veli telefon numarası")
		return
	}

	ctx := r.Context()

	var mevcutID int64
	if err := a.DB.QueryRow(ctx,
		`SELECT id FROM customers WHERE tc_kimlik_no = $1 AND deleted_at IS NULL`, req.TCKimlikNo,
	).Scan(&mevcutID); err == nil {
		writeError(w, http.StatusConflict, "Bu TC kimlik no ile kayıtlı bir müşteri zaten var.")
		return
	}

	var telefonSahibiID int64
	if err := a.DB.QueryRow(ctx,
		`SELECT id FROM customers WHERE telefon = $1 AND tc_kimlik_no <> $2 AND deleted_at IS NULL`,
		req.Telefon, req.TCKimlikNo,
	).Scan(&telefonSahibiID); err == nil {
		writeError(w, http.StatusConflict, "bu telefon numarası başka bir müşteriye kayıtlı")
		return
	}

	var veliTelefon *string
	if req.VeliTelefon != "" {
		veliTelefon = &req.VeliTelefon
	}

	var customer models.Customer
	err := a.DB.QueryRow(ctx,
		`INSERT INTO customers (tc_kimlik_no, ad, soyad, telefon, veli_telefon) VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (tc_kimlik_no) DO UPDATE SET ad = EXCLUDED.ad, soyad = EXCLUDED.soyad,
			telefon = EXCLUDED.telefon, veli_telefon = EXCLUDED.veli_telefon, deleted_at = NULL
		 RETURNING id, tc_kimlik_no, ad, soyad, telefon, veli_telefon, created_at`,
		req.TCKimlikNo, req.Ad, req.Soyad, req.Telefon, veliTelefon,
	).Scan(&customer.ID, &customer.TCKimlikNo, &customer.Ad, &customer.Soyad, &customer.Telefon, &customer.VeliTelefon, &customer.CreatedAt)
	if err != nil {
		if pgUniqueViolation(err) {
			writeError(w, http.StatusConflict, "Bu TC kimlik no veya telefon numarası başka bir müşteriye kayıtlı.")
			return
		}
		writeServerError(w, http.StatusInternalServerError, "müşteri kaydedilemedi", err)
		return
	}

	writeJSON(w, http.StatusCreated, customer)
}

// StartSession: müşteri kaydı yoksa oluşturur, varsa mevcut kaydı bulur ve
// yeni bir açık oturum başlatır. Aynı müşterinin zaten açık bir oturumu varsa hata döner.
func (a *API) StartSession(w http.ResponseWriter, r *http.Request) {
	var req startSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	if req.TCKimlikNo == "" || req.Ad == "" || req.Soyad == "" || req.Telefon == "" {
		writeError(w, http.StatusBadRequest, "TC kimlik no, ad, soyad ve telefon alanları zorunludur.")
		return
	}
	if !isValidTCKimlikNo(req.TCKimlikNo) {
		writeError(w, http.StatusBadRequest, "geçersiz TC kimlik no")
		return
	}
	if !adSoyadGecerliMi(req.Ad) || !adSoyadGecerliMi(req.Soyad) {
		writeError(w, http.StatusBadRequest, "ad/soyad boş olamaz ve en fazla 100 karakter olabilir")
		return
	}
	if !isValidTelefon(req.Telefon) {
		writeError(w, http.StatusBadRequest, "geçersiz telefon numarası")
		return
	}
	if req.VeliTelefon != "" && !isValidTelefon(req.VeliTelefon) {
		writeError(w, http.StatusBadRequest, "geçersiz veli telefon numarası")
		return
	}
	if req.SureSecimiDakika != nil && *req.SureSecimiDakika <= 0 {
		writeError(w, http.StatusBadRequest, "süre seçimi 0'dan büyük olmalıdır")
		return
	}

	ctx := r.Context()

	var telefonSahibiID int64
	err := a.DB.QueryRow(ctx,
		`SELECT id FROM customers WHERE telefon = $1 AND tc_kimlik_no <> $2 AND deleted_at IS NULL`,
		req.Telefon, req.TCKimlikNo,
	).Scan(&telefonSahibiID)
	if err == nil {
		writeError(w, http.StatusConflict, "bu telefon numarası başka bir müşteriye kayıtlı")
		return
	}

	var gunID int64
	if err := a.DB.QueryRow(ctx,
		`SELECT id FROM business_days WHERE durum = 'acik' LIMIT 1`,
	).Scan(&gunID); err != nil {
		writeError(w, http.StatusConflict, "gün henüz başlatılmadı, önce 'Gün Başı' yapın")
		return
	}

	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem başlatılamadı, lütfen tekrar deneyin.")
		return
	}
	defer tx.Rollback(ctx)

	var veliTelefon *string
	if req.VeliTelefon != "" {
		veliTelefon = &req.VeliTelefon
	}

	var customer models.Customer
	err = tx.QueryRow(ctx,
		`INSERT INTO customers (tc_kimlik_no, ad, soyad, telefon, veli_telefon) VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (tc_kimlik_no) DO UPDATE SET ad = EXCLUDED.ad, soyad = EXCLUDED.soyad, telefon = EXCLUDED.telefon, veli_telefon = EXCLUDED.veli_telefon, deleted_at = NULL
		 RETURNING id, tc_kimlik_no, ad, soyad, telefon, veli_telefon, created_at`,
		req.TCKimlikNo, req.Ad, req.Soyad, req.Telefon, veliTelefon,
	).Scan(&customer.ID, &customer.TCKimlikNo, &customer.Ad, &customer.Soyad, &customer.Telefon, &customer.VeliTelefon, &customer.CreatedAt)
	if err != nil {
		if pgUniqueViolation(err) {
			// Silinmiş kaydı geri getirirken telefon başka aktif müşteriye verilmiş olabilir.
			writeError(w, http.StatusConflict, "Bu TC kimlik no veya telefon numarası başka bir müşteriye kayıtlı.")
			return
		}
		writeServerError(w, http.StatusInternalServerError, "müşteri kaydedilemedi", err)
		return
	}

	var existingOpenID int64
	err = tx.QueryRow(ctx,
		`SELECT id FROM sessions WHERE customer_id = $1 AND durum = 'acik' LIMIT 1`,
		customer.ID,
	).Scan(&existingOpenID)
	if err == nil {
		writeError(w, http.StatusConflict, "bu müşterinin zaten açık bir oturumu var")
		return
	}

	var session models.Session
	err = tx.QueryRow(ctx,
		`INSERT INTO sessions (customer_id, sure_secimi_dakika) VALUES ($1, $2)
		 RETURNING id, customer_id, giris_zamani, durum, manuel_kapatildi`,
		customer.ID, req.SureSecimiDakika,
	).Scan(&session.ID, &session.CustomerID, &session.GirisZamani, &session.Durum, &session.ManuelKapatildi)
	if err != nil {
		if pgUniqueViolation(err) {
			// idx_sessions_one_open_per_customer: iki eşzamanlı istek aynı
			// müşteri için oturum açmaya çalıştı, ikincisi DB tarafından reddedildi.
			writeError(w, http.StatusConflict, "bu müşterinin zaten açık bir oturumu var")
			return
		}
		writeServerError(w, http.StatusInternalServerError, "oturum oluşturulamadı", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"musteri": customer,
		"oturum":  session,
	})
}

type updateCustomerRequest struct {
	TCKimlikNo  string `json:"tc_kimlik_no"`
	Ad          string `json:"ad"`
	Soyad       string `json:"soyad"`
	Telefon     string `json:"telefon"`
	VeliTelefon string `json:"veli_telefon"`
}

// UpdateCustomer bir müşterinin ad, soyad, TC kimlik no ve telefon
// bilgilerini günceller. Müşteriler zamanla telefon değiştirebildiği için
// kasiyer/yönetici bu ekrandan kaydı düzeltebilir. TC kimlik no ve telefon,
// kayıt oluşturmadaki ile aynı kurallarla doğrulanır ve tekilliği korunur.
func (a *API) UpdateCustomer(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz müşteri numarası.")
		return
	}

	var req updateCustomerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	if req.TCKimlikNo == "" || req.Ad == "" || req.Soyad == "" || req.Telefon == "" {
		writeError(w, http.StatusBadRequest, "TC kimlik no, ad, soyad ve telefon alanları zorunludur.")
		return
	}
	if !isValidTCKimlikNo(req.TCKimlikNo) {
		writeError(w, http.StatusBadRequest, "geçersiz TC kimlik no")
		return
	}
	if !adSoyadGecerliMi(req.Ad) || !adSoyadGecerliMi(req.Soyad) {
		writeError(w, http.StatusBadRequest, "ad/soyad boş olamaz ve en fazla 100 karakter olabilir")
		return
	}
	if !isValidTelefon(req.Telefon) {
		writeError(w, http.StatusBadRequest, "geçersiz telefon numarası")
		return
	}
	if req.VeliTelefon != "" && !isValidTelefon(req.VeliTelefon) {
		writeError(w, http.StatusBadRequest, "geçersiz veli telefon numarası")
		return
	}

	ctx := r.Context()

	var cakisanID int64
	err = a.DB.QueryRow(ctx,
		`SELECT id FROM customers WHERE tc_kimlik_no = $1 AND id <> $2 AND deleted_at IS NULL`,
		req.TCKimlikNo, id,
	).Scan(&cakisanID)
	if err == nil {
		writeError(w, http.StatusConflict, "bu TC kimlik no başka bir müşteriye kayıtlı")
		return
	}

	err = a.DB.QueryRow(ctx,
		`SELECT id FROM customers WHERE telefon = $1 AND id <> $2 AND deleted_at IS NULL`,
		req.Telefon, id,
	).Scan(&cakisanID)
	if err == nil {
		writeError(w, http.StatusConflict, "bu telefon numarası başka bir müşteriye kayıtlı")
		return
	}

	var veliTelefon *string
	if req.VeliTelefon != "" {
		veliTelefon = &req.VeliTelefon
	}

	var customer models.Customer
	err = a.DB.QueryRow(ctx,
		`UPDATE customers SET tc_kimlik_no = $1, ad = $2, soyad = $3, telefon = $4, veli_telefon = $5
		 WHERE id = $6
		 RETURNING id, tc_kimlik_no, ad, soyad, telefon, veli_telefon, created_at`,
		req.TCKimlikNo, req.Ad, req.Soyad, req.Telefon, veliTelefon, id,
	).Scan(&customer.ID, &customer.TCKimlikNo, &customer.Ad, &customer.Soyad, &customer.Telefon, &customer.VeliTelefon, &customer.CreatedAt)
	if err != nil {
		if pgUniqueViolation(err) {
			writeError(w, http.StatusConflict, "Bu TC kimlik no veya telefon numarası başka bir müşteriye kayıtlı.")
			return
		}
		writeServerError(w, http.StatusInternalServerError, "müşteri güncellenemedi", err)
		return
	}

	writeJSON(w, http.StatusOK, customer)
}

// DeleteCustomer bir müşteriyi soft delete ile işaretler (kaydı fiziksel
// olarak silmez, geçmiş oturum/rapor bütünlüğü bozulmasın diye). Sadece
// yönetici erişebilir (bkz. router'daki RequireAdmin zinciri). Açık oturumu
// olan bir müşteri silinemez; önce oturumun kapatılması gerekir.
func (a *API) DeleteCustomer(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz müşteri numarası.")
		return
	}

	var acikOturumID int64
	err = a.DB.QueryRow(r.Context(),
		`SELECT id FROM sessions WHERE customer_id = $1 AND durum = 'acik'`, id,
	).Scan(&acikOturumID)
	if err == nil {
		writeError(w, http.StatusConflict, "açık oturumu olan bir müşteri silinemez")
		return
	}

	tag, err := a.DB.Exec(r.Context(),
		`UPDATE customers SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, id,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "müşteri silinemedi", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "müşteri bulunamadı")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"silindi": true})
}

type customerListItem struct {
	ID            int64   `json:"id"`
	TCKimlikNo    string  `json:"tc_kimlik_no"`
	Ad            string  `json:"ad"`
	Soyad         string  `json:"soyad"`
	Telefon       string  `json:"telefon"`
	VeliTelefon   *string `json:"veli_telefon,omitempty"`
	ToplamOturum  int64   `json:"toplam_oturum"`
	ToplamHarcama int64   `json:"toplam_harcama_kurus"`
	SonZiyaret    *string `json:"son_ziyaret,omitempty"`
	AcikOturumVar bool    `json:"acik_oturum_var"`
	AktifPaket    *string `json:"aktif_paket,omitempty"`
}

// ListCustomers tüm müşterileri, toplam ziyaret sayısı ve toplam harcaması
// ile birlikte döner. "q" parametresi verilirse ad, soyad veya TC kimlik
// no üzerinde arama yapar.
func (a *API) ListCustomers(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	qNormalized := normalizeTR(q)

	rows, err := a.DB.Query(r.Context(), `
		SELECT
			c.id, c.tc_kimlik_no, c.ad, c.soyad, c.telefon, c.veli_telefon,
			COUNT(s.id) FILTER (WHERE s.durum = 'kapali'),
			COALESCE(SUM(s.tahsil_tutar_kurus) FILTER (WHERE s.durum = 'kapali'), 0),
			MAX(s.cikis_zamani),
			-- Hiç oturumu olmayan müşteride BOOL_OR NULL döner (ör. Müşteriler
			-- ekranından oturum açmadan eklenen kayıt); bu durumda "içeride değil".
			COALESCE(BOOL_OR(s.durum = 'acik'), false),
			(
				SELECT cp.ad FROM customer_packages cp
				WHERE cp.customer_id = c.id AND cp.haftalik_gun IS NOT NULL
					AND cp.gecerlilik_bitis > now()
				ORDER BY cp.satin_alma_zamani DESC LIMIT 1
			)
		FROM customers c
		LEFT JOIN sessions s ON s.customer_id = c.id
		WHERE c.deleted_at IS NULL
		GROUP BY c.id
		ORDER BY c.ad, c.soyad`,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "müşteriler alınamadı", err)
		return
	}
	defer rows.Close()

	result := []customerListItem{}
	for rows.Next() {
		var item customerListItem
		var sonZiyaret *time.Time
		if err := rows.Scan(
			&item.ID, &item.TCKimlikNo, &item.Ad, &item.Soyad, &item.Telefon, &item.VeliTelefon,
			&item.ToplamOturum, &item.ToplamHarcama, &sonZiyaret, &item.AcikOturumVar, &item.AktifPaket,
		); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		if sonZiyaret != nil {
			s := sonZiyaret.Format("2006-01-02 15:04")
			item.SonZiyaret = &s
		}

		if qNormalized != "" {
			adSoyad := normalizeTR(item.Ad + " " + item.Soyad)
			eslesiyor := strings.Contains(adSoyad, qNormalized) || strings.Contains(item.TCKimlikNo, q) || strings.Contains(item.Telefon, q)
			if !eslesiyor {
				continue
			}
		}
		result = append(result, item)
	}
	writeJSON(w, http.StatusOK, result)
}

type customerSessionItem struct {
	ID                 int64   `json:"id"`
	GirisZamani        string  `json:"giris_zamani"`
	CikisZamani        *string `json:"cikis_zamani,omitempty"`
	Durum              string  `json:"durum"`
	ToplamDakika       *int64  `json:"toplam_dakika,omitempty"`
	OrijinalTutarKurus *int64  `json:"orijinal_tutar_kurus,omitempty"`
	TahsilTutarKurus   *int64  `json:"tahsil_tutar_kurus,omitempty"`
	OdemeTipi          *string `json:"odeme_tipi,omitempty"`
	ManuelKapatildi    bool    `json:"manuel_kapatildi"`
	PaketDusulenDakika int64   `json:"paketten_dusulen_dakika"`
}

// GetCustomerSessions bir müşterinin tüm geçmiş (ve varsa açık) oturumlarını
// en yeniden en eskiye doğru döner.
func (a *API) GetCustomerSessions(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz müşteri numarası.")
		return
	}

	rows, err := a.DB.Query(r.Context(), `
		SELECT id, giris_zamani, cikis_zamani, durum, toplam_dakika,
			orijinal_tutar_kurus, tahsil_tutar_kurus, odeme_tipi, manuel_kapatildi,
			paketten_dusulen_dakika
		FROM sessions
		WHERE customer_id = $1
		ORDER BY giris_zamani DESC`,
		id,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "geçmiş alınamadı", err)
		return
	}
	defer rows.Close()

	result := []customerSessionItem{}
	for rows.Next() {
		var item customerSessionItem
		var girisZamani time.Time
		var cikisZamani *time.Time
		if err := rows.Scan(
			&item.ID, &girisZamani, &cikisZamani, &item.Durum, &item.ToplamDakika,
			&item.OrijinalTutarKurus, &item.TahsilTutarKurus, &item.OdemeTipi, &item.ManuelKapatildi,
			&item.PaketDusulenDakika,
		); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		item.GirisZamani = girisZamani.Format("2006-01-02 15:04:05")
		if cikisZamani != nil {
			s := cikisZamani.Format("2006-01-02 15:04:05")
			item.CikisZamani = &s
		}
		result = append(result, item)
	}
	writeJSON(w, http.StatusOK, result)
}
