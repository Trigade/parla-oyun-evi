import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";

dotenv.config({ quiet: true });

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // paylaşımlı, tek bir backend/DB üzerinde çalışılıyor — testler arasında yarış durumunu önlemek için sıralı
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    headless: process.env.HEADLESS === "1", // varsayılan: tarayıcı görünür (headed); HEADLESS=1 ile headless
    launchOptions: { slowMo: 250 }, // adımların gözle takip edilebilmesi için hafif yavaşlatma
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined }, // örn. PW_CHANNEL=msedge
    },
  ],

  // Not: Bu proje bilerek backend/frontend'i kendi başlatmıyor (webServer
  // kullanmıyor). Uygulama zaten `start.ps1` ile ayrı bir pencerede,
  // gerçek/paylaşımlı bir Postgres veritabanına bağlı olarak çalışıyor;
  // testler o canlı örneğe karşı yürütülür. Çalıştırmadan önce
  // `..\start.ps1` ile sistemin ayakta olduğundan emin olun — aksi halde
  // global setup açıklayıcı bir hata ile erken durur.
  globalSetup: "./utils/global-setup.ts",
});
