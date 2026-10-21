import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ["numbly-clerk-matcher.ngrok-free.dev"],
    host: true,
    port: 5173,
    // Frontend artık backend'i her zaman aynı origin üzerinden göreli /api
    // yoluyla çağırıyor (bkz. src/api/client.ts); bu proxy isteği gerçek
    // backend'e (localhost:8080) yönlendirir. Böylece ngrok gibi tek portu
    // tünelleyen bir HTTPS erişimde de ayrı bir backend tüneline gerek kalmaz
    // ve mixed-content/CORS sorunu yaşanmaz. Hedef API_PROXY_TARGET ile değiştirilebilir.
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
})
