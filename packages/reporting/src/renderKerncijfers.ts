import Decimal from "decimal.js";
import { formatEUR, formatPercentage } from "@bvc/domain";
import { escapeHtml, renderRapportDocument } from "./huisstijl.js";
import { berekenBezettingsgraadPortefeuille, berekenHuurPerComplexTotaal, berekenKpiMutatie } from "./kerncijfers.js";
import type { KerncijfersInvoer } from "./types.js";

/**
 * HTML-renderer voor sectie "01 — Kerncijfers" (KPI-dashboard), in
 * BVC-huisstijl (huisstijl.ts). Poort van `legacy/index.html`'s
 * `renderOverzicht` (bevestigde spec — zie packages/reporting/README.md):
 * zelfde kaartindeling (`.grid.g3` met 6 KPI-kaarten), kwartaalbalken en
 * huur-per-complex-tabel, maar met herberekende cijfers via kerncijfers.ts
 * i.p.v. de inline JS-berekeningen uit legacy. Rendert alleen — rekent
 * niets uit.
 */

const GROEN = "var(--green2)";
const GOUD = "var(--gold)";

function renderCover(invoer: KerncijfersInvoer): string {
  return `
    <div class="cover">
      <div class="eyebrow">BVC Vastgoed Consultants</div>
      <h1 class="serif">Kerncijfers</h1>
      <div class="object">${escapeHtml(invoer.portefeuilleNaam)}</div>
      <div class="periode">${escapeHtml(invoer.periodeLabel)}</div>
    </div>`;
}

function renderKpiKaart(label: string, waardeTekst: string, subTekst: string, subKleur: string): string {
  return `
    <div class="card card-pad">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-val">${waardeTekst}</div>
      <div class="kpi-sub" style="color:${subKleur}">${subTekst}</div>
    </div>`;
}

function renderKpiKaarten(invoer: KerncijfersInvoer): string {
  const { kpis } = invoer;

  const huur = berekenKpiMutatie(kpis.huurinkomen.waarde, kpis.huurinkomen.vorig, true);
  const ebitda = berekenKpiMutatie(kpis.ebitda.waarde, kpis.ebitda.vorig, true);
  const debiteuren = berekenKpiMutatie(kpis.debiteuren.waarde, kpis.debiteuren.vorig, false);

  const mutatieTekst = (m: ReturnType<typeof berekenKpiMutatie>): string => {
    const pijl = m.mutatieAbsoluut.isNegative() ? "▼" : "▲";
    const pctTekst = m.mutatiePct.type === "bekend" ? ` (${escapeHtml(formatPercentage(m.mutatiePct.waarde.abs()))})` : "";
    return `${pijl} ${escapeHtml(formatEUR(m.mutatieAbsoluut.abs()))}${pctTekst} vs vorige periode`;
  };

  const ratioW = kpis.uitbetalingsratio.waarde;
  const ratioNorm = kpis.uitbetalingsratio.norm;
  const ratioGezond = ratioW.lessThanOrEqualTo(ratioNorm);

  const bankGunstig = kpis.bankstand.waarde.greaterThanOrEqualTo(kpis.bankstand.streefwaarde);

  const svcOverschot = !kpis.servicekostenSaldo.isPositive();

  const kaarten = [
    renderKpiKaart(
      `Huurinkomen ${escapeHtml(invoer.periodeLabel)}`,
      escapeHtml(formatEUR(kpis.huurinkomen.waarde)),
      mutatieTekst(huur),
      huur.gunstig ? GROEN : GOUD,
    ),
    renderKpiKaart(
      `EBITDA ${escapeHtml(invoer.periodeLabel)}`,
      escapeHtml(formatEUR(kpis.ebitda.waarde)),
      mutatieTekst(ebitda),
      ebitda.gunstig ? GROEN : GOUD,
    ),
    renderKpiKaart(
      "Uitbetalingsratio",
      escapeHtml(formatPercentage(ratioW.times(100))),
      `${ratioGezond ? "●" : "▲"} ${ratioGezond ? "gezond" : "hoog"} · norm &lt; ${ratioNorm.times(100).toFixed(0)}%`,
      ratioGezond ? GROEN : GOUD,
    ),
    renderKpiKaart(
      "Bankstand einde periode",
      escapeHtml(formatEUR(kpis.bankstand.waarde)),
      `${bankGunstig ? "▲ boven" : "▼ onder"} streefwaarde ${escapeHtml(formatEUR(kpis.bankstand.streefwaarde))}`,
      bankGunstig ? GROEN : GOUD,
    ),
    renderKpiKaart("Huurdebiteuren", escapeHtml(formatEUR(kpis.debiteuren.waarde)), mutatieTekst(debiteuren), debiteuren.gunstig ? GROEN : GOUD),
    renderKpiKaart(
      "Servicekosten-saldo",
      escapeHtml(formatEUR(kpis.servicekostenSaldo)),
      svcOverschot ? "● overschot · voorschotten > kosten" : "● tekort · kosten > voorschotten",
      svcOverschot ? GROEN : GOUD,
    ),
  ].join("");

  return `<div class="grid g3">${kaarten}</div>`;
}

function renderKwartaalBalken(invoer: KerncijfersInvoer): string {
  const punten = invoer.huurPerKwartaal;
  if (punten.length === 0) return "";
  const maxWaarde = Decimal.max(new Decimal(1), ...punten.map((p) => p.waarde));
  const huidigJaar = Math.max(...punten.map((p) => p.jaar));
  const kolommen = punten
    .map((p) => {
      const hoogtePx = Decimal.max(new Decimal(6), p.waarde.dividedBy(maxWaarde).times(180)).toFixed(0);
      return `
        <div class="bar-col">
          <div class="bar-stack">
            <div class="bar-val">${escapeHtml(p.waarde.dividedBy(1000).toDecimalPlaces(0).toString())}k</div>
            <div class="bar${p.jaar === huidigJaar ? "" : " vorig"}" style="height:${hoogtePx}px"></div>
          </div>
          <div class="bar-lbl">${escapeHtml(p.label)}</div>
        </div>`;
    })
    .join("");
  return `
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px">
        <div style="font:600 16px 'Spectral',serif;color:var(--ink)">Huurinkomen per kwartaal</div>
        <div style="display:flex;gap:16px">
          <span style="display:flex;align-items:center;gap:6px;font:400 12px 'IBM Plex Sans';color:var(--muted)"><span style="width:11px;height:11px;border-radius:3px;background:#c6cbc5"></span>vorig jaar</span>
          <span style="display:flex;align-items:center;gap:6px;font:400 12px 'IBM Plex Sans';color:var(--muted)"><span style="width:11px;height:11px;border-radius:3px;background:var(--green)"></span>huidig jaar</span>
        </div>
      </div>
      <div class="bar-wrap">${kolommen}</div>
    </div>`;
}

function renderHuurPerComplex(invoer: KerncijfersInvoer): string {
  const regels = invoer.huurPerComplex;
  if (regels.length === 0) return "";
  const totaal = berekenHuurPerComplexTotaal(regels);
  const rijen = regels
    .map(
      (r) => `
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:16px;align-items:baseline;padding:9px 0;border-top:1px solid var(--line3)">
        <span style="color:var(--ink)">${escapeHtml(r.naam)}</span>
        <span style="color:var(--muted2);font-size:12px;width:90px;text-align:right">${escapeHtml(formatEUR(r.vorig))}</span>
        <span style="color:var(--ink);width:90px;text-align:right">${escapeHtml(formatEUR(r.waarde))}</span>
      </div>`,
    )
    .join("");
  return `
    <div class="card card-pad">
      <div style="font:600 16px 'Spectral',serif;color:var(--ink);margin-bottom:4px">Huurinkomen naar complex</div>
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:16px;font:600 10.5px 'IBM Plex Sans';letter-spacing:0.05em;text-transform:uppercase;color:var(--muted2);padding-bottom:4px">
        <span>Complex</span><span style="width:90px;text-align:right">Vorig jaar</span><span style="width:90px;text-align:right">Periode</span>
      </div>
      ${rijen}
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:16px;align-items:baseline;padding:11px 0 2px;border-top:2px solid var(--green);margin-top:4px">
        <span style="font-weight:700;color:var(--ink)">Totaal</span>
        <span style="font-weight:700;color:var(--muted2);font-size:12px;width:90px;text-align:right">${escapeHtml(formatEUR(totaal.totaalVorig))}</span>
        <span style="font-weight:700;color:var(--green);width:90px;text-align:right">${escapeHtml(formatEUR(totaal.totaal))}</span>
      </div>
    </div>`;
}

function renderBezettingsgraad(invoer: KerncijfersInvoer): string {
  const regels = invoer.bezettingPerComplex;
  if (regels === undefined || regels.length === 0) return "";
  const portefeuille = berekenBezettingsgraadPortefeuille(regels);
  const portefeuilleKleur = portefeuille.bezettingsgraad.type === "bekend" && portefeuille.bezettingsgraad.waarde.greaterThanOrEqualTo(99.9) ? "var(--green)" : GOUD;
  const portefeuilleTekst = portefeuille.bezettingsgraad.type === "bekend" ? escapeHtml(formatPercentage(portefeuille.bezettingsgraad.waarde)) : "–";

  const perComplex = regels
    .map((r) => {
      const bez = berekenBezettingsgraadPortefeuille([r]).bezettingsgraad;
      const kleur = bez.type === "bekend" && bez.waarde.greaterThanOrEqualTo(99.9) ? "var(--green)" : GOUD;
      const tekst = bez.type === "bekend" ? escapeHtml(formatPercentage(bez.waarde)) : "–";
      return `
        <div>
          <div style="font:500 12px 'IBM Plex Sans';letter-spacing:0.05em;text-transform:uppercase;color:var(--muted2)">${escapeHtml(r.complex)}</div>
          <div style="font:600 22px 'Spectral',serif;color:${kleur};margin-top:4px">${tekst}</div>
          <div style="font:400 11px 'IBM Plex Sans';color:var(--muted2)">${escapeHtml(r.verhuurdM2.toString())} / ${escapeHtml(r.totaalM2.toString())} m²</div>
        </div>`;
    })
    .join("");

  return `
    <div class="card card-pad" style="margin-top:18px">
      <div style="font:600 16px 'Spectral',serif;color:var(--ink);margin-bottom:16px">Bezettingsgraad</div>
      <div class="grid g4" style="gap:20px">
        <div>
          <div style="font:500 12px 'IBM Plex Sans';letter-spacing:0.05em;text-transform:uppercase;color:var(--muted2)">Portefeuille</div>
          <div style="font:600 30px 'Spectral',serif;color:${portefeuilleKleur};margin-top:4px">${portefeuilleTekst}</div>
          <div style="font:400 11px 'IBM Plex Sans';color:var(--muted2)">bezettingsgraad</div>
        </div>
        ${perComplex}
      </div>
    </div>`;
}

export function renderKerncijfersHtml(invoer: KerncijfersInvoer): string {
  const body = `
    <div class="sec-kicker">01 — Kerncijfers</div>
    <h2 class="sec-title" style="border-bottom:none;margin-top:7px">Overzicht</h2>
    ${renderKpiKaarten(invoer)}
    <div class="grid g2" style="margin-top:18px">
      ${renderKwartaalBalken(invoer)}
      ${renderHuurPerComplex(invoer)}
    </div>
    ${renderBezettingsgraad(invoer)}`;
  return renderRapportDocument(`Kerncijfers — ${invoer.portefeuilleNaam}`, renderCover(invoer), body);
}
