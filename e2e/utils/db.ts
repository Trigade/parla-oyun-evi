import { execFileSync } from "child_process";

/**
 * Yalnızca testin kendi ürettiği kayıtlar için doğrudan DB müdahalesi (docker exec psql).
 * Gerçek zamanı beklemeden süre/geçerlilik senaryolarını kurmak içindir.
 */
export function psql(sql: string): string {
  return execFileSync("docker", ["exec", "parla-oyun-evi-db", "psql", "-U", "parla", "-d", "parla_oyun_evi", "-t", "-A", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

/** Test oturumunun giriş zamanını `dakika` kadar geriye çeker (zaman yolculuğu). */
export function oturumGirisiniGeriCek(sessionId: number, dakika: number) {
  if (!Number.isInteger(sessionId) || !Number.isInteger(dakika)) throw new Error("geçersiz parametre");
  psql(`UPDATE sessions SET giris_zamani = now() - interval '${dakika} minutes' WHERE id = ${sessionId}`);
}

/**
 * Testin ürettiği müşterileri (ve bunlara ait oturum/paket satırlarını) kalıcı siler.
 * Yalnızca verilen id'lerle çalışır — ad kalıbıyla toplu silme yapılmaz, gerçek veriye dokunmaz.
 * afterEach/afterAll içinde çağrılır; test başarısız olsa da temizlik yapılır.
 */
export function testMusterileriniSil(ids: number[]) {
  if (ids.length === 0) return;
  if (!ids.every((id) => Number.isInteger(id) && id > 0)) throw new Error("geçersiz müşteri id");
  const liste = ids.join(",");
  psql(`DELETE FROM sessions WHERE customer_id IN (${liste})`);
  psql(`DELETE FROM customer_packages WHERE customer_id IN (${liste})`);
  psql(`DELETE FROM customers WHERE id IN (${liste})`);
}
