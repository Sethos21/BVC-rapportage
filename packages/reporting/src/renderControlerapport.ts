import type Decimal from "decimal.js";
import { escapeHtml, formatBedragHtml, renderRapportDocument } from "./huisstijl.js";
import { berekenBalansTotaalEindsaldo, berekenGrootboekTotalen, berekenServicekostenPerKostensoort } from "./controlerapport.js";
import type { ControlerapportInvoer } from "./types.js";

/**
 * HTML-renderer voor het Controlerapport (rauw brondata-overzicht, geen
 * grootboekmapping/servicekosten-uitsluiting — zie types.ts). Bedoeld om
 * regel-voor-regel te vergelijken met een bestaande rapportage, niet als
 * vervanging van de KPI-rapportsecties (Kerncijfers/P&L) — die vereisen
 * een goedgekeurde grootboekmapping die er nog niet is. Rendert alleen —
 * rekent niets uit (zie controlerapport.ts).
 */

function m2(waarde: Decimal | null): string {
  return waarde === null ? "–" : `${waarde.toString()} m²`;
}

function renderMeldingIndienLeeg(titel: string, aantal: number, melding: string): string {
  if (aantal > 0) return "";
  return `<div class="toelichting"><strong>${escapeHtml(titel)}:</strong> ${escapeHtml(melding)}</div>`;
}

function renderGrootboekTotalen(invoer: ControlerapportInvoer): string {
  const totalen = berekenGrootboekTotalen(invoer.boekingen);
  const rijen = totalen
    .map((t) => `<tr><td>${escapeHtml(t.grootboeknr)}</td><td>${formatBedragHtml(t.debet)}</td><td>${formatBedragHtml(t.credit)}</td><td>${formatBedragHtml(t.saldo)}</td></tr>`)
    .join("");
  return `
    <h2>Grootboek-totalen (boekingen)</h2>
    ${renderMeldingIndienLeeg("Boekingen", invoer.boekingen.length, "Geen boekingen in de cache voor deze administratie.")}
    ${invoer.boekingen.length > 0 ? `
    <table>
      <thead><tr><th>Grootboeknr</th><th>Debet</th><th>Credit</th><th>Saldo (debet − credit)</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>` : ""}`;
}

function renderBalans(invoer: ControlerapportInvoer): string {
  const rijen = invoer.balansstanden
    .slice()
    .sort((a, b) => a.grootboekrekeningnr.localeCompare(b.grootboekrekeningnr))
    .map((b) => `<tr><td>${escapeHtml(b.grootboekrekeningnr)}</td><td>${escapeHtml(b.omschrijving ?? "")}</td><td>${formatBedragHtml(b.eindsaldo)}</td></tr>`)
    .join("");
  const totaal = berekenBalansTotaalEindsaldo(invoer.balansstanden);
  return `
    <h2>Balans — eindsaldo per rekening</h2>
    ${renderMeldingIndienLeeg("Balans", invoer.balansstanden.length, "Geen balansstanden in de cache voor deze administratie.")}
    ${invoer.balansstanden.length > 0 ? `
    <table>
      <thead><tr><th>Grootboekrekeningnr</th><th>Omschrijving</th><th>Eindsaldo</th></tr></thead>
      <tbody>${rijen}<tr class="totaalrij"><td colspan="2">Totaal (controlegetal)</td><td>${formatBedragHtml(totaal)}</td></tr></tbody>
    </table>` : ""}`;
}

function renderServicekosten(invoer: ControlerapportInvoer): string {
  const totalen = berekenServicekostenPerKostensoort(invoer.servicekosten);
  const rijen = totalen
    .map((t) => `<tr><td>${escapeHtml(t.kostensoort)}</td><td>${escapeHtml(t.omschrijving ?? "")}</td><td>${formatBedragHtml(t.debet)}</td><td>${formatBedragHtml(t.credit)}</td><td>${formatBedragHtml(t.saldo)}</td></tr>`)
    .join("");
  return `
    <h2>Servicekosten per kostensoort</h2>
    <div class="toelichting">Ongefilterd — kostensoort-uitsluitingsregels (bv. 9600) zijn hier bewust niet toegepast; dit is een reconciliatie-overzicht, geen KPI-analyse.</div>
    ${renderMeldingIndienLeeg("Servicekosten", invoer.servicekosten.length, "Geen servicekosten in de cache voor deze administratie.")}
    ${invoer.servicekosten.length > 0 ? `
    <table>
      <thead><tr><th>Kostensoort</th><th>Omschrijving</th><th>Debet</th><th>Credit</th><th>Saldo</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>` : ""}`;
}

function renderContractenUnitsRentroll(invoer: ControlerapportInvoer): string {
  const contractenRijen = invoer.contracten
    .map((c) => `<tr><td>${escapeHtml(c.contract)}</td><td>${escapeHtml(c.complexnummer ?? "")}</td><td>${escapeHtml(c.unitnummer ?? "")}</td><td>${escapeHtml(c.huurdernummer ?? "")}</td></tr>`)
    .join("");
  const unitsRijen = invoer.units
    .map((u) => `<tr><td>${escapeHtml(u.complexnummer)}</td><td>${escapeHtml(u.unitnummer)}</td><td>${escapeHtml(u.omschrijving ?? "")}</td><td>${m2(u.vvo)}</td></tr>`)
    .join("");
  const rentrollRijen = invoer.rentroll
    .map((r) => `<tr><td>${escapeHtml(r.contractnummer)}</td><td>${escapeHtml(r.complexnummer ?? "")}</td><td>${r.prolongatieBedragJaar ? formatBedragHtml(r.prolongatieBedragJaar) : "–"}</td><td>${m2(r.gehuurdOppervlak)}</td></tr>`)
    .join("");

  return `
    <h2>Contracten, units &amp; huuroverzicht (rentroll)</h2>
    <div class="grid g3" style="align-items:start">
      <div>
        <div style="font:600 14px 'Spectral',serif;margin-bottom:8px">Contracten (${invoer.contracten.length})</div>
        ${invoer.contracten.length > 0 ? `<table><thead><tr><th>Contract</th><th>Complex</th><th>Unit</th><th>Huurder</th></tr></thead><tbody>${contractenRijen}</tbody></table>` : `<div class="toelichting">Geen contracten in de cache.</div>`}
      </div>
      <div>
        <div style="font:600 14px 'Spectral',serif;margin-bottom:8px">Units (${invoer.units.length})</div>
        ${invoer.units.length > 0 ? `<table><thead><tr><th>Complex</th><th>Unit</th><th>Omschrijving</th><th>VVO</th></tr></thead><tbody>${unitsRijen}</tbody></table>` : `<div class="toelichting">Geen units in de cache.</div>`}
      </div>
      <div>
        <div style="font:600 14px 'Spectral',serif;margin-bottom:8px">Rentroll (${invoer.rentroll.length})</div>
        ${invoer.rentroll.length > 0 ? `<table><thead><tr><th>Contract</th><th>Complex</th><th>Jaarhuur</th><th>Oppervlak</th></tr></thead><tbody>${rentrollRijen}</tbody></table>` : `<div class="toelichting">Geen rentroll-regels in de cache.</div>`}
      </div>
    </div>`;
}

function renderComplexTotalen(invoer: ControlerapportInvoer): string {
  const rijen = invoer.complexTotalen
    .map((c) => `<tr><td>${escapeHtml(c.complexnr)}</td><td>${m2(c.totaalOppervlakte)}</td><td>${m2(c.totaalVerhuurd)}</td><td>${m2(c.totaalLeegstand)}</td></tr>`)
    .join("");
  return `
    <h2>Complex-totalen</h2>
    ${renderMeldingIndienLeeg("Complex-totalen", invoer.complexTotalen.length, "Geen complex-totalen in de cache voor deze administratie.")}
    ${invoer.complexTotalen.length > 0 ? `
    <table>
      <thead><tr><th>Complexnr</th><th>Totaal oppervlakte</th><th>Totaal verhuurd</th><th>Totaal leegstand</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>` : ""}`;
}

function renderStatusbanner(invoer: ControlerapportInvoer): string {
  const meldingen: string[] = [];
  if (!invoer.ouderdomsanalyseGeladen) {
    meldingen.push("Ouderdomsanalyse: nog niet geladen (boekjaar/boekperiode/peildatum ontbraken bij de laatste cache-herbouw).");
  }
  if (!invoer.begrotingGeladen) {
    meldingen.push("Begroting: nog niet gekoppeld aan de cache — ontbreekt bewust nog, blokkeert dit rapport niet.");
  }
  if (meldingen.length === 0) return "";
  return `<div class="toelichting" style="margin-top:0 0 24px">${meldingen.map((m) => `<p>${escapeHtml(m)}</p>`).join("")}</div>`;
}

export function renderControlerapportHtml(invoer: ControlerapportInvoer): string {
  const cover = `
    <div class="cover">
      <div class="eyebrow">BVC Vastgoed Consultants</div>
      <h1 class="serif">Controlerapport</h1>
      <div class="object">${escapeHtml(invoer.administratieNaam)} (Bedrijfsnr ${escapeHtml(invoer.bedrijfsnr)})</div>
      <div class="periode">Gegenereerd op ${escapeHtml(invoer.gegenereerdOp.toISOString().slice(0, 19).replace("T", " "))}</div>
    </div>`;

  const body = `
    <div class="toelichting" style="margin-bottom:24px">
      Rauw brondata-overzicht rechtstreeks uit de cache — <strong>geen grootboekmapping toegepast</strong>
      (die is nog niet goedgekeurd/beschikbaar). Bedoeld om regel voor regel te vergelijken met een bestaande
      rapportage; geen vervanging van de Kerncijfers-/P&amp;L-secties.
    </div>
    ${renderStatusbanner(invoer)}
    ${renderGrootboekTotalen(invoer)}
    ${renderBalans(invoer)}
    ${renderServicekosten(invoer)}
    ${renderContractenUnitsRentroll(invoer)}
    ${renderComplexTotalen(invoer)}`;

  return renderRapportDocument(`Controlerapport — ${invoer.administratieNaam}`, cover, body);
}
