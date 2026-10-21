import { test, expect, type Page, type Locator } from "@playwright/test";
import { login as apiLogin, totpKodu } from "./api";

/**
 * Uygulamanın form alanlarında `<label>` ile `<input>` çoğu yerde HTML
 * olarak ilişkilendirilmemiş (for/id yok, sadece görsel olarak yan yana,
 * `<div className="field"><label>...</label><input .../></div>` deseninde).
 * Bu yüzden Playwright'ın `getByLabel()`'ı bu alanları bulamıyor.
 * fieldInput(), tam metin eşleşen bir <label>'ın hemen ardından gelen
 * <input>'u XPath ile bulur — "Ad" gibi kısa etiketlerin "Soyad" içinde
 * alt-dize olarak yanlışlıkla eşleşmesini de (case-insensitive substring
 * eşleşmesi yapan hasText'in aksine) engeller.
 */
export function fieldInput(scope: Page | Locator, exactLabel: string): Locator {
  const kacisli = exactLabel.replace(/"/g, '\\"');
  return scope.locator(`xpath=.//label[normalize-space(text())="${kacisli}"]/following-sibling::input[1]`);
}

/**
 * Gerçek giriş formunu kullanarak (kullanıcı adı/şifre yazıp "Giriş Yap"a
 * tıklayarak) oturum açar. Formun kendisini test eden `auth.spec.ts` ve
 * formun doğru çalıştığını en az bir kez uçtan uca doğrulamak isteyen
 * diğer testler için kullanılır.
 */
export async function loginViaUI(page: Page, username: string, password: string) {
  await page.goto("/login");
  await fieldInput(page, "Kullanıcı adı").fill(username);
  await fieldInput(page, "Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
}

/** loginViaUI + TOTP kod ekranını E2E_TOTP_SECRET'tan üretilen kodla geçer. */
export async function loginViaUIWithTotp(page: Page, username: string, password: string) {
  test.setTimeout(90_000); // TOTP replay koruması: önceki koşunun adımı geçene kadar ~30 sn beklenebilir
  await loginViaUI(page, username, password);
  await fieldInput(page, "Doğrulama Kodu").fill(await totpKodu(username));
  await page.getByRole("button", { name: "Giriş Yap" }).click();
}

/**
 * Backend'den doğrudan token alıp tarayıcının localStorage'ına, uygulamanın
 * kendi client.ts'inin kullandığı anahtarlarla yazar. Formu her testte
 * yeniden doldurmaktan çok daha hızlı ve login akışından bağımsız
 * (login formunu zaten `auth.spec.ts` ayrıca test ediyor); diğer tüm
 * spec dosyaları oturum açmak için bunu kullanır.
 */
export async function loginViaStorage(page: Page, username: string, password: string) {
  const res = await apiLogin(username, password);
  // localStorage bir sayfa context'i gerektirir; önce boş bir sayfaya gidilir.
  await page.goto("/login");
  await page.evaluate(
    ({ token, isAdmin, permissions, userId }) => {
      localStorage.setItem("parla_token", token);
      localStorage.setItem("parla_is_admin", String(isAdmin));
      localStorage.setItem("parla_permissions", JSON.stringify(permissions));
      localStorage.setItem("parla_user_id", String(userId));
    },
    { token: res.token, isAdmin: res.is_admin, permissions: res.permissions, userId: res.user_id }
  );
  return res;
}

export async function expectLoggedIn(page: Page) {
  await expect(page.getByRole("button", { name: "Çıkış Yap" })).toBeVisible();
}
