// Paket pdf, uygulamanın tüm dışa aktarma (export) raporları için ortak
// bir .pdf üretici sağlar: logo, başlık/alt başlık, tarih, özet satırları,
// bir tablo ve sayfa altında sabit bir not. Önceden ayrı ayrı .xlsx
// (excelize) ve .docx (elle yazılmış OOXML) olarak üretilen raporların
// hepsi artık bu paket üzerinden tek bir PDF biçiminde üretilir.
package pdf

import (
	"bytes"
	"fmt"

	"github.com/go-pdf/fpdf"

	"parla-oyun-evi/backend/internal/assets"
)

// Report, bir dışa aktarma raporunun tüm içeriğini tanımlar.
type Report struct {
	LogoJPEG     []byte // nil ise logo alanı boş bırakılır
	BaslikUst    string // örn. "Parla Oyun Evi"
	BaslikAlt    string // örn. "Gün Sonu Raporu"
	TarihEtiket  string // sağ üstte gösterilecek tarih metni
	SummaryLines []string
	Headers      []string
	Rows         [][]string
	FooterText   string // sayfa altında gösterilecek not
}

const (
	fontFamily = "NotoSans"
	pageMargin = 10.0
)

// Build, verilen rapor içeriğine göre bir PDF dosyasının ham baytlarını üretir.
func Build(report Report) ([]byte, error) {
	pdf := fpdf.New("L", "mm", "A4", "")
	pdf.SetMargins(pageMargin, pageMargin, pageMargin)
	pdf.SetAutoPageBreak(true, pageMargin+8)

	pdf.AddUTF8FontFromBytes(fontFamily, "", assets.NotoSansRegularTTF)
	pdf.AddUTF8FontFromBytes(fontFamily, "B", assets.NotoSansBoldTTF)
	pdf.AddUTF8FontFromBytes(fontFamily, "I", assets.NotoSansRegularTTF)

	pageW, _ := pdf.GetPageSize()
	contentW := pageW - 2*pageMargin

	headers := report.Headers
	colCount := len(headers)
	colWidths := make([]float64, colCount)
	if colCount > 0 {
		for i := range colWidths {
			colWidths[i] = contentW / float64(colCount)
		}
	}

	drawHeaderBlock := func() {
		startY := pdf.GetY()
		if len(report.LogoJPEG) > 0 {
			opt := fpdf.ImageOptions{ImageType: "JPEG", ReadDpi: true}
			pdf.RegisterImageOptionsReader("logo", opt, bytes.NewReader(report.LogoJPEG))
			pdf.ImageOptions("logo", pageMargin, startY, 18, 18, false, opt, 0, "")
		}

		pdf.SetXY(pageMargin, startY)
		pdf.SetFont(fontFamily, "B", 16)
		pdf.CellFormat(contentW, 8, report.BaslikUst, "", 2, "C", false, 0, "")
		pdf.SetX(pageMargin)
		pdf.SetFont(fontFamily, "B", 12)
		pdf.CellFormat(contentW, 7, report.BaslikAlt, "", 2, "C", false, 0, "")

		pdf.SetXY(pageMargin, startY)
		pdf.SetFont(fontFamily, "", 10)
		pdf.CellFormat(contentW, 6, report.TarihEtiket, "", 0, "R", false, 0, "")

		pdf.SetY(startY + 20)
	}

	drawTableHeader := func() {
		pdf.SetFont(fontFamily, "B", 9)
		pdf.SetFillColor(230, 230, 230)
		for i, h := range headers {
			pdf.CellFormat(colWidths[i], 7, h, "1", 0, "C", true, 0, "")
		}
		pdf.Ln(-1)
		pdf.SetFont(fontFamily, "", 8)
	}

	// homeMode=false: drawTableHeader zaten kendi Y konumunu doğru şekilde
	// ilerletiyor. true verilirse fpdf, header fonksiyonundan sonra imleci
	// sayfa başına sıfırlıyor (SetHomeXY) ve bu da ilk veri satırının
	// başlık satırının tam üzerine çakışmasına yol açıyordu.
	pdf.SetHeaderFuncMode(func() {
		if pdf.PageNo() > 1 {
			pdf.SetY(pageMargin)
			drawTableHeader()
		}
	}, false)

	if report.FooterText != "" {
		pdf.SetFooterFunc(func() {
			pdf.SetY(-15)
			pdf.SetFont(fontFamily, "I", 8)
			pdf.CellFormat(contentW, 8, report.FooterText, "", 0, "L", false, 0, "")
		})
	}

	pdf.AddPage()
	drawHeaderBlock()

	pdf.SetFont(fontFamily, "B", 10)
	for _, line := range report.SummaryLines {
		pdf.SetX(pageMargin)
		pdf.CellFormat(contentW, 6, line, "", 2, "L", false, 0, "")
	}
	pdf.Ln(2)

	if colCount > 0 {
		drawTableHeader()
		for _, row := range report.Rows {
			for i, cell := range row {
				if i >= colCount {
					break
				}
				pdf.CellFormat(colWidths[i], 6.5, cell, "1", 0, "L", false, 0, "")
			}
			pdf.Ln(-1)
		}
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, fmt.Errorf("pdf üretilemedi: %w", err)
	}
	return buf.Bytes(), nil
}
