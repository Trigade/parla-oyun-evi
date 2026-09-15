// Paket assets, uygulama içinde kullanılan statik dosyaları (logo vb.)
// binary'e gömer.
package assets

import _ "embed"

//go:embed logo.jpeg
var LogoJPEG []byte

// PDF raporlarında Türkçe karakterlerin (ç, ğ, ı, ö, ş, ü) doğru
// gösterilmesi için Noto Sans TrueType fontu gömülür — PDF'nin
// varsayılan çekirdek fontları (Helvetica/Arial) bu karakterleri
// desteklemez.
//
//go:embed NotoSans-Regular.ttf
var NotoSansRegularTTF []byte

//go:embed NotoSans-Bold.ttf
var NotoSansBoldTTF []byte
