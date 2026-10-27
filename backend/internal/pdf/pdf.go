// Paket pdf, uygulamanın tüm dışa aktarma (export) raporları için ortak
// bir .pdf üretici sağlar: logo, başlık/alt başlık, tarih, özet kutusu,
// bir tablo, toplam satırı ve her sayfada alt bilgi. Önceden ayrı ayrı
// .xlsx (excelize) ve .docx (elle yazılmış OOXML) olarak üretilen raporların
// hepsi artık bu paket üzerinden tek bir PDF biçiminde üretilir.
package pdf

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/go-pdf/fpdf"

	"parla-oyun-evi/backend/internal/assets"
)

// Report, bir dışa aktarma raporunun tüm içeriğini tanımlar.
type Report struct {
	LogoJPEG     []byte   // nil ise logo alanı boş bırakılır
	BaslikUst    string   // örn. "Parla Oyun Evi"
	BaslikAlt    string   // örn. "Gün Sonu Raporu"
	TarihEtiket  string   // sağ üstte gösterilecek tarih metni
	SummaryLines []string // "Etiket: Değer" (ilk ':' etiketi böler); ':' yoksa tüm satır değerdir
	Headers      []string
	Rows         [][]string
	SagaHizali   []bool   // opsiyonel: sütun i sağa hizalı mı (tutar/süre sütunları)
	ToplamSatiri []string // opsiyonel: Headers ile aynı uzunlukta, tablo sonunda kalın satır
	FooterText   string   // sayfa altında ortada gösterilecek not
}

const (
	fontFamily = "NotoSans"
	pageMargin = 10.0
	hucreYan   = 2.0   // hücre içi sol/sağ boşluk (mm)
	enFazlaSut = 100.0 // doğal sütun genişliği üst sınırı (mm)
)

// Marka renkleri (RGB).
var (
	murdum = [3]int{59, 42, 69}
	hardal = [3]int{233, 181, 68}
	krem   = [3]int{251, 243, 224}
	teal   = [3]int{62, 156, 158}
	zebra  = [3]int{253, 249, 238}
	cizgi  = [3]int{228, 216, 190}
)

func renk(c [3]int) (int, int, int) { return c[0], c[1], c[2] }

// sutunGenislikleri, doğal genişlikleri toplam genişliğe orantılı ölçekler
// (hem büyütür hem küçültür); toplam her zaman total'e eşittir.
func sutunGenislikleri(dogal []float64, total float64) []float64 {
	var sum float64
	for _, w := range dogal {
		sum += w
	}
	out := make([]float64, len(dogal))
	for i, w := range dogal {
		if sum > 0 {
			out[i] = w * total / sum
		} else {
			out[i] = total / float64(len(dogal))
		}
	}
	return out
}

// Build, verilen rapor içeriğine göre bir PDF dosyasının ham baytlarını üretir.
func Build(report Report) ([]byte, error) {
	headers := report.Headers
	colCount := len(headers)

	// 8+ sütunlu raporlar yatay, azlar dikey sayfada.
	orient := "P"
	if colCount >= 8 {
		orient = "L"
	}
	pdf := fpdf.New(orient, "mm", "A4", "")
	pdf.SetMargins(pageMargin, pageMargin, pageMargin)
	pdf.SetAutoPageBreak(true, pageMargin+8)
	pdf.SetCellMargin(hucreYan)
	pdf.AliasNbPages("{nb}")

	pdf.AddUTF8FontFromBytes(fontFamily, "", assets.NotoSansRegularTTF)
	pdf.AddUTF8FontFromBytes(fontFamily, "B", assets.NotoSansBoldTTF)
	pdf.AddUTF8FontFromBytes(fontFamily, "I", assets.NotoSansRegularTTF)

	pageW, pageH := pdf.GetPageSize()
	contentW := pageW - 2*pageMargin

	hiza := func(i int) string {
		if i < len(report.SagaHizali) && report.SagaHizali[i] {
			return "R"
		}
		return "L"
	}

	// Sütun genişlikleri: başlık (kalın 9) ve hücre (normal 8) metin
	// genişliklerinin en büyüğü + dolgu, sayfa genişliğine ölçeklenir.
	colWidths := make([]float64, colCount)
	if colCount > 0 {
		dogal := make([]float64, colCount)
		pdf.SetFont(fontFamily, "B", 9)
		for i, h := range headers {
			dogal[i] = pdf.GetStringWidth(h)
		}
		for i, c := range report.ToplamSatiri {
			if i < colCount {
				dogal[i] = max(dogal[i], pdf.GetStringWidth(c))
			}
		}
		pdf.SetFont(fontFamily, "", 8)
		for _, row := range report.Rows {
			for i, c := range row {
				if i < colCount {
					dogal[i] = max(dogal[i], pdf.GetStringWidth(c))
				}
			}
		}
		for i := range dogal {
			dogal[i] = min(dogal[i]+2*hucreYan, enFazlaSut)
		}
		colWidths = sutunGenislikleri(dogal, contentW)
	}

	// kisalt, hücreye sığmayan metni "…" ile keser (satır sarılmaz).
	kisalt := func(s string, w float64) string {
		w -= 2 * hucreYan
		if pdf.GetStringWidth(s) <= w {
			return s
		}
		r := []rune(s)
		for len(r) > 0 && pdf.GetStringWidth(string(r)+"…") > w {
			r = r[:len(r)-1]
		}
		return strings.TrimRight(string(r), " ") + "…"
	}

	drawHeaderBlock := func() {
		startY := pdf.GetY()
		textX := pageMargin
		if len(report.LogoJPEG) > 0 {
			opt := fpdf.ImageOptions{ImageType: "JPEG", ReadDpi: true}
			pdf.RegisterImageOptionsReader("logo", opt, bytes.NewReader(report.LogoJPEG))
			pdf.ImageOptions("logo", pageMargin, startY, 22, 22, false, opt, 0, "")
			textX += 26
		}

		pdf.SetXY(textX, startY+2)
		pdf.SetFont(fontFamily, "B", 20)
		pdf.SetTextColor(renk(murdum))
		pdf.CellFormat(contentW-(textX-pageMargin), 10, report.BaslikUst, "", 2, "L", false, 0, "")
		pdf.SetX(textX)
		pdf.SetFont(fontFamily, "B", 12)
		pdf.SetTextColor(renk(teal))
		pdf.CellFormat(contentW-(textX-pageMargin), 7, report.BaslikAlt, "", 0, "L", false, 0, "")

		pdf.SetXY(pageMargin, startY+2)
		pdf.SetFont(fontFamily, "", 10)
		pdf.SetTextColor(renk(murdum))
		pdf.CellFormat(contentW, 6, report.TarihEtiket, "", 0, "R", false, 0, "")

		pdf.SetDrawColor(renk(hardal))
		pdf.SetLineWidth(0.7)
		pdf.Line(pageMargin, startY+24, pageMargin+contentW, startY+24)
		pdf.SetLineWidth(0.2)
		pdf.SetY(startY + 28)
	}

	drawSummary := func() {
		if len(report.SummaryLines) == 0 {
			return
		}
		const satirH = 6.0
		cellW := (contentW - 6) / 2
		type oge struct {
			k, v string
			tam  bool // yarım sütuna sığmıyorsa tüm satırı kaplar
		}
		type yer struct {
			o     oge
			x     float64
			satir int
			w     float64
		}
		var yerler []yer
		satir, sutun := 0, 0
		for _, line := range report.SummaryLines {
			k, v, ok := strings.Cut(line, ":")
			if !ok {
				k, v = "", line
			} else {
				k += ":"
			}
			o := oge{k: k, v: strings.TrimSpace(v)}
			pdf.SetFont(fontFamily, "", 9)
			wk := pdf.GetStringWidth(o.k)
			pdf.SetFont(fontFamily, "B", 9)
			o.tam = wk+pdf.GetStringWidth(o.v)+4 > cellW
			if o.tam {
				if sutun == 1 {
					satir++
					sutun = 0
				}
				yerler = append(yerler, yer{o, pageMargin + 3, satir, contentW - 6})
				satir++
				continue
			}
			yerler = append(yerler, yer{o, pageMargin + 3 + float64(sutun)*cellW, satir, cellW})
			sutun++
			if sutun == 2 {
				sutun = 0
				satir++
			}
		}
		if sutun == 1 {
			satir++
		}

		y0 := pdf.GetY()
		h := float64(satir)*satirH + 4
		pdf.SetFillColor(renk(krem))
		pdf.SetDrawColor(renk(cizgi))
		pdf.RoundedRect(pageMargin, y0, contentW, h, 1.5, "1234", "FD")
		for _, p := range yerler {
			pdf.SetXY(p.x, y0+2+float64(p.satir)*satirH)
			pdf.SetFont(fontFamily, "", 9)
			pdf.SetTextColor(renk(murdum))
			wk := 0.0
			if p.o.k != "" {
				wk = pdf.GetStringWidth(p.o.k) + 1.5
				pdf.CellFormat(wk, satirH, p.o.k, "", 0, "L", false, 0, "")
			}
			pdf.SetFont(fontFamily, "B", 9)
			pdf.CellFormat(p.w-wk-2, satirH, kisalt(p.o.v, p.w-wk-2+2*hucreYan), "", 0, "L", false, 0, "")
		}
		pdf.SetY(y0 + h + 4)
	}

	drawTableHeader := func() {
		pdf.SetFont(fontFamily, "B", 9)
		pdf.SetFillColor(renk(murdum))
		pdf.SetDrawColor(renk(murdum))
		pdf.SetTextColor(255, 255, 255)
		for i, h := range headers {
			pdf.CellFormat(colWidths[i], 7, h, "1", 0, hiza(i), true, 0, "")
		}
		pdf.Ln(-1)
		pdf.SetTextColor(renk(murdum))
		pdf.SetFont(fontFamily, "", 8)
	}

	// homeMode=false: drawTableHeader zaten kendi Y konumunu doğru şekilde
	// ilerletiyor. true verilirse fpdf, header fonksiyonundan sonra imleci
	// sayfa başına sıfırlıyor (SetHomeXY) ve bu da ilk veri satırının
	// başlık satırının tam üzerine çakışmasına yol açıyordu.
	pdf.SetHeaderFuncMode(func() {
		if pdf.PageNo() > 1 && colCount > 0 {
			pdf.SetY(pageMargin)
			drawTableHeader()
		}
	}, false)

	pdf.SetFooterFunc(func() {
		pdf.SetY(-14)
		pdf.SetDrawColor(renk(hardal))
		pdf.Line(pageMargin, pdf.GetY(), pageMargin+contentW, pdf.GetY())
		pdf.SetFont(fontFamily, "", 8)
		pdf.SetTextColor(renk(murdum))
		pdf.CellFormat(contentW/3, 8, report.BaslikUst+" · "+report.BaslikAlt, "", 0, "L", false, 0, "")
		pdf.SetFont(fontFamily, "I", 8)
		pdf.CellFormat(contentW/3, 8, report.FooterText, "", 0, "C", false, 0, "")
		pdf.SetFont(fontFamily, "", 8)
		pdf.CellFormat(contentW/3, 8, fmt.Sprintf("Sayfa %d / {nb}", pdf.PageNo()), "", 0, "R", false, 0, "")
	})

	pdf.AddPage()
	drawHeaderBlock()
	drawSummary()

	if colCount > 0 {
		const satirH = 6.5
		drawTableHeader()
		pdf.SetDrawColor(renk(cizgi))
		satirCiz := func(row []string, bold bool, dolgu [3]int) {
			if pdf.GetY()+satirH > pageH-pageMargin-8 {
				pdf.AddPage()
				pdf.SetDrawColor(renk(cizgi))
			}
			if bold {
				pdf.SetFont(fontFamily, "B", 8.5)
			} else {
				pdf.SetFont(fontFamily, "", 8)
			}
			pdf.SetFillColor(renk(dolgu))
			pdf.SetTextColor(renk(murdum))
			for i := 0; i < colCount; i++ {
				cell := ""
				if i < len(row) {
					cell = row[i]
				}
				pdf.CellFormat(colWidths[i], satirH, kisalt(cell, colWidths[i]), "B", 0, hiza(i), true, 0, "")
			}
			pdf.Ln(-1)
		}
		for n, row := range report.Rows {
			dolgu := [3]int{255, 255, 255}
			if n%2 == 1 {
				dolgu = zebra
			}
			satirCiz(row, false, dolgu)
		}
		if len(report.ToplamSatiri) > 0 {
			pdf.SetDrawColor(renk(murdum))
			pdf.SetLineWidth(0.5)
			pdf.Line(pageMargin, pdf.GetY(), pageMargin+contentW, pdf.GetY())
			pdf.SetLineWidth(0.2)
			pdf.SetDrawColor(renk(cizgi))
			satirCiz(report.ToplamSatiri, true, krem)
		}
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, fmt.Errorf("pdf üretilemedi: %w", err)
	}
	return buf.Bytes(), nil
}
