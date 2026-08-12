import Decimal from "decimal.js";
import { formatEUR, formatPercentage } from "@bvc/domain";
import type { PLRapportInvoer } from "./types.js";
import { berekenPLOveralTotaal, berekenPLTotalen, berekenPLTrend, berekenPostenTotaal, type PLJaarTotalen } from "./plRapport.js";

/**
 * HTML-renderer voor de P&L-exploitatierapportage, in BVC-huisstijl. De
 * huisstijl (kleuren, typografie, kaart-/tabelpatronen) is overgenomen van
 * `legacy/index.html` (`:root`-variabelen, `.sec-kicker`/`.sec-title`,
 * `.card`, `.row-total`) — dat bestand is de bevestigde bron van het door
 * de gebruiker aangeleverde streefontwerp (PDF, zelfde sectie-CSS en
 * pagina-indeling). Positieve bedragen zwart, negatieve bedragen rood
 * tussen haakjes; totaalrijen krijgen een groene bovenrand + tint
 * (`.row-total`, i.p.v. het eerdere generieke navy-blok). Rendert alleen —
 * rekent niets uit (zie plRapport.ts).
 *
 * Rapportstructuur: coverpage, samenvatting, inkomsten, kosten, netto
 * exploitatieresultaat, grafiek (inkomsten vs. kosten per jaar), toelichting.
 *
 * Nog te porten uit legacy/index.html (zie packages/reporting/README.md):
 * 01 Kerncijfers, 03 Kasstroom, 04 Balans, 05 Servicekosten, 06 Verhuur,
 * 07 Onderhoud & investeringen, 08 Signalen.
 */

const HUISSTIJL_CSS = `
  :root{
    --ink:#1c2521; --muted:#626b64; --muted2:#8a8f88;
    --green:#21594a; --green2:#2e8b57; --red:#bf4a30;
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
  h2{font:600 25px/1.15 'Spectral',serif;color:var(--ink);border-bottom:2px solid var(--green);padding-bottom:6px;margin-top:40px}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-variant-numeric:tabular-nums}
  th,td{padding:9px 10px;text-align:right;border-top:1px solid var(--line3)}
  th:first-child,td:first-child{text-align:left}
  th{font:600 10.5px 'IBM Plex Sans';letter-spacing:0.05em;text-transform:uppercase;color:var(--muted2);background:#faf9f5;border-top:none}
  .negatief{color:var(--red)}
  .totaalrij td{font-weight:700;border-top:2px solid var(--green);background:var(--tintGreen)}
  .toelichting{margin-top:12px;color:var(--muted);font-size:13.5px}
  .grafiek{margin-top:16px}
`;

function escapeHtml(tekst: string): string {
  return tekst.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatBedragHtml(bedrag: Decimal): string {
  const tekst = escapeHtml(formatEUR(bedrag, "haakjes"));
  return bedrag.isNegative() ? `<span class="negatief">${tekst}</span>` : tekst;
}

function renderCover(invoer: PLRapportInvoer): string {
  const perioden = `${invoer.jaren[0]?.jaar ?? "?"}–${invoer.jaren[invoer.jaren.length - 1]?.jaar ?? "?"}`;
  return `
    <div class="cover">
      <div class="eyebrow">BVC Vastgoed Consultants</div>
      <h1 class="serif">Exploitatierapportage</h1>
      <div class="object">${escapeHtml(invoer.objectnaam)} (object ${escapeHtml(invoer.objectnummer)})</div>
      <div class="periode">${escapeHtml(perioden)}</div>
    </div>`;
}

function renderSamenvatting(totalen: readonly PLJaarTotalen[]): string {
  const trend = berekenPLTrend(totalen);
  const rijen = totalen
    .map((t) => {
      const trendpunt = trend.find((tp) => tp.jaar === t.jaar);
      const trendTekst =
        trendpunt === undefined
          ? "–"
          : `${formatBedragHtml(trendpunt.mutatieAbsoluut)}${trendpunt.mutatiePct.type === "bekend" ? ` (${escapeHtml(formatPercentage(trendpunt.mutatiePct.waarde))})` : ""}`;
      return `<tr><td>${t.jaar}</td><td>${formatBedragHtml(t.nettoResultaat)}</td><td>${trendTekst}</td></tr>`;
    })
    .join("");
  return `
    <h2>Samenvatting</h2>
    <table>
      <thead><tr><th>Jaar</th><th>Netto resultaat</th><th>Mutatie t.o.v. vorig jaar</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderPostentabel(titel: string, jaren: PLRapportInvoer["jaren"], postenSelector: (j: PLRapportInvoer["jaren"][number]) => { naam: string; bedrag: Decimal }[]): string {
  const alleNamen = Array.from(new Set(jaren.flatMap((j) => postenSelector(j).map((p) => p.naam))));
  const rijen = alleNamen
    .map((naam) => {
      const cellen = jaren.map((j) => {
        const post = postenSelector(j).find((p) => p.naam === naam);
        return `<td>${post ? formatBedragHtml(post.bedrag) : "–"}</td>`;
      });
      return `<tr><td>${escapeHtml(naam)}</td>${cellen.join("")}</tr>`;
    })
    .join("");
  const kop = jaren.map((j) => `<th>${j.jaar}</th>`).join("");
  const totaalrij = jaren.map((j) => `<td>${formatBedragHtml(berekenPostenTotaal(postenSelector(j)))}</td>`).join("");
  return `
    <h2>${escapeHtml(titel)}</h2>
    <table>
      <thead><tr><th></th>${kop}</tr></thead>
      <tbody>${rijen}<tr class="totaalrij"><td>Totaal</td>${totaalrij}</tr></tbody>
    </table>`;
}

function renderNettoResultaat(totalen: readonly PLJaarTotalen[]): string {
  const overal = berekenPLOveralTotaal(totalen);
  const rijen = totalen
    .map((t) => `<tr><td>${t.jaar}</td><td>${formatBedragHtml(t.huurTotaal)}</td><td>${formatBedragHtml(t.kostenTotaal)}</td><td>${formatBedragHtml(t.nettoResultaat)}</td></tr>`)
    .join("");
  return `
    <h2>Netto exploitatieresultaat</h2>
    <table>
      <thead><tr><th>Jaar</th><th>Huurinkomsten</th><th>Kosten</th><th>Netto resultaat</th></tr></thead>
      <tbody>
        ${rijen}
        <tr class="totaalrij"><td>Totaal</td><td>${formatBedragHtml(overal.huurTotaal)}</td><td>${formatBedragHtml(overal.kostenTotaal)}</td><td>${formatBedragHtml(overal.nettoResultaat)}</td></tr>
      </tbody>
    </table>`;
}

/** Eenvoudige inline-SVG staafdiagram (geen externe grafiekbibliotheek) — inkomsten vs. kosten per jaar. */
function renderGrafiek(totalen: readonly PLJaarTotalen[]): string {
  const breedtePerJaar = 90;
  const hoogte = 200;
  const maxWaarde = Decimal.max(new Decimal(1), ...totalen.flatMap((t) => [t.huurTotaal, t.kostenTotaal.abs()]));
  const staven = totalen
    .map((t, i) => {
      const x = i * breedtePerJaar;
      const huurHoogte = t.huurTotaal.dividedBy(maxWaarde).times(hoogte).toNumber();
      const kostenHoogte = t.kostenTotaal.abs().dividedBy(maxWaarde).times(hoogte).toNumber();
      return `
        <rect x="${x + 10}" y="${hoogte - huurHoogte}" width="30" height="${huurHoogte}" rx="3" fill="#21594a" />
        <rect x="${x + 45}" y="${hoogte - kostenHoogte}" width="30" height="${kostenHoogte}" rx="3" fill="#bf4a30" />
        <text x="${x + 40}" y="${hoogte + 16}" font-size="11" text-anchor="middle">${t.jaar}</text>`;
    })
    .join("");
  return `
    <h2>Inkomsten vs. kosten per jaar</h2>
    <div class="grafiek">
      <svg width="${totalen.length * breedtePerJaar + 20}" height="${hoogte + 30}">${staven}</svg>
      <div style="font-size:12px;margin-top:4px"><span style="color:#21594a">■</span> huurinkomsten &nbsp; <span style="color:#bf4a30">■</span> kosten</div>
    </div>`;
}

function renderToelichting(invoer: PLRapportInvoer): string {
  const items = invoer.jaren
    .filter((j) => j.toelichting)
    .map((j) => `<p><strong>${j.jaar}:</strong> ${escapeHtml(j.toelichting!)}</p>`)
    .join("");
  return items ? `<h2>Toelichting</h2><div class="toelichting">${items}</div>` : "";
}

export function renderPLRapportHtml(invoer: PLRapportInvoer): string {
  const totalen = berekenPLTotalen(invoer);
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8" />
<title>Exploitatierapportage — ${escapeHtml(invoer.objectnaam)}</title>
<style>${HUISSTIJL_CSS}</style>
</head>
<body>
${renderCover(invoer)}
<div class="pagina">
${renderSamenvatting(totalen)}
${renderPostentabel("Inkomsten", invoer.jaren, (j) => j.huurinkomstenPerEenheid)}
${renderPostentabel("Kosten", invoer.jaren, (j) => j.kostenPerCategorie)}
${renderNettoResultaat(totalen)}
${renderGrafiek(totalen)}
${renderToelichting(invoer)}
</div>
</body>
</html>`;
}
