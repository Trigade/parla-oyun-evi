package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const totpPeriodSeconds = 30

var base32Encoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// GenerateTOTPSecret rastgele bir TOTP sırrı üretir (160 bit, Base32 kodlu,
// Google Authenticator ve benzeri uygulamalarla uyumlu).
func GenerateTOTPSecret() (string, error) {
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base32Encoding.EncodeToString(raw), nil
}

// TOTPProvisioningURI, kimlik doğrulayıcı uygulamanın QR kod olarak okuyacağı
// otpauth:// URI'sini üretir.
func TOTPProvisioningURI(issuer, accountName, secret string) string {
	label := url.PathEscape(issuer) + ":" + url.PathEscape(accountName)
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", "6")
	q.Set("period", fmt.Sprintf("%d", totpPeriodSeconds))
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// totpCodeAt, RFC 6238'e göre verilen zaman penceresi (counter) için 6
// haneli TOTP kodunu hesaplar.
func totpCodeAt(secret string, counter uint64) (string, error) {
	key, err := base32Encoding.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", err
	}
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(buf)
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	code := (uint32(sum[offset]&0x7f) << 24) |
		(uint32(sum[offset+1]) << 16) |
		(uint32(sum[offset+2]) << 8) |
		uint32(sum[offset+3])
	code %= 1000000
	return fmt.Sprintf("%06d", code), nil
}

// VerifyTOTPCode girilen 6 haneli kodu, saat kaymalarını tolere etmek için
// şu anki zaman penceresi ile bir önceki/sonraki pencereye karşı doğrular.
func VerifyTOTPCode(secret, code string) bool {
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return false
	}
	counter := uint64(time.Now().Unix() / totpPeriodSeconds)
	for _, delta := range [3]int64{0, -1, 1} {
		c := counter
		if delta < 0 {
			c -= uint64(-delta)
		} else {
			c += uint64(delta)
		}
		expected, err := totpCodeAt(secret, c)
		if err == nil && hmac.Equal([]byte(expected), []byte(code)) {
			return true
		}
	}
	return false
}
