import * as dotenv from "dotenv";
dotenv.config({ quiet: true });

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8080/api";

async function ping(url: string, label: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok && res.status !== 404) {
      throw new Error(`${label} beklenmeyen durum kodu döndü: ${res.status}`);
    }
  } catch (e) {
    throw new Error(
      `\n\n${label} adresine (${url}) ulaşılamadı.\n` +
        `Testleri çalıştırmadan önce uygulamanın ayakta olduğundan emin olun:\n` +
        `  PowerShell'de proje kök dizininden ".\\start.ps1" komutunu çalıştırın.\n` +
        `Ayrıntı: ${(e as Error).message}\n`
    );
  }
}

export default async function globalSetup() {
  await ping(`${API_BASE_URL}/health`, "Backend");
  await ping(BASE_URL, "Frontend");
}
