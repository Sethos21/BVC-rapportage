import type Decimal from "decimal.js";
import { formatEUR, formatPercentage } from "@bvc/domain";

/**
 * Gedeelde BVC-huisstijl (CSS, escaping, bedragformattering) voor alle
 * rapportsecties. Overgenomen van `legacy/index.html` (`:root`-variabelen,
 * `.card`/`.kpi-*`/`.bar-*`/`.sec-*`) — dat bestand is de bevestigde bron
 * van het door de gebruiker aangeleverde streefontwerp (zie
 * packages/reporting/README.md). Elke sectierenderer importeert dit
 * bestand i.p.v. eigen CSS/helpers te definiëren, zodat alle secties
 * visueel één geheel blijven.
 */

export const HUISSTIJL_CSS = `
  :root{
    --ink:#1c2521; --muted:#626b64; --muted2:#8a8f88;
    --green:#21594a; --green2:#2e8b57; --red:#bf4a30; --gold:#a97a1f;
    --paper:#f6f4ee; --card:#ffffff; --line:#e6e4dc; --line3:#f1efe9;
    --tintGreen:#eef4f1;
  }
  body{font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;color:var(--ink);margin:0;padding:0;background:#fff}
  .serif{font-family:'Spectral',serif}
  .pagina{max-width:900px;margin:0 auto;padding:32px}
  .cover{text-align:center;padding:120px 32px;background:var(--paper)}
  .cover .eyebrow{font:400 13px 'IBM Plex Sans';letter-spacing:0.15em;text-transform:uppercase;color:var(--muted2)}
  .cover h1{font:600 34px/1.1 'Spectral',serif;color:var(--ink);margin:9px 0 6px}
  .cover .object{font-size:20px;margin-top:24px}
  .cover .periode{color:var(--muted);margin-top:8px}
  .sec-kicker{font:500 12px 'IBM Plex Sans';letter-spacing:0.14em;text-transform:uppercase;color:var(--muted2)}
  .sec-title{font:600 25px/1.15 'Spectral',serif;color:var(--ink);margin:7px 0 6px}
  .sec-sub{font:400 14px 'IBM Plex Sans';color:var(--muted);margin-bottom:22px}
  h2{font:600 25px/1.15 'Spectral',serif;color:var(--ink);border-bottom:2px solid var(--green);padding-bottom:6px;margin-top:40px}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-variant-numeric:tabular-nums}
  th,td{padding:9px 10px;text-align:right;border-top:1px solid var(--line3)}
  th:first-child,td:first-child{text-align:left}
  th{font:600 10.5px 'IBM Plex Sans';letter-spacing:0.05em;text-transform:uppercase;color:var(--muted2);background:#faf9f5;border-top:none}
  .negatief{color:var(--red)}
  .totaalrij td{font-weight:700;border-top:2px solid var(--green);background:var(--tintGreen)}
  .toelichting{margin-top:12px;color:var(--muted);font-size:13.5px}
  .grafiek{margin-top:16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 2px rgba(28,37,33,0.04)}
  .card-pad{padding:20px 22px}
  .grid{display:grid;gap:16px}
  .g2{grid-template-columns:1fr 1fr}
  .g3{grid-template-columns:repeat(3,1fr)}
  .g4{grid-template-columns:repeat(4,1fr)}
  .kpi-label{font:500 12px 'IBM Plex Sans';letter-spacing:0.05em;text-transform:uppercase;color:var(--muted2)}
  .kpi-val{font:600 28px/1 'Spectral',serif;font-variant-numeric:tabular-nums;margin:10px 0 8px;color:var(--ink)}
  .kpi-sub{font:500 13px 'IBM Plex Sans'}
  .bar-wrap{display:flex;align-items:flex-end;gap:14px}
  .bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:9px}
  .bar-stack{height:196px;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:7px}
  .bar{width:100%;max-width:56px;border-radius:6px 6px 0 0;background:var(--green)}
  .bar.vorig{background:#c6cbc5}
  .bar-lbl{font:500 11.5px 'IBM Plex Sans';color:var(--muted2)}
  .bar-val{font:500 11.5px 'IBM Plex Mono',monospace;color:var(--ink)}
  @media print{
    .card{box-shadow:none;border:1px solid #d8d6ce;break-inside:avoid}
  }
  .badge{display:inline-block;font:600 10.5px 'IBM Plex Sans';letter-spacing:0.05em;text-transform:uppercase;padding:3px 9px;border-radius:999px}
  .badge-momentopname{background:#fbf3e2;color:var(--gold);border:1px solid #ecdcb3}
  .badge-periode{background:var(--tintGreen);color:var(--green);border:1px solid #cfe1d8}
  .badge-stand{background:#eef2f6;color:#2b4a63;border:1px solid #cfdbe6}
  .controle-vereist{color:var(--gold);font-style:italic;cursor:help;border-bottom:1px dotted var(--gold)}
  .ernst-kritiek{color:var(--red);font-weight:600}
  .ernst-waarschuwing{color:var(--gold);font-weight:600}
  .ernst-informatief{color:var(--muted)}
`;

export function escapeHtml(tekst: string): string {
  return tekst.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function formatBedragHtml(bedrag: Decimal): string {
  const tekst = escapeHtml(formatEUR(bedrag, "haakjes"));
  return bedrag.isNegative() ? `<span class="negatief">${tekst}</span>` : tekst;
}

/** `12,5%` — zie `@bvc/domain`'s `formatPercentage` (verwacht een waarde die al ×100 is, bv. bezettingsgraad). */
export function formatPercentageHtml(waarde: Decimal): string {
  const tekst = escapeHtml(formatPercentage(waarde));
  return waarde.isNegative() ? `<span class="negatief">${tekst}</span>` : tekst;
}

/** `1.390 m²` / `3.333,5 m²` — duizendtalpunt, komma als decimaal (zelfde stijl als `formatEUR`), geen decimalen als de waarde een heel getal is. */
export function formatM2Html(waarde: Decimal): string {
  const [geheel, decimalen] = waarde.toFixed(waarde.isInteger() ? 0 : 1).split(".");
  const geheelMetPunten = (geheel ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const tekst = decimalen ? `${geheelMetPunten},${decimalen}` : geheelMetPunten;
  return `${escapeHtml(tekst)} m²`;
}

/** Toont een `OnbekendOf<Decimal>` als de geformatteerde waarde, of als "Controle vereist" (met de reden als tooltip) — nooit een gok. */
export function formatOnbekendOfHtml<T extends Decimal>(waarde: { type: "bekend"; waarde: T } | { type: "onbekend"; reden: string }, formatteer: (d: T) => string): string {
  if (waarde.type === "bekend") return formatteer(waarde.waarde);
  return `<span class="controle-vereist" title="${escapeHtml(waarde.reden)}">Controle vereist</span>`;
}

/** Wikkelt sectie-HTML in het gedeelde document-skelet (doctype/head/CSS/pagina-div). */
export function renderRapportDocument(titel: string, coverHtml: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(titel)}</title>
<style>${HUISSTIJL_CSS}</style>
</head>
<body>
${coverHtml}
<div class="pagina">
${bodyHtml}
</div>
</body>
</html>`;
}
