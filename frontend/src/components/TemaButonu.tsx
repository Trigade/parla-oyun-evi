import { useState } from "react";

type Tema = "light" | "dark";
const ANAHTAR = "parla-tema";

function mevcutTema(): Tema {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function TemaButonu() {
  const [tema, setTema] = useState<Tema>(mevcutTema);
  const karanlik = tema === "dark";
  const etiket = karanlik ? "Aydınlık moda geç" : "Karanlık moda geç";

  function degistir() {
    const yeni: Tema = karanlik ? "light" : "dark";
    document.documentElement.dataset.theme = yeni;
    setTema(yeni);
    try {
      localStorage.setItem(ANAHTAR, yeni);
    } catch {
      // depolama kapalı: tercih yalnızca bu oturumda geçerli
    }
  }

  return (
    <button type="button" className="tema-btn" onClick={degistir} aria-label={etiket} title={etiket}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {karanlik ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        )}
      </svg>
    </button>
  );
}
