import type Decimal from "decimal.js";
import type { OnbekendOf } from "@bvc/domain";
import { escapeHtml, formatBedragHtml, renderRapportDocument } from "./huisstijl.js";
import type { BalansPeriodeInvoer } from "./types.js";
import type { BalansPeriodePost } from "./balansPeriodeBerekening.js";

function formatOnbekendOfBedragHtml(waarde: OnbekendOf<Decimal>): string {
  return waarde.type === "bekend" ? formatBedragHtml(waarde.waarde) : `<span class="negatief">Onbekend — ${escapeHtml(waarde.reden)}</span>`;
}

/**
 * HTML-renderer voor de balans-periodesectie. Rendert uitsluitend de
 * al-berekende `BalansPeriodeResultaat` (balansPeriodeBerekening.ts) —
 * geen eigen berekeningen, geen eigen classificatie, geen eigen
 * tekenconventie (CLAUDE.md, "rekenlaag los van renderer/UI"). Gebruikt
 * uitsluitend de al-toegewezen `rapportagecategorie` (de vaste balanszijde
 * uit de grootboekmapping) om te bepalen in welke tabel een rekening
 * verschijnt — nooit het saldoteken. `saldo` is al het GETOONDE bedrag
 * (rekenlaag heeft de rekening-eigen tekenconventie al toegepast) en wordt
 * hier ongewijzigd weergegeven (geen abs(), geen extra tekenomkering): een
 * negatief bedrag op een normaal positieve balanszijde blijft zichtbaar.
 * Toont rekening, omschrijving, rapportagecategorie, saldo, subtotalen
 * (Activa/Passiva), het resultaat huidig boekjaar (uit de P&L) en de
 * aansluitingscontrole, plus een altijd zichtbare "Controle vereist"-
 * sectie — nooit stilzwijgend weggelaten.
 */

function renderPostenTabel(titel: string, posten: readonly BalansPeriodePost[], totaal: Decimal): string {
  if (posten.length === 0) {
    return `
    <h2>${escapeHtml(titel)}</h2>
    <div class="toelichting">Geen ${escapeHtml(titel.toLowerCase())}-posten op deze peildatum.</div>`;
  }
  const rijen = posten
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.grootboekrekening)}</td><td>${escapeHtml(p.omschrijving ?? "–")}</td><td>${formatBedragHtml(p.saldo)}</td></tr>`,
    )
    .join("");
  return `
    <h2>${escapeHtml(titel)}</h2>
    <table>
      <thead><tr><th>Grootboekrekening</th><th>Omschrijving</th><th>Saldo</th></tr></thead>
      <tbody>${rijen}<tr class="totaalrij"><td colspan="2">Totaal ${escapeHtml(titel)}</td><td>${formatBedragHtml(totaal)}</td></tr></tbody>
    </table>`;
}

function renderControleVereist(invoer: BalansPeriodeInvoer): string {
  const { controleVereist } = invoer.resultaat;
  if (controleVereist.length === 0) {
    return `<div class="toelichting"><strong>Controle vereist:</strong> geen — alle rekeningen met een niet-nul mutatie in deze periode zijn gemapt en verwerkt.</div>`;
  }
  const rijen = controleVereist
    .map((c) => `<tr><td>${escapeHtml(c.grootboekrekening)}</td><td>${formatBedragHtml(c.saldo)}</td><td>${escapeHtml(c.reden)}</td></tr>`)
    .join("");
  return `
    <h2>Controle vereist</h2>
    <div class="toelichting">
      Rekeningen met dataverkeer in deze periode die (nog) niet volledig verwerkt konden worden in de balans hierboven
      — nooit stilzwijgend weggelaten, ongemapte of onvolledige rekeningen blokkeren geen rapportage maar blijven zichtbaar.
    </div>
    <table>
      <thead><tr><th>Grootboekrekening</th><th>Mutatie in periode</th><th>Reden</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderAansluiting(invoer: BalansPeriodeInvoer): string {
  const { aansluiting } = invoer.resultaat;
  const statusTekst = aansluiting.sluitBinnenTolerantie ? "Sluit" : "Sluit NIET";
  const statusKlasse = aansluiting.sluitBinnenTolerantie ? "" : "negatief";
  return `
    <h2>Aansluitingscontrole activa / passiva / resultaat</h2>
    <table>
      <thead><tr><th>Onderdeel</th><th>Bedrag</th></tr></thead>
      <tbody>
        <tr><td>Totaal Activa</td><td>${formatBedragHtml(aansluiting.activaTotaal)}</td></tr>
        <tr><td>Totaal Passiva</td><td>${formatBedragHtml(aansluiting.passivaTotaal)}</td></tr>
        <tr><td>Resultaat huidig boekjaar (t/m periode ${escapeHtml(invoer.boekperiodeTotEnMet)}, uit de P&amp;L)</td><td>${formatOnbekendOfBedragHtml(aansluiting.resultaatHuidigBoekjaar)}</td></tr>
        <tr class="totaalrij"><td>Verschil (activa - passiva - resultaat)</td><td>${formatOnbekendOfBedragHtml(aansluiting.verschil)}</td></tr>
      </tbody>
    </table>
    <div class="toelichting"><strong class="${statusKlasse}">${statusTekst}</strong> binnen de gehanteerde tolerantie. Een verschil is een technisch signaal, meestal veroorzaakt door rekeningen in "Controle vereist" hieronder of een nog niet bevestigd resultaat huidig boekjaar.</div>`;
}

export function renderBalansPeriodeHtml(invoer: BalansPeriodeInvoer): string {
  const cover = `
    <div class="cover">
      <div class="eyebrow">BVC Vastgoed Consultants</div>
      <h1 class="serif">Balans</h1>
      <div class="object">${escapeHtml(invoer.administratieNaam)} (Bedrijfsnr ${escapeHtml(invoer.bedrijfsnr)})</div>
      <div class="periode">Boekjaar ${invoer.boekjaar}, t/m periode ${escapeHtml(invoer.boekperiodeTotEnMet)} — gegenereerd op ${escapeHtml(invoer.gegenereerdOp.toISOString().slice(0, 19).replace("T", " "))}</div>
    </div>`;

  const activaPosten = invoer.resultaat.posten.filter((p) => p.rapportagecategorie === "ACTIVA");
  const passivaPosten = invoer.resultaat.posten.filter((p) => p.rapportagecategorie === "PASSIVA");

  const body = `
    <div class="toelichting" style="margin-bottom:24px">
      Balans op peildatum boekjaar ${invoer.boekjaar}, t/m boekperiode ${escapeHtml(invoer.boekperiodeTotEnMet)}: beginbalans + boekingen
      t/m die periode, op de goedgekeurde master+override-grootboekmapping. Activa/Passiva is de VASTE balanszijde uit
      die mapping — nooit afgeleid uit het actuele saldoteken; een negatief bedrag op een normaal positieve zijde
      (bv. een vooruitbetalende debiteur) blijft daar zichtbaar staan, verhuist niet naar de andere kolom.
    </div>
    ${renderPostenTabel("Activa", activaPosten, invoer.resultaat.aansluiting.activaTotaal)}
    ${renderPostenTabel("Passiva", passivaPosten, invoer.resultaat.aansluiting.passivaTotaal)}
    ${renderAansluiting(invoer)}
    ${renderControleVereist(invoer)}`;

  return renderRapportDocument(`Balans — ${invoer.administratieNaam}`, cover, body);
}
