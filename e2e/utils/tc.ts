/**
 * Backend'deki TC kimlik no doğrulama kuralıyla (tam 11 hane; ilk 10
 * hanenin toplamının birler basamağı 11. haneye eşit) birebir uyumlu,
 * her çağrıda benzersiz (zaman damgası + rastgele tuz tabanlı) geçerli
 * bir test TC'si üretir. Böylece testler dummy seed verisindeki
 * (checksum'ı geçersiz) TC'lere bağımlı kalmaz.
 */
export function genValidTC(): string {
  const salt = Math.floor(Math.random() * 1_000_000);
  const raw = String(Date.now() * 1000 + salt);
  let base = raw.slice(-10);
  while (base.length < 10) base = "9" + base;
  const toplam = base
    .split("")
    .reduce((acc, d) => acc + Number(d), 0);
  const kontrolHanesi = toplam % 10;
  return base + kontrolHanesi;
}

/**
 * Backend kuralına (10 ya da 11 hane) uyan, her çağrıda benzersiz bir
 * test telefon numarası üretir (05 + 9 benzersiz hane).
 */
export function genValidPhone(): string {
  const salt = Math.floor(Math.random() * 1_000_000);
  const raw = String(Date.now() * 1000 + salt);
  let base = raw.slice(-9);
  while (base.length < 9) base = "9" + base;
  return "05" + base;
}

export function genUsername(prefix = "e2e"): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}
