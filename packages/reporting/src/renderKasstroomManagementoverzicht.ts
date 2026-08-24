import type Decimal from "decimal.js";
import { formatEUR, formatPercentage } from "@bvc/domain";
import type { OnbekendOf } from "@bvc/domain";
import { escapeHtml, formatBedragHtml, renderRapportDocument } from "./huisstijl.js";
import type { KasstroomManagementoverzichtInvoer } from "./types.js";

/**
 * HTML-renderer voor het Kasstroom-managementoverzicht. Rendert uitsluitend
 * de al-berekende `KasstroomManagementoverzichtResultaat`
 * (kasstroomManagementoverzicht.ts) — geen eigen berekening. Bewust nog
 * NIET pixel-perfect gelijk aan het aangeleverde voorbeeldontwerp (op
 * expliciet verzoek van de gebruiker) — hergebruikt de bestaande
 * `.card`/`.kpi-*`-huisstijl (huisstijl.ts) zodat de outputstructuur al
 * wel alle gevraagde KPI's en kwartaalregels ondersteunt.
 */

function formatOnbekendOfBedragHtml(waarde: OnbekendOf<Decimal>): string {
  return waarde.type === "bekend" ? formatBedragHtml(waarde.waarde) : `<span class="negatief">Onbekend — ${escapeHtml(waarde.reden)}</span>`;
}

function formatOnbekendOfPercentageHtml(waarde: OnbekendOf<Decimal>): string {
  return waarde.type === "bekend" ? escapeHtml(formatPercentage(waarde.waarde.times(100))) : `<span class="negatief">Onbekend — ${escapeHtml(waarde.reden)}</span>`;
}

function renderKpiKaart(label: string, waardeTekst: string): string {
  return `
    <div class="card card-pad">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-val">${waardeTekst}</div>
    </div>`;
}

function renderKwartaalTabel(invoer: KasstroomManagementoverzichtInvoer): string {
  const rijen = invoer.resultaat.perKwartaal
    .map(
      (k) =>
        `<tr><td>Q${k.kwartaal}</td><td>${formatBedragHtml(k.huurontvangsten)}</td><td>${formatBedragHtml(k.eigenaarOnttrekkingen)}</td><td>${formatOnbekendOfPercentageHtml(k.uitbetalingsratio)}</td></tr>`,
    )
    .join("");
  return `
    <h2>Per kwartaal</h2>
    <table>
      <thead><tr><th>Kwartaal</th><th>Huurontvangsten</th><th>Eigenaaronttrekkingen</th><th>Uitbetalingsratio</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderControleVereist(invoer: KasstroomManagementoverzichtInvoer): string {
  const { controleVereist } = invoer.resultaat;
  if (controleVereist.length === 0) {
    return `<div class="toelichting"><strong>Controle vereist:</strong> geen — alle liquide-middelen-mutaties in deze periode zijn eenduidig geclassificeerd.</div>`;
  }
  const rijen = controleVereist
    .map((c) => `<tr><td>${escapeHtml(c.grootboekrekening)}</td><td>${formatBedragHtml(c.saldo)}</td><td>${escapeHtml(c.reden)}</td></tr>`)
    .join("");
  return `
    <h2>Controle vereist</h2>
    <div class="toelichting">
      Tegenrekeningen van liquide-middelen-mutaties die (nog) niet eenduidig aan een
      kasstroomcategorie (huurontvangst/exploitatie-uitgave/eigenaaronttrekking/overig)
      toegewezen konden worden — nooit stilzwijgend weggelaten of geraden.
    </div>
    <table>
      <thead><tr><th>Grootboekrekening</th><th>Saldo</th><th>Reden</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

export function renderKasstroomManagementoverzichtBody(invoer: KasstroomManagementoverzichtInvoer): string {
  const { resultaat } = invoer;
  const kpis = `
    <div class="grid g4">
      ${renderKpiKaart("Bankstand begin", formatEUR(resultaat.bankstandBegin))}
      ${renderKpiKaart("Bankstand eind", formatEUR(resultaat.bankstandEind))}
      ${renderKpiKaart("Netto kasstroom", formatEUR(resultaat.nettoKasstroom))}
      ${renderKpiKaart("Streefwaarde bankstand", formatOnbekendOfBedragHtml(resultaat.streefwaardeBankstand))}
      ${renderKpiKaart("Huurontvangsten", formatEUR(resultaat.huurontvangsten))}
      ${renderKpiKaart("Exploitatie-uitgaven", formatEUR(resultaat.exploitatieUitgaven))}
      ${renderKpiKaart("Eigenaaronttrekkingen", formatEUR(resultaat.eigenaarOnttrekkingen))}
      ${renderKpiKaart("Uitbetalingsratio", formatOnbekendOfPercentageHtml(resultaat.uitbetalingsratio))}
    </div>`;

  return `
    <div class="toelichting" style="margin-bottom:24px">
      Kasstroom-managementoverzicht boekjaar ${invoer.boekjaar}, t/m boekperiode ${escapeHtml(invoer.boekperiodeTotEnMet)}. Huurontvangsten/
      exploitatie-uitgaven/eigenaaronttrekkingen zijn afgeleid uit werkelijke bankmutaties (via de tegenrekening van elk
      boekstuk, zie kasstroomManagementoverzicht.ts), niet uit P&amp;L-bedragen.
    </div>
    ${kpis}
    ${renderKwartaalTabel(invoer)}
    ${renderControleVereist(invoer)}`;
}

export function renderKasstroomManagementoverzichtHtml(invoer: KasstroomManagementoverzichtInvoer): string {
  const cover = `
    <div class="cover">
      <div class="eyebrow">BVC Vastgoed Consultants</div>
      <h1 class="serif">Kasstroom — managementoverzicht</h1>
      <div class="object">${escapeHtml(invoer.administratieNaam)} (Bedrijfsnr ${escapeHtml(invoer.bedrijfsnr)})</div>
      <div class="periode">Boekjaar ${invoer.boekjaar}, t/m periode ${escapeHtml(invoer.boekperiodeTotEnMet)} — gegenereerd op ${escapeHtml(invoer.gegenereerdOp.toISOString().slice(0, 19).replace("T", " "))}</div>
    </div>`;

  return renderRapportDocument(`Kasstroom — managementoverzicht — ${invoer.administratieNaam}`, cover, renderKasstroomManagementoverzichtBody(invoer));
}
