import { formatEUR } from "@bvc/domain";
import { escapeHtml, formatBedragHtml, renderRapportDocument } from "./huisstijl.js";
import type { KasstroomManagementoverzichtInvoer } from "./types.js";

/**
 * HTML-renderer voor het (vereenvoudigde) Kasstroom-managementoverzicht.
 * Rendert uitsluitend de al-berekende `KasstroomManagementoverzichtResultaat`
 * (kasstroomManagementoverzicht.ts) — geen eigen berekening. Bewust nog
 * NIET pixel-perfect gelijk aan het aangeleverde voorbeeldontwerp (op
 * expliciet verzoek van de gebruiker) — hergebruikt de bestaande
 * `.card`/`.kpi-*`-huisstijl (huisstijl.ts) zodat de outputstructuur al
 * wel alle gevraagde KPI's en kwartaalregels ondersteunt.
 */

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
        `<tr><td>Q${k.kwartaal}</td><td>${formatBedragHtml(k.ontvangsten)}</td><td>${formatBedragHtml(k.uitgaven)}</td><td>${formatBedragHtml(k.eigenaarOnttrekkingen)}</td><td>${formatBedragHtml(k.nettoKasstroom)}</td></tr>`,
    )
    .join("");
  return `
    <h2>Per kwartaal</h2>
    <table>
      <thead><tr><th>Kwartaal</th><th>Ontvangsten</th><th>Uitgaven</th><th>Eigenaaronttrekkingen</th><th>Netto kasstroom</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderUitgavenUitsplitsing(invoer: KasstroomManagementoverzichtInvoer): string {
  const { uitgaven, eigenaarOnttrekkingen, overigeUitgaven } = invoer.resultaat;
  return `
    <h2>Uitsplitsing uitgaven</h2>
    <table>
      <thead><tr><th>Onderdeel</th><th>Bedrag</th></tr></thead>
      <tbody>
        <tr><td>Waarvan eigenaaronttrekkingen</td><td>${formatBedragHtml(eigenaarOnttrekkingen)}</td></tr>
        <tr><td>Waarvan overige uitgaven</td><td>${formatBedragHtml(overigeUitgaven)}</td></tr>
        <tr class="totaalrij"><td>Totaal uitgaven</td><td>${formatBedragHtml(uitgaven)}</td></tr>
      </tbody>
    </table>`;
}

function renderControleVereist(invoer: KasstroomManagementoverzichtInvoer): string {
  const { controleVereist } = invoer.resultaat;
  if (controleVereist.length === 0) {
    return `<div class="toelichting"><strong>Controle vereist:</strong> geen.</div>`;
  }
  const rijen = controleVereist
    .map((c) => `<tr><td>${escapeHtml(c.grootboekrekening)}</td><td>${formatBedragHtml(c.saldo)}</td><td>${escapeHtml(c.reden)}</td></tr>`)
    .join("");
  return `
    <h2>Controle vereist</h2>
    <div class="toelichting">
      Nooit stilzwijgend weggelaten — een boekstuk dat hier vermeld staat, telt (waar van
      toepassing) al wel mee in de totalen hierboven; de vermelding is informatief.
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
      ${renderKpiKaart("Totale ontvangsten", formatEUR(resultaat.ontvangsten))}
      ${renderKpiKaart("Totale uitgaven", formatEUR(resultaat.uitgaven))}
      ${renderKpiKaart("Netto kasstroom", formatEUR(resultaat.nettoKasstroom))}
      ${renderKpiKaart("Bankstand eind", formatEUR(resultaat.bankstandEind))}
    </div>`;

  return `
    <div class="toelichting" style="margin-bottom:24px">
      Kasstroom-managementoverzicht boekjaar ${invoer.boekjaar}, t/m boekperiode ${escapeHtml(invoer.boekperiodeTotEnMet)}. Ontvangsten
      en uitgaven zijn uitsluitend afgeleid uit werkelijke mutaties op de bevestigde liquide-middelen-rekening(en)
      — niet uit P&amp;L-bedragen. Eigenaaronttrekkingen is een uitsplitsing BINNEN de uitgaven (via de tegenrekening).
    </div>
    ${kpis}
    ${renderUitgavenUitsplitsing(invoer)}
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
