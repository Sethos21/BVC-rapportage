import type Decimal from "decimal.js";
import { escapeHtml, type PnLBronBijdrage, type PnLGroepBovenEbitda, type PnLVergelijking } from "@bvc/reporting";
import type { Begrotingsversie, VergelijkendeBegrotingsPnLRegel, VergelijkendeBegrotingsPnLResultaat } from "@bvc/begroting-data";
import type { AdministratieListItem } from "./administratie.js";
import { BOEKPERIODES } from "./serveUi.js";

/**
 * TRANCHE 11 — server-rendered HTML voor de begrotingsworkflow (`/begroting/...`), zelfde
 * bewuste stijl als `serveUi.ts`: geen client-side JavaScript, rekent en classificeert NIETS —
 * presenteert uitsluitend wat de aanroeper (`begrotingRoutes.ts`) al heeft opgehaald/berekend
 * via de bestaande rekenlaag. Dit is BEWUST GEEN 1-op-1 visuele implementatie van de
 * UX_01…UX_13-ontwerpen (die vereisen client-side interactie/JS-componenten die deze
 * lokale, JS-vrije server-shell niet biedt) — het volgt wel de VASTGESTELDE structuur en
 * volgorde uit `09_Begrotingsmodule_UX_Vastgesteld.md` §3/§10: tabelgerichte vergelijkende
 * P&L, progressive disclosure (detail pas na doorklikken), onbekend/leeg/bewust-€0 blijven
 * zichtbaar onderscheiden, gebruikerstaal in plaats van technische statuscodes. Zie het
 * acceptatierapport voor de expliciete, bewuste visuele-getrouwheidsbeperkingen.
 */

const BASIS_CSS = `
  :root{ --ink:#1c2521; --muted:#626b64; --green:#21594a; --red:#bf4a30; --amber:#8a6100; --paper:#f6f4ee; --line:#e6e4dc; }
  body{font-family:system-ui,'IBM Plex Sans',sans-serif;color:var(--ink);background:var(--paper);margin:0;padding:0}
  .wrap{max-width:980px;margin:40px auto;padding:0 24px}
  .wrap-smal{max-width:560px;margin:60px auto;padding:0 24px}
  .eyebrow{font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted)}
  h1{font-size:24px;margin:6px 0 4px}
  h2{font-size:16px;margin:28px 0 10px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:20px}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:24px;margin-bottom:20px}
  label{display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin:14px 0 6px}
  label:first-of-type{margin-top:0}
  select,input,textarea{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:14px;font-family:inherit}
  button{margin-top:20px;padding:9px 16px;border:none;border-radius:6px;background:var(--green);color:#fff;font-size:13.5px;font-weight:600;cursor:pointer}
  button.secundair{background:#fff;color:var(--ink);border:1px solid var(--line)}
  button:hover{opacity:0.92}
  .fouten{background:#fdecea;border:1px solid #f3c6bf;border-radius:8px;padding:12px 16px;margin-bottom:20px;color:var(--red)}
  .fouten ul{margin:4px 0 0;padding-left:18px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--line)}
  th:first-child,td:first-child{text-align:left}
  td{padding:7px 8px;border-bottom:1px solid #f0efe9;text-align:right;font-variant-numeric:tabular-nums}
  tr.groep td{background:#fbfaf6;font-weight:600;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0.04em}
  tr.subtotaal td{font-weight:700;border-top:1px solid var(--line)}
  .onbekend{color:var(--amber)}
  .naam{font-weight:600}
  .naam-sub{display:block;font-size:11px;color:var(--muted);font-weight:400}
  .bewerk{font-size:11px;color:var(--green);text-decoration:none}
  .banner{background:#eef5f1;border:1px solid #cfe3d8;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px}
  .banner.vastgesteld{background:#f3efe4;border-color:#e2d8bd}
  .terug{display:inline-block;margin-top:16px;color:var(--green);text-decoration:none;font-size:13.5px}
  .lijst{list-style:none;padding:0;margin:0}
  .lijst li{padding:8px 0;border-bottom:1px solid var(--line);font-size:13.5px;display:flex;justify-content:space-between}
  .lijst a{color:var(--green);text-decoration:none;font-weight:600}
`;

function paginaShell(titel: string, bodyHtml: string, breed = true): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(titel)}</title>
<style>${BASIS_CSS}</style>
</head>
<body>
<div class="${breed ? "wrap" : "wrap-smal"}">
${bodyHtml}
</div>
</body>
</html>`;
}

function fmtBedrag(d: Decimal): string {
  const negatief = d.isNegative();
  const [geheel, decimalen] = d.abs().toFixed(2).split(".");
  const geheelMetPunten = geheel!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (negatief ? "-€ " : "€ ") + geheelMetPunten + "," + decimalen;
}

function fmtWaarde(w: PnLBronBijdrage | null | undefined): string {
  if (w === null || w === undefined) return `<span class="onbekend">onbekend</span>`;
  if (w.status === "ONBEKEND") return `<span class="onbekend" title="${escapeHtml(w.toelichting)}">onbekend</span>`;
  return escapeHtml(fmtBedrag(w.bedrag));
}

function fmtVoorstel(v: VergelijkendeBegrotingsPnLRegel["voorstel"]): string {
  if (v.type === "HANDMATIG") return `<span class="naam-sub" style="display:inline">Handmatig opgebouwd</span>`;
  if (v.type === "ONBEKEND") return `<span class="onbekend">onbekend</span>`;
  return escapeHtml(fmtBedrag(v.bedrag));
}

const LABELS: Record<string, string> = {
  HUUROPBRENGST_BELAST: "Huuropbrengst belast",
  HUUROPBRENGST_ONBELAST: "Huuropbrengst onbelast",
  VERLEENDE_HUURKORTING: "Verleende huurkorting",
  HUUR_NIET_GECLASSIFICEERD: "Huur — niet geclassificeerd",
  BEHEERKOSTEN: "Beheersvergoeding",
  BEHEER_NIET_GECLASSIFICEERD: "Beheer — niet geclassificeerd",
  MANAGEMENTVERGOEDING: "Managementvergoeding",
  MANAGEMENT_NIET_GECLASSIFICEERD: "Management — niet geclassificeerd",
  ONDERHOUD: "Onderhoud (gepland + correctief/dagelijks)",
  ONDERHOUD_NIET_GECLASSIFICEERD: "Onderhoud — niet geclassificeerd",
  VERZEKERINGEN: "Verzekeringen",
  VERZEKERINGEN_NIET_GECLASSIFICEERD: "Verzekeringen — niet geclassificeerd",
  GEMEENTELIJKE_LASTEN: "Gemeentelijke lasten pand",
  GEMEENTELIJKE_LASTEN_NIET_GECLASSIFICEERD: "Gemeentelijke lasten — niet geclassificeerd",
  ACCOUNTANT: "Accountantkosten",
  JURIDISCHE_KOSTEN: "Juridische kosten",
  MAKELAARSKOSTEN: "Makelaar- en taxatiekosten",
  ALGEMENE_KOSTEN: "Overige algemene kosten",
  BANKKOSTEN: "Bankkosten",
  ALGEMENE_KOSTEN_NIET_GECLASSIFICEERD: "Algemene kosten — niet geclassificeerd",
  LEEGSTANDSKOSTEN: "Leegstandskosten",
  LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL: "Leegstandskosten — onderdeel onbekend",
  LEEGSTANDSKOSTEN_NIET_GECLASSIFICEERD: "Leegstandskosten — niet geclassificeerd",
  NIET_VERREKENBARE_BTW: "Niet verrekenbare btw",
  NIET_VERREKENBARE_BTW_NIET_GECLASSIFICEERD: "Niet verrekenbare btw — niet geclassificeerd",
  RENTEKOSTEN: "Rente leningen",
  RENTE_OPBRENGSTEN: "Opbrengst rente",
};

function label(regelSleutel: string): string {
  return LABELS[regelSleutel] ?? regelSleutel.charAt(0) + regelSleutel.slice(1).toLowerCase().replace(/_/g, " ");
}

const GROEP_LABELS: Record<PnLGroepBovenEbitda, string> = {
  OPBRENGSTEN: "Opbrengsten",
  MANAGEMENT_EN_BEHEER: "Management en beheer",
  EXPLOITATIE_LASTEN: "Exploitatie",
  ALGEMENE_KOSTEN: "Algemene kosten",
};

/** Modules met een in deze tranche gebouwde invoerpagina — alle andere posten zijn deze tranche alleen-lezen in de vergelijkende P&L. */
const BEWERKBARE_MODULES: Record<string, readonly { key: string; label: string }[]> = {
  HUUROPBRENGST_BELAST: [{ key: "huur", label: "Aanpassen" }],
  HUUROPBRENGST_ONBELAST: [{ key: "huur", label: "Aanpassen" }],
  VERLEENDE_HUURKORTING: [{ key: "huur", label: "Aanpassen" }],
  BEHEERKOSTEN: [{ key: "beheer", label: "Aanpassen" }],
  MANAGEMENTVERGOEDING: [{ key: "management", label: "Aanpassen" }],
  ONDERHOUD: [
    { key: "gepland-onderhoud", label: "Gepland onderhoud" },
    { key: "correctief", label: "Correctief/dagelijks" },
  ],
  VERZEKERINGEN: [{ key: "verzekeringen", label: "Aanpassen" }],
  GEMEENTELIJKE_LASTEN: [{ key: "gemeentelijke-lasten", label: "Aanpassen" }],
  ACCOUNTANT: [{ key: "algemene-kosten", label: "Aanpassen" }],
  JURIDISCHE_KOSTEN: [{ key: "algemene-kosten", label: "Aanpassen" }],
  MAKELAARSKOSTEN: [{ key: "algemene-kosten", label: "Aanpassen" }],
  ALGEMENE_KOSTEN: [{ key: "algemene-kosten", label: "Aanpassen" }],
  BANKKOSTEN: [{ key: "algemene-kosten", label: "Aanpassen" }],
  LEEGSTANDSKOSTEN: [{ key: "leegstand", label: "Aanpassen" }],
  NIET_VERREKENBARE_BTW: [{ key: "btw", label: "Aanpassen" }],
  RENTEKOSTEN: [{ key: "rente-leningen", label: "Aanpassen" }],
  RENTE_OPBRENGSTEN: [{ key: "rente-opbrengst", label: "Aanpassen" }],
};

export interface AdministratieKeuzeSchermOpties {
  fouten?: readonly string[];
  ingevoerd?: { administratieId?: string; begrotingsjaar?: string; laatstAfgeslotenBoekperiode?: string; indexatiePercentage?: string };
  bestaandeVersies?: readonly Begrotingsversie[];
}

export function renderBegrotingKeuzeScherm(administraties: readonly AdministratieListItem[], opties: AdministratieKeuzeSchermOpties = {}): string {
  const geselecteerd = opties.ingevoerd?.administratieId ?? "";
  const administratieOpties = administraties
    .map((a) => `<option value="${escapeHtml(a.administratieId)}"${a.administratieId === geselecteerd ? " selected" : ""}>${escapeHtml(a.weergavenaam)} (${escapeHtml(a.bedrijfsnr)})</option>`)
    .join("");
  const periodeOpties = BOEKPERIODES.map((p) => `<option value="${p.waarde}"${p.waarde === (opties.ingevoerd?.laatstAfgeslotenBoekperiode ?? "") ? " selected" : ""}>${escapeHtml(p.label)}</option>`).join("");

  const foutenHtml =
    opties.fouten && opties.fouten.length > 0
      ? `<div class="fouten"><strong>Controleer de invoer:</strong><ul>${opties.fouten.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>`
      : "";

  const bestaandeVersiesHtml =
    opties.bestaandeVersies !== undefined
      ? `<h2>Bestaande begrotingen voor deze administratie</h2><div class="card">${
          opties.bestaandeVersies.length === 0
            ? `<div class="sub">Nog geen begrotingsversie voor deze administratie.</div>`
            : `<ul class="lijst">${opties.bestaandeVersies
                .map(
                  (v) =>
                    `<li><span>${v.begrotingsjaar} — ${v.status === "VASTGESTELD" ? "Vastgesteld" : "Concept"}${v.naam ? ` — ${escapeHtml(v.naam)}` : ""}</span><a href="/begroting/${encodeURIComponent(geselecteerd)}/${encodeURIComponent(v.id)}">Openen →</a></li>`,
                )
                .join("")}</ul>`
        }</div>`
      : "";

  const body = `
    <div class="eyebrow">BVC Vastgoed Consultants — Exploitatiebegroting</div>
    <h1>Begroting kiezen of starten</h1>
    <div class="sub">Het exacte startscherm is nog niet als afzonderlijk UX-ontwerp vastgesteld (zie hoofdstuk 12 van de UX-vastgesteld-set) — dit is een minimale, functionele selectie op basis van de al bestaande administratieselectie.</div>
    <div class="card">
      ${foutenHtml}
      <form method="GET" action="/begroting">
        <label for="administratieId">Administratie</label>
        <select name="administratieId" id="administratieId" onchange="this.form.submit()">
          <option value="" disabled${geselecteerd ? "" : " selected"}>Kies een administratie…</option>
          ${administratieOpties}
        </select>
        <noscript><button type="submit" class="secundair">Administratie tonen</button></noscript>
      </form>
    </div>
    ${bestaandeVersiesHtml}
    ${
      geselecteerd
        ? `<h2>Nieuwe begroting starten</h2>
    <div class="card">
      <form method="POST" action="/begroting/nieuw">
        <input type="hidden" name="administratieId" value="${escapeHtml(geselecteerd)}" />
        <label for="begrotingsjaar">Begrotingsjaar (het jaar waarvoor je nu een begroting opstelt)</label>
        <input type="number" name="begrotingsjaar" id="begrotingsjaar" min="2000" max="2100" step="1" value="${escapeHtml(opties.ingevoerd?.begrotingsjaar ?? "")}" required />
        <label for="laatstAfgeslotenBoekperiode">Laatst afgesloten boekperiode van het huidige jaar (voor Werkelijk/Estimated)</label>
        <select name="laatstAfgeslotenBoekperiode" id="laatstAfgeslotenBoekperiode" required>
          <option value="" disabled${opties.ingevoerd?.laatstAfgeslotenBoekperiode ? "" : " selected"}>Kies een periode…</option>
          ${periodeOpties}
        </select>
        <label for="indexatiePercentage">Algemeen verwacht huurindexatiepercentage (UX §2/§4 — vooraf vastgesteld, geldt standaard voor alle contracten)</label>
        <input type="text" name="indexatiePercentage" id="indexatiePercentage" value="${escapeHtml(opties.ingevoerd?.indexatiePercentage ?? "")}" placeholder="bv. 3,0" required />
        <button type="submit">Nieuwe begroting starten</button>
      </form>
    </div>`
        : ""
    }`;
  return paginaShell("BVC Rapportage — Begroting", body);
}

export interface HoofdschermOpties {
  administratieId: string;
  weergavenaam: string;
  versie: Begrotingsversie;
  vergelijkend: VergelijkendeBegrotingsPnLResultaat;
  laatstAfgeslotenBoekperiode: string;
  melding?: string;
}

const GROEP_VOLGORDE: readonly PnLGroepBovenEbitda[] = ["OPBRENGSTEN", "MANAGEMENT_EN_BEHEER", "EXPLOITATIE_LASTEN", "ALGEMENE_KOSTEN"];

function regelRij(o: HoofdschermOpties, r: VergelijkendeBegrotingsPnLRegel): string {
  const moduleLinks = BEWERKBARE_MODULES[r.regelSleutel];
  const bewerkLinks =
    o.versie.status === "CONCEPT" && moduleLinks !== undefined
      ? moduleLinks
          .map(
            (m) =>
              `<a class="bewerk" href="/begroting/${encodeURIComponent(o.administratieId)}/${encodeURIComponent(o.versie.id)}/module/${m.key}?laatstAfgeslotenBoekperiode=${encodeURIComponent(o.laatstAfgeslotenBoekperiode)}">${escapeHtml(m.label)}</a>`,
          )
          .join(" · ")
      : "";
  return `<tr>
    <td><span class="naam">${escapeHtml(label(r.regelSleutel))}</span>${bewerkLinks ? `<span class="naam-sub">${bewerkLinks}</span>` : ""}</td>
    <td>${fmtWaarde(r.begrotingVorigJaar)}</td>
    <td>${fmtWaarde(r.werkelijk)}</td>
    <td>${fmtWaarde(r.estimated)}</td>
    <td>${fmtVoorstel(r.voorstel)}</td>
    <td>${fmtWaarde(r.jouwBegroting)}</td>
  </tr>`;
}

export function renderBegrotingHoofdscherm(o: HoofdschermOpties): string {
  const { vergelijkend } = o;
  const bovenRegels = vergelijkend.regels.filter((r) => r.boomPositie === "BOVEN_EBITDA");
  const onderRegels = vergelijkend.regels.filter((r) => r.boomPositie === "ONDER_EBITDA");

  const groepenHtml = GROEP_VOLGORDE.map((groep) => {
    const regels = bovenRegels.filter((r) => r.groep === groep);
    if (regels.length === 0) return "";
    return `<tr class="groep"><td colspan="6">${escapeHtml(GROEP_LABELS[groep])}</td></tr>${regels.map((r) => regelRij(o, r)).join("")}`;
  }).join("");

  const onderHtml = onderRegels.length > 0 ? `<tr class="groep"><td colspan="6">Onder EBITDA</td></tr>${onderRegels.map((r) => regelRij(o, r)).join("")}` : "";

  const ebitdaRij = (naam: string, resultaat: (typeof vergelijkend)["werkelijk"] | null) =>
    resultaat === null
      ? `<span class="onbekend">onbekend</span>`
      : resultaat.ebitda.volledigheid.status === "VOLLEDIG"
        ? fmtBedrag(resultaat.ebitda.bedrag)
        : `<span class="onbekend" title="Onvolledig: niet alle posten zijn bekend">${fmtBedrag(resultaat.ebitda.bedrag)} (onvolledig)</span>`;

  const statusBanner =
    o.versie.status === "VASTGESTELD"
      ? `<div class="banner vastgesteld"><strong>Vastgesteld</strong> op ${o.versie.vastgesteldAt ? o.versie.vastgesteldAt.toLocaleDateString("nl-NL") : "-"} — deze begroting is alleen-lezen (Terugkijken).</div>`
      : `<div class="banner">Concept — werk verder in de vergelijkende P&L hieronder. <a href="/begroting/${encodeURIComponent(o.administratieId)}/${encodeURIComponent(o.versie.id)}/controle?laatstAfgeslotenBoekperiode=${encodeURIComponent(o.laatstAfgeslotenBoekperiode)}">Naar controleren en vaststellen →</a></div>`;

  const meldingHtml = o.melding !== undefined ? `<div class="banner">${escapeHtml(o.melding)}</div>` : "";

  const body = `
    <div class="eyebrow">${escapeHtml(o.weergavenaam)} — Begroting ${o.versie.begrotingsjaar}</div>
    <h1>Vergelijkende exploitatiebegroting</h1>
    <div class="sub">Werkelijk/Estimated: ${o.versie.begrotingsjaar - 1} t/m periode ${escapeHtml(o.laatstAfgeslotenBoekperiode)}. Bron: productieboekingen + de bestaande, bewezen GL/OGB-bronmapping — geen testdata.</div>
    ${meldingHtml}
    ${statusBanner}
    <div class="card">
      <table>
        <thead><tr><th>Onderdeel</th><th>Begroting ${o.versie.begrotingsjaar - 1}</th><th>Werkelijk ${o.versie.begrotingsjaar - 1}</th><th>Estimated ${o.versie.begrotingsjaar - 1}</th><th>Voorstel ${o.versie.begrotingsjaar}</th><th>Jouw begroting ${o.versie.begrotingsjaar}</th></tr></thead>
        <tbody>
          ${groepenHtml}
          <tr class="subtotaal"><td>EBITDA (bedrijfsresultaat)</td><td>${ebitdaRij("vorig", vergelijkend.begrotingVorigJaar)}</td><td>${ebitdaRij("werkelijk", vergelijkend.werkelijk)}</td><td>${ebitdaRij("estimated", vergelijkend.estimated)}</td><td>—</td><td>${ebitdaRij("nieuw", vergelijkend.jouwBegroting)}</td></tr>
          ${onderHtml}
        </tbody>
      </table>
    </div>
    <a class="terug" href="/begroting">← Terug naar begrotingskeuze</a>`;
  return paginaShell(`Begroting ${o.versie.begrotingsjaar} — ${o.weergavenaam}`, body);
}

export function renderControlePagina(o: { administratieId: string; weergavenaam: string; versie: Begrotingsversie; laatstAfgeslotenBoekperiode: string; vergelijking: PnLVergelijking | null; vaststelFout?: string }): string {
  const rij = (naam: string, v: PnLVergelijking["ebitda"]) =>
    `<tr><td>${escapeHtml(naam)}</td><td>${fmtBedrag(v.basis)}</td><td>${fmtBedrag(v.vergelijk)}</td><td>${fmtBedrag(v.afwijking)}</td><td>${v.volledigheid.status === "VOLLEDIG" ? "Volledig" : "Onvolledig"}</td></tr>`;
  const vergelijkingHtml =
    o.vergelijking === null
      ? `<div class="card"><div class="sub">Er bestaat nog geen vastgestelde begroting voor ${o.versie.begrotingsjaar - 1} — Estimated (en daarmee deze vergelijking) is nog niet beschikbaar. Dit blokkeert het opstellen van Jouw begroting niet.</div></div>`
      : `<div class="card">
      <table>
        <thead><tr><th>Post</th><th>Estimated ${o.versie.begrotingsjaar - 1}</th><th>Jouw begroting ${o.versie.begrotingsjaar}</th><th>Verschil</th><th>Volledigheid</th></tr></thead>
        <tbody>
          ${rij("Totaal opbrengsten", o.vergelijking.totaalOpbrengsten)}
          ${rij("Management en beheer", o.vergelijking.managementEnBeheer)}
          ${rij("Exploitatie lasten", o.vergelijking.exploitatieLasten)}
          ${rij("Algemene kosten", o.vergelijking.algemeneKosten)}
          ${rij("Totaal kosten", o.vergelijking.totaalKosten)}
          <tr class="subtotaal">${rij("EBITDA", o.vergelijking.ebitda).replace("<tr>", "").replace("</tr>", "")}</tr>
        </tbody>
      </table>
    </div>`;
  const body = `
    <div class="eyebrow">${escapeHtml(o.weergavenaam)} — Begroting ${o.versie.begrotingsjaar}</div>
    <h1>Controleren en vaststellen</h1>
    <div class="sub">Vergelijking van Jouw begroting ${o.versie.begrotingsjaar} met Estimated ${o.versie.begrotingsjaar - 1}.</div>
    ${o.vaststelFout !== undefined ? `<div class="fouten"><strong>Vaststellen kan nog niet:</strong> ${escapeHtml(o.vaststelFout)}</div>` : ""}
    ${vergelijkingHtml}
    <div class="card">
      <form method="POST" action="/begroting/${encodeURIComponent(o.administratieId)}/${encodeURIComponent(o.versie.id)}/vaststellen">
        <label><input type="checkbox" name="bevestigd" value="1" style="width:auto;display:inline-block;margin-right:8px" required />Ik bevestig dat ik deze begroting voor ${o.versie.begrotingsjaar} definitief wil vaststellen. Na vaststellen is de begroting alleen-lezen.</label>
        <label for="toelichting">Toelichting (optioneel)</label>
        <textarea name="toelichting" id="toelichting" rows="3"></textarea>
        <button type="submit">Definitief vaststellen</button>
      </form>
    </div>
    <a class="terug" href="/begroting/${encodeURIComponent(o.administratieId)}/${encodeURIComponent(o.versie.id)}?laatstAfgeslotenBoekperiode=${encodeURIComponent(o.laatstAfgeslotenBoekperiode)}">← Terug naar de vergelijkende P&L</a>`;
  return paginaShell(`Controleren — Begroting ${o.versie.begrotingsjaar}`, body);
}

export function renderFoutPagina(titel: string, bericht: string, terugUrl = "/begroting"): string {
  const body = `
    <div class="eyebrow">BVC Vastgoed Consultants</div>
    <h1>${escapeHtml(titel)}</h1>
    <div class="card">
      <div class="fouten">${escapeHtml(bericht)}</div>
      <a class="terug" href="${escapeHtml(terugUrl)}">← Terug</a>
    </div>`;
  return paginaShell(titel, body, false);
}

function moduleFormShell(o: { titel: string; terugUrl: string; fouten?: readonly string[]; inhoud: string }): string {
  const foutenHtml =
    o.fouten && o.fouten.length > 0 ? `<div class="fouten"><strong>Controleer de invoer:</strong><ul>${o.fouten.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>` : "";
  const body = `
    <div class="eyebrow">Begrotingsonderdeel aanpassen</div>
    <h1>${escapeHtml(o.titel)}</h1>
    ${foutenHtml}
    <div class="card">${o.inhoud}</div>
    <a class="terug" href="${escapeHtml(o.terugUrl)}">← Terug naar de vergelijkende P&L</a>`;
  return paginaShell(o.titel, body, false);
}

const geldWaarde = (d: Decimal | null): string => (d === null ? "" : d.toString());

export interface ManagementFormOpties {
  actieUrl: string;
  terugUrl: string;
  fouten?: readonly string[];
  huidig: { wijze: string; bedrag: string; eenheid: string; ingangsdatum: string; bestaandBedrag: string; bestaandEenheid: string; indexatiePercentage: string; indexatiedatum: string; nieuwBedrag: string; nieuweEenheid: string };
}

export function renderManagementForm(o: ManagementFormOpties): string {
  const eenheidOpties = (naam: string, huidig: string) => `<select name="${naam}"><option value="MAAND"${huidig === "MAAND" ? " selected" : ""}>per maand</option><option value="JAAR"${huidig === "JAAR" ? " selected" : ""}>per jaar</option></select>`;
  const inhoud = `
    <p class="sub">Kies precies één van de drie situaties (UX_03) en vul uitsluitend de bijbehorende velden in.</p>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <label><input type="radio" name="wijze" value="NIEUWE_VERGOEDING" style="width:auto;display:inline-block;margin-right:8px"${o.huidig.wijze === "NIEUWE_VERGOEDING" ? " checked" : ""} />1. Nieuwe vergoeding (vóór ingangsdatum werkelijk €0)</label>
      <label for="bedrag">Bedrag</label><input type="text" name="bedrag" id="bedrag" value="${escapeHtml(o.huidig.bedrag)}" placeholder="bv. 500,00" />
      <label for="eenheid">Eenheid</label>${eenheidOpties("eenheid", o.huidig.eenheid)}
      <label for="ingangsdatum">Ingangsdatum (leeg = vanaf januari)</label><input type="date" name="ingangsdatum" id="ingangsdatum" value="${escapeHtml(o.huidig.ingangsdatum)}" />

      <label style="margin-top:24px"><input type="radio" name="wijze" value="INDEXEER_BESTAAND" style="width:auto;display:inline-block;margin-right:8px"${o.huidig.wijze === "INDEXEER_BESTAAND" ? " checked" : ""} />2. Bestaand bedrag indexeren</label>
      <label for="bestaandBedrag">Bestaand bedrag</label><input type="text" name="bestaandBedrag" id="bestaandBedrag" value="${escapeHtml(o.huidig.bestaandBedrag)}" />
      <label for="bestaandEenheid">Eenheid bestaand bedrag</label>${eenheidOpties("bestaandEenheid", o.huidig.bestaandEenheid)}
      <label for="indexatiePercentage">Indexatiepercentage</label><input type="text" name="indexatiePercentage" id="indexatiePercentage" value="${escapeHtml(o.huidig.indexatiePercentage)}" />
      <label for="indexatiedatum">Indexatiedatum</label><input type="date" name="indexatiedatum" id="indexatiedatum" value="${escapeHtml(o.huidig.indexatiedatum)}" />

      <label style="margin-top:24px"><input type="radio" name="wijze" value="WIJZIG_BESTAAND_BEDRAG" style="width:auto;display:inline-block;margin-right:8px"${o.huidig.wijze === "WIJZIG_BESTAAND_BEDRAG" ? " checked" : ""} />3. Bestaand bedrag vanaf een datum vervangen</label>
      <label for="nieuwBedrag">Nieuw bedrag</label><input type="text" name="nieuwBedrag" id="nieuwBedrag" value="${escapeHtml(o.huidig.nieuwBedrag)}" />
      <label for="nieuweEenheid">Eenheid nieuw bedrag</label>${eenheidOpties("nieuweEenheid", o.huidig.nieuweEenheid)}

      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Managementvergoeding", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud });
}

export interface CorrectiefRegelRow {
  id: number | null;
  omschrijving: string;
  complexnummer: string;
  grootboekrekening: string;
  ogbKostensoort: string;
  jaarbedrag: string;
}

export function renderCorrectiefForm(o: { actieUrl: string; terugUrl: string; fouten?: readonly string[]; regels: readonly CorrectiefRegelRow[]; beoordeeld: boolean }): string {
  const rijen = [...o.regels, ...Array.from({ length: Math.max(0, 6 - o.regels.length) }, (): CorrectiefRegelRow => ({ id: null, omschrijving: "", complexnummer: "", grootboekrekening: "", ogbKostensoort: "", jaarbedrag: "" }))];
  const rijHtml = (r: CorrectiefRegelRow, i: number) => `
    <tr>
      <td><input type="hidden" name="id_${i}" value="${r.id ?? ""}" /><input type="text" name="omschrijving_${i}" value="${escapeHtml(r.omschrijving)}" placeholder="Omschrijving" /></td>
      <td><input type="text" name="complexnummer_${i}" value="${escapeHtml(r.complexnummer)}" placeholder="NTB" /></td>
      <td><input type="text" name="grootboekrekening_${i}" value="${escapeHtml(r.grootboekrekening)}" placeholder="GL" /></td>
      <td><input type="text" name="ogbKostensoort_${i}" value="${escapeHtml(r.ogbKostensoort)}" placeholder="optioneel" /></td>
      <td><input type="text" name="jaarbedrag_${i}" value="${escapeHtml(r.jaarbedrag)}" placeholder="0,00" /></td>
    </tr>`;
  const inhoud = `
    <p class="sub">Een lege regel (geen omschrijving én geen bedrag) wordt genegeerd. Bewust nul regels + beoordeeld = een bewuste €0-begroting.</p>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Omschrijving</th><th style="text-align:left">Complex</th><th style="text-align:left">Grootboek</th><th style="text-align:left">OGB</th><th style="text-align:left">Jaarbedrag</th></tr></thead>
        <tbody>${rijen.map(rijHtml).join("")}</tbody>
      </table>
      <label><input type="checkbox" name="beoordeeld" value="1" style="width:auto;display:inline-block;margin-right:8px"${o.beoordeeld ? " checked" : ""} />Ik heb dit onderdeel beoordeeld</label>
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Correctief / dagelijks onderhoud", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud });
}

export function renderBtwForm(o: {
  actieUrl: string;
  terugUrl: string;
  fouten?: readonly string[];
  regels: readonly { id: number | null; omschrijving: string; complexnummer: string; jaarbedrag: string }[];
  beoordeeld: boolean;
  resterendeVerwachting: string;
}): string {
  const rijen = [...o.regels, ...Array.from({ length: Math.max(0, 4 - o.regels.length) }, () => ({ id: null as number | null, omschrijving: "", complexnummer: "", jaarbedrag: "" }))];
  const rijHtml = (r: (typeof rijen)[number], i: number) => `
    <tr>
      <td><input type="hidden" name="id_${i}" value="${r.id ?? ""}" /><input type="text" name="omschrijving_${i}" value="${escapeHtml(r.omschrijving)}" placeholder="Omschrijving" /></td>
      <td><input type="text" name="complexnummer_${i}" value="${escapeHtml(r.complexnummer)}" placeholder="optioneel" /></td>
      <td><input type="text" name="jaarbedrag_${i}" value="${escapeHtml(r.jaarbedrag)}" placeholder="0,00" /></td>
    </tr>`;
  const inhoud = `
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Omschrijving</th><th style="text-align:left">Complex</th><th style="text-align:left">Jaarbedrag</th></tr></thead>
        <tbody>${rijen.map(rijHtml).join("")}</tbody>
      </table>
      <label><input type="checkbox" name="beoordeeld" value="1" style="width:auto;display:inline-block;margin-right:8px"${o.beoordeeld ? " checked" : ""} />Ik heb dit onderdeel beoordeeld</label>
      <label for="resterendeVerwachting">Estimated — verwachting resterend jaar (leeg = onbekend, 0 = geen verdere verwachting)</label>
      <input type="text" name="resterendeVerwachting" id="resterendeVerwachting" value="${escapeHtml(o.resterendeVerwachting)}" />
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Niet verrekenbare btw", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud });
}

export function renderRenteForm(o: { categorie: "RENTEKOSTEN" | "RENTE_OPBRENGSTEN"; actieUrl: string; terugUrl: string; fouten?: readonly string[]; begrotingsbedrag: string; beoordeeld: boolean; resterendeVerwachting: string }): string {
  const isOpbrengst = o.categorie === "RENTE_OPBRENGSTEN";
  const toelichting = isOpbrengst
    ? `<p class="sub">Voer het verwachte bedrag als POSITIEF bedrag in — de vertaling naar de interne boekhoudconventie gebeurt automatisch.</p>`
    : `<p class="sub">Eén jaarbedrag op moduleniveau — geen leningadministratie of automatische renteberekening (Tranche 10).</p>`;
  const inhoud = `
    ${toelichting}
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <label for="begrotingsbedrag">Begroting — jaarbedrag${isOpbrengst ? " (positief)" : ""}</label>
      <input type="text" name="begrotingsbedrag" id="begrotingsbedrag" value="${escapeHtml(o.begrotingsbedrag)}" placeholder="0,00" />
      <label><input type="checkbox" name="beoordeeld" value="1" style="width:auto;display:inline-block;margin-right:8px"${o.beoordeeld ? " checked" : ""} />Ik heb dit onderdeel beoordeeld</label>
      <label for="resterendeVerwachting">Estimated — verwachting resterend jaar${isOpbrengst ? " (positief)" : ""} (leeg = onbekend, 0 = geen verdere verwachting)</label>
      <input type="text" name="resterendeVerwachting" id="resterendeVerwachting" value="${escapeHtml(o.resterendeVerwachting)}" />
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: isOpbrengst ? "Opbrengst rente" : "Rente leningen", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud });
}

export interface HuurDetailRegel {
  contractnummer: string;
  huurderNaam: string | null;
  complexnummer: string | null;
  belastOnbelast: string;
  indexatiePercentageGebruikt: string;
  indexatiePercentageBron: "ALGEMEEN" | "OVERRIDE";
  effectieveIndexatiedatum: string | null;
  bruto: string;
  korting: string;
  netto: string;
  overrideWaarde: string;
}

/**
 * Huur-detailweergave (UX_01, Tranche 12): toont de bewezen contractbasis per contract —
 * bronhuur/indexatie/override/resulterende huur/korting blijven zichtbaar onderscheiden zodat
 * later herleidbaar blijft hoe het bedrag is ontstaan (§10). Rekent zelf niets — alle bedragen
 * komen kant-en-klaar van de aanroeper (de bestaande, ongewijzigde pure Huur-motor).
 */
export function renderHuurDetail(o: {
  administratieId: string;
  versieId: string;
  terugUrl: string;
  actieUrl: string;
  begrotingsjaar: number;
  alleenLezen: boolean;
  algemeenIndexatiePercentage: string;
  regels: readonly HuurDetailRegel[];
  controleVereist: readonly string[];
  portefeuilleNetto: string;
}): string {
  const waarschuwingenHtml = o.controleVereist.length > 0 ? `<div class="banner">${o.controleVereist.map(escapeHtml).join("<br/>")}</div>` : "";
  const rijenHtml = o.regels
    .map(
      (r) => `<tr>
      <td><span class="naam">${escapeHtml(r.contractnummer)}</span><span class="naam-sub">${escapeHtml(r.huurderNaam ?? "onbekende huurder")} · complex ${escapeHtml(r.complexnummer ?? "-")}</span></td>
      <td>${escapeHtml(r.belastOnbelast)}</td>
      <td>${escapeHtml(r.indexatiePercentageGebruikt)}% (${r.indexatiePercentageBron === "OVERRIDE" ? "override" : "algemeen"})</td>
      <td>${r.effectieveIndexatiedatum ? escapeHtml(r.effectieveIndexatiedatum) : "-"}</td>
      <td>${escapeHtml(r.bruto)}</td>
      <td>${escapeHtml(r.korting)}</td>
      <td>${escapeHtml(r.netto)}</td>
      <td>${o.alleenLezen ? escapeHtml(r.overrideWaarde || "-") : `<input type="text" name="override_${escapeHtml(r.contractnummer)}" value="${escapeHtml(r.overrideWaarde)}" placeholder="algemeen" style="width:70px" />`}</td>
    </tr>`,
    )
    .join("");
  const inhoud = `
    ${waarschuwingenHtml}
    <div class="sub">Algemeen indexatiepercentage voor ${o.begrotingsjaar}: ${escapeHtml(o.algemeenIndexatiePercentage)}%. Een contractoverride vervangt uitsluitend het toegepaste percentage voor dat contract — de bronfeiten blijven ongewijzigd.</div>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Contract</th><th>Belast/onbelast</th><th>Indexatie</th><th>Ingangsdatum indexatie</th><th>Bruto</th><th>Korting</th><th>Netto</th><th>Override %</th></tr></thead>
        <tbody>${rijenHtml}</tbody>
      </table>
      <p class="sub">Netto huur portefeuille (Jouw begroting): <strong>${escapeHtml(o.portefeuilleNetto)}</strong></p>
      ${o.alleenLezen ? "" : `<button type="submit">Overrides opslaan</button>`}
    </form>`;
  return moduleFormShell({ titel: `Huur — contractbasis ${o.begrotingsjaar}`, terugUrl: o.terugUrl, inhoud });
}

export interface BeheerDetailRegel {
  complexnummer: string;
  vastToegepast: boolean;
  variabelToegepast: boolean;
  variabelPercentageGebruikt: string | null;
  nettoHuurGrondslag: string;
  vastNaIndexatie: string;
  variabeleVergoeding: string;
  totaleVergoeding: string;
  vastBedragJaarInvoer: string;
  vastIndexatiePercentageInvoer: string;
  vastIndexatiedatumInvoer: string;
  variabelPercentageInvoer: string;
}

/** Beheersvergoeding-detailweergave (UX_02, Tranche 12): vast/variabel apart zichtbaar, variabele grondslag = de nieuwe, contract-afgeleide netto huur uit Module 1. */
export function renderBeheerDetail(o: {
  terugUrl: string;
  actieUrl: string;
  alleenLezen: boolean;
  regels: readonly BeheerDetailRegel[];
  controleVereist: readonly string[];
  portefeuilleTotaal: string;
}): string {
  const waarschuwingenHtml = o.controleVereist.length > 0 ? `<div class="banner">${o.controleVereist.map(escapeHtml).join("<br/>")}</div>` : "";
  const rijenHtml = o.regels
    .map((r, i) =>
      o.alleenLezen
        ? `<tr>
      <td class="naam">${escapeHtml(r.complexnummer)}</td>
      <td>${r.vastToegepast ? escapeHtml(r.vastNaIndexatie) : "-"}</td>
      <td>${r.variabelToegepast ? `${escapeHtml(r.variabelPercentageGebruikt ?? "-")}% × ${escapeHtml(r.nettoHuurGrondslag)}` : "-"}</td>
      <td>${escapeHtml(r.totaleVergoeding)}</td>
    </tr>`
        : `<tr>
      <td class="naam">${escapeHtml(r.complexnummer)}</td>
      <td><input type="hidden" name="complexnummer_${i}" value="${escapeHtml(r.complexnummer)}" /><input type="text" name="vastBedrag_${i}" value="${escapeHtml(r.vastBedragJaarInvoer)}" placeholder="geen vast deel" style="width:90px" /></td>
      <td><input type="text" name="vastIndex_${i}" value="${escapeHtml(r.vastIndexatiePercentageInvoer)}" placeholder="%" style="width:50px" /></td>
      <td><input type="date" name="vastIndexDatum_${i}" value="${escapeHtml(r.vastIndexatiedatumInvoer)}" style="width:130px" /></td>
      <td><input type="text" name="variabelPercentage_${i}" value="${escapeHtml(r.variabelPercentageInvoer)}" placeholder="geen variabel deel" style="width:70px" /> × ${escapeHtml(r.nettoHuurGrondslag)}</td>
      <td>${escapeHtml(r.totaleVergoeding)}</td>
    </tr>`,
    )
    .join("");
  const inhoud = `
    ${waarschuwingenHtml}
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Complex</th><th>Vast bedrag/jaar</th>${o.alleenLezen ? "" : "<th>Vast index %</th><th>Vast indexatiedatum</th>"}<th>Variabel % × netto huurgrondslag</th><th>Totaal</th></tr></thead>
        <tbody>${rijenHtml}</tbody>
      </table>
      <p class="sub">Totale beheersvergoeding portefeuille: <strong>${escapeHtml(o.portefeuilleTotaal)}</strong></p>
      ${o.alleenLezen ? "" : `<button type="submit">Configuratie opslaan</button>`}
    </form>`;
  return moduleFormShell({ titel: "Beheersvergoeding", terugUrl: o.terugUrl, inhoud });
}

function beoordeeldCheckbox(naam: string, aangevinkt: boolean): string {
  return `<label><input type="checkbox" name="${naam}" value="1" style="width:auto;display:inline-block;margin-right:8px"${aangevinkt ? " checked" : ""} />Ik heb dit onderdeel beoordeeld</label>`;
}

export interface LeegstandCategorieOpties {
  categorie: string;
  titel: string;
  beoordeeld: boolean;
  regels: readonly { id: number | null; complexnummer: string; omschrijving: string; q1: string; q2: string; q3: string; q4: string }[];
}

/** Leegstandskosten (UX/OB-031, Tranche 13): drie categorieën, elk dezelfde compacte structuur Complex|Omschrijving|Q1-Q4. */
export function renderLeegstandForm(o: { actieUrl: string; terugUrl: string; fouten?: readonly string[]; categorieen: readonly LeegstandCategorieOpties[]; portefeuilleTotaal: string }): string {
  const sectie = (c: LeegstandCategorieOpties, prefix: string) => {
    const rijen = [...c.regels, ...Array.from({ length: Math.max(0, 4 - c.regels.length) }, () => ({ id: null, complexnummer: "", omschrijving: "", q1: "", q2: "", q3: "", q4: "" }))];
    return `<h2>${escapeHtml(c.titel)}</h2>
      <table style="margin-bottom:10px">
        <thead><tr><th style="text-align:left">Complex</th><th style="text-align:left">Omschrijving</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th></tr></thead>
        <tbody>${rijen
          .map(
            (r, i) => `<tr>
          <td><input type="hidden" name="${prefix}_id_${i}" value="${r.id ?? ""}" /><input type="text" name="${prefix}_complex_${i}" value="${escapeHtml(r.complexnummer)}" placeholder="optioneel" style="width:80px" /></td>
          <td><input type="text" name="${prefix}_omschrijving_${i}" value="${escapeHtml(r.omschrijving)}" /></td>
          <td><input type="text" name="${prefix}_q1_${i}" value="${escapeHtml(r.q1)}" style="width:70px" /></td>
          <td><input type="text" name="${prefix}_q2_${i}" value="${escapeHtml(r.q2)}" style="width:70px" /></td>
          <td><input type="text" name="${prefix}_q3_${i}" value="${escapeHtml(r.q3)}" style="width:70px" /></td>
          <td><input type="text" name="${prefix}_q4_${i}" value="${escapeHtml(r.q4)}" style="width:70px" /></td>
        </tr>`,
          )
          .join("")}</tbody>
      </table>
      ${beoordeeldCheckbox(`${prefix}_beoordeeld`, c.beoordeeld)}`;
  };
  const inhoud = `
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      ${sectie(o.categorieen[0]!, "nuts")}
      ${sectie(o.categorieen[1]!, "service")}
      ${sectie(o.categorieen[2]!, "overige")}
      <p class="sub">Totaal Leegstandskosten (Jouw begroting): <strong>${escapeHtml(o.portefeuilleTotaal)}</strong></p>
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Leegstandskosten", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud });
}

export interface AlgemeneKostenCategorieOpties {
  categorie: string;
  titel: string;
  beoordeeld: boolean;
  vorigJaarBedrag: string;
  verwachteVerhogingPercentage: string;
  toonVoorstelVelden: boolean;
  regels: readonly { id: number | null; omschrijving: string; complexnummer: string; ogbKostensoortCode: string; jaarbedrag: string }[];
}

/** Algemene kosten (OB-035/036, Tranche 13): vijf categorieën, elk dezelfde regelvorm (Omschrijving|Complex|OGB|Jaarbedrag); Accountant/Bank tonen aanvullend het informatieve vorig-jaar/verwachte-verhoging-voorstel. */
export function renderAlgemeneKostenForm(o: { actieUrl: string; terugUrl: string; fouten?: readonly string[]; categorieen: readonly AlgemeneKostenCategorieOpties[]; portefeuilleTotaal: string }): string {
  const sectie = (c: AlgemeneKostenCategorieOpties, prefix: string) => {
    const rijen = [...c.regels, ...Array.from({ length: Math.max(0, 3 - c.regels.length) }, () => ({ id: null, omschrijving: "", complexnummer: "", ogbKostensoortCode: "", jaarbedrag: "" }))];
    const voorstelHtml = c.toonVoorstelVelden
      ? `<p class="sub">Voorstel (informatief): vorig jaar <input type="text" name="${prefix}_vorigJaar" value="${escapeHtml(c.vorigJaarBedrag)}" style="width:90px;display:inline-block" /> + verwachte verhoging <input type="text" name="${prefix}_verhoging" value="${escapeHtml(c.verwachteVerhogingPercentage)}" style="width:60px;display:inline-block" />%</p>`
      : "";
    return `<h2>${escapeHtml(c.titel)}</h2>
      ${voorstelHtml}
      <table style="margin-bottom:10px">
        <thead><tr><th style="text-align:left">Omschrijving</th><th style="text-align:left">Complex</th><th style="text-align:left">OGB</th><th style="text-align:left">Jaarbedrag</th></tr></thead>
        <tbody>${rijen
          .map(
            (r, i) => `<tr>
          <td><input type="hidden" name="${prefix}_id_${i}" value="${r.id ?? ""}" /><input type="text" name="${prefix}_omschrijving_${i}" value="${escapeHtml(r.omschrijving)}" /></td>
          <td><input type="text" name="${prefix}_complex_${i}" value="${escapeHtml(r.complexnummer)}" placeholder="optioneel" style="width:80px" /></td>
          <td><input type="text" name="${prefix}_ogb_${i}" value="${escapeHtml(r.ogbKostensoortCode)}" placeholder="optioneel" style="width:70px" /></td>
          <td><input type="text" name="${prefix}_jaarbedrag_${i}" value="${escapeHtml(r.jaarbedrag)}" style="width:90px" /></td>
        </tr>`,
          )
          .join("")}</tbody>
      </table>
      ${beoordeeldCheckbox(`${prefix}_beoordeeld`, c.beoordeeld)}`;
  };
  const prefixen = ["accountant", "juridisch", "makelaar", "algemeen", "bank"];
  const inhoud = `
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      ${o.categorieen.map((c, i) => sectie(c, prefixen[i]!)).join("<hr style=\"border:none;border-top:1px solid var(--line);margin:20px 0\" />")}
      <p class="sub">Totaal Algemene kosten (Jouw begroting): <strong>${escapeHtml(o.portefeuilleTotaal)}</strong></p>
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Algemene kosten", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud });
}

export interface VerzekeringRegelVeld {
  id: number | null;
  complexnummer: string;
  verzekeraar: string;
  grootboekrekening: string;
  ogbKostensoort: string;
  ingangsdatum: string;
  looptijdMaanden: string;
  bedrag: string;
  indexPercentage: string;
  handmatigBegrootOverride: string;
}

/** Verzekeringen (UX_06, Tranche 13): compacte polisregels Complex|Verzekeraar|Ingangsdatum|Looptijd|Bedrag|Index%|GL|OGB|Override. */
export function renderVerzekeringenForm(o: { actieUrl: string; terugUrl: string; fouten?: readonly string[]; regels: readonly VerzekeringRegelVeld[]; beoordeeld: boolean; portefeuilleTotaal: string }): string {
  const rijen = [...o.regels, ...Array.from({ length: Math.max(0, 6 - o.regels.length) }, (): VerzekeringRegelVeld => ({ id: null, complexnummer: "", verzekeraar: "", grootboekrekening: "", ogbKostensoort: "", ingangsdatum: "", looptijdMaanden: "", bedrag: "", indexPercentage: "", handmatigBegrootOverride: "" }))];
  const rijHtml = (r: VerzekeringRegelVeld, i: number) => `
    <tr>
      <td><input type="hidden" name="id_${i}" value="${r.id ?? ""}" /><input type="text" name="complex_${i}" value="${escapeHtml(r.complexnummer)}" style="width:70px" /></td>
      <td><input type="text" name="verzekeraar_${i}" value="${escapeHtml(r.verzekeraar)}" style="width:110px" /></td>
      <td><input type="text" name="grootboekrekening_${i}" value="${escapeHtml(r.grootboekrekening)}" style="width:60px" /></td>
      <td><input type="text" name="ogb_${i}" value="${escapeHtml(r.ogbKostensoort)}" placeholder="optioneel" style="width:60px" /></td>
      <td><input type="date" name="ingangsdatum_${i}" value="${escapeHtml(r.ingangsdatum)}" style="width:130px" /></td>
      <td><input type="text" name="looptijd_${i}" value="${escapeHtml(r.looptijdMaanden)}" style="width:50px" /></td>
      <td><input type="text" name="bedrag_${i}" value="${escapeHtml(r.bedrag)}" style="width:80px" /></td>
      <td><input type="text" name="index_${i}" value="${escapeHtml(r.indexPercentage)}" style="width:50px" /></td>
      <td><input type="text" name="override_${i}" value="${escapeHtml(r.handmatigBegrootOverride)}" placeholder="berekend" style="width:80px" /></td>
    </tr>`;
  const inhoud = `
    <p class="sub">Override laat het berekende voorstel (huidige premie × indexatie) staan tenzij ingevuld.</p>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Complex</th><th style="text-align:left">Verzekeraar</th><th style="text-align:left">GL</th><th style="text-align:left">OGB</th><th>Ingangsdatum</th><th>Looptijd (mnd)</th><th>Jaarpremie</th><th>Index %</th><th>Override</th></tr></thead>
        <tbody>${rijen.map(rijHtml).join("")}</tbody>
      </table>
      ${beoordeeldCheckbox("beoordeeld", o.beoordeeld)}
      <p class="sub">Totaal Verzekeringen (Jouw begroting): <strong>${escapeHtml(o.portefeuilleTotaal)}</strong></p>
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Verzekeringen", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud });
}

export interface GeplandOnderhoudRegelVeld {
  id: number | null;
  complexnummer: string;
  omschrijving: string;
  grootboekrekening: string;
  ogbKostensoort: string;
  aanleidingType: string;
  aanleidingToelichting: string;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  status: string;
  leverancier: string;
  offertebedrag: string;
  notitie: string;
}

const AANLEIDING_OPTIES = ["MJOP", "INSPECTIE", "OFFERTE", "OVERIG"];
const STATUS_OPTIES = ["GEPLAND", "IN_UITVOERING", "UITGESTELD", "VERVALLEN", "AFGEROND", "ONVOORZIEN"];

/** Gepland onderhoud (UX_04, Tranche 13): handmatige activiteiten per complex, Q1-Q4, bron/status. Werkelijk/Estimated bestaan uitsluitend op Onderhoud-totaalniveau (§16/§17) — hier bewust niet per activiteit getoond. */
export function renderGeplandOnderhoudForm(o: {
  actieUrl: string;
  terugUrl: string;
  fouten?: readonly string[];
  regels: readonly GeplandOnderhoudRegelVeld[];
  beoordeeld: boolean;
  jaartotaal: string;
}): string {
  const leeg = (): GeplandOnderhoudRegelVeld => ({ id: null, complexnummer: "", omschrijving: "", grootboekrekening: "", ogbKostensoort: "", aanleidingType: "", aanleidingToelichting: "", q1: "", q2: "", q3: "", q4: "", status: "GEPLAND", leverancier: "", offertebedrag: "", notitie: "" });
  const rijen = [...o.regels, ...Array.from({ length: Math.max(0, 5 - o.regels.length) }, leeg)];
  const opties = (waarden: readonly string[], huidig: string, naam: string) =>
    `<select name="${naam}"><option value=""${huidig ? "" : " selected"}>-</option>${waarden.map((w) => `<option value="${w}"${w === huidig ? " selected" : ""}>${w}</option>`).join("")}</select>`;
  const rijHtml = (r: GeplandOnderhoudRegelVeld, i: number) => `
    <tr>
      <td><input type="hidden" name="id_${i}" value="${r.id ?? ""}" /><input type="text" name="complex_${i}" value="${escapeHtml(r.complexnummer)}" style="width:60px" /></td>
      <td><input type="text" name="omschrijving_${i}" value="${escapeHtml(r.omschrijving)}" style="width:130px" /></td>
      <td><input type="text" name="grootboekrekening_${i}" value="${escapeHtml(r.grootboekrekening)}" style="width:60px" /></td>
      <td><input type="text" name="ogb_${i}" value="${escapeHtml(r.ogbKostensoort)}" placeholder="optioneel" style="width:60px" /></td>
      <td>${opties(AANLEIDING_OPTIES, r.aanleidingType, `aanleiding_${i}`)}<input type="text" name="toelichting_${i}" value="${escapeHtml(r.aanleidingToelichting)}" placeholder="toelichting" style="width:100px" /></td>
      <td><input type="text" name="q1_${i}" value="${escapeHtml(r.q1)}" style="width:60px" /></td>
      <td><input type="text" name="q2_${i}" value="${escapeHtml(r.q2)}" style="width:60px" /></td>
      <td><input type="text" name="q3_${i}" value="${escapeHtml(r.q3)}" style="width:60px" /></td>
      <td><input type="text" name="q4_${i}" value="${escapeHtml(r.q4)}" style="width:60px" /></td>
      <td>${opties(STATUS_OPTIES, r.status, `status_${i}`)}</td>
      <td><input type="text" name="leverancier_${i}" value="${escapeHtml(r.leverancier)}" placeholder="optioneel" style="width:90px" /></td>
      <td><input type="text" name="offertebedrag_${i}" value="${escapeHtml(r.offertebedrag)}" placeholder="optioneel" style="width:70px" /></td>
      <td><input type="text" name="notitie_${i}" value="${escapeHtml(r.notitie)}" placeholder="optioneel" style="width:90px" /></td>
    </tr>`;
  const inhoud = `
    <p class="sub">Werkelijk is alleen beschikbaar voor Onderhoud totaal (Gepland + Correctief/dagelijks samen) — er is bewust geen Werkelijk per activiteit.</p>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Complex</th><th style="text-align:left">Omschrijving</th><th style="text-align:left">GL</th><th style="text-align:left">OGB</th><th style="text-align:left">Bron</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Status</th><th style="text-align:left">Leverancier</th><th>Offerte</th><th style="text-align:left">Notitie</th></tr></thead>
        <tbody>${rijen.map(rijHtml).join("")}</tbody>
      </table>
      ${beoordeeldCheckbox("beoordeeld", o.beoordeeld)}
      <p class="sub">Jaartotaal Gepland onderhoud: <strong>${escapeHtml(o.jaartotaal)}</strong> (telt samen met Correctief/dagelijks op tot de P&L-post Onderhoud)</p>
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Gepland onderhoud", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud });
}

export interface WozObjectVeld {
  id: number | null;
  complexnummer: string;
  objectType: string;
  unitnummer: string;
  aanslagjaar: string;
  waardepeildatum: string;
  werkelijkeWoz: string;
  verwachteWozOverride: string;
}

export interface GemeentelijkeLastenRegelVeld {
  id: number | null;
  grootboekrekening: string;
  ogbKostensoort: string;
  jaarbedrag: string;
}

/** Gemeentelijke lasten / WOZ (UX_08, Tranche 13): GL-regels (het echte P&L-begrotingsbedrag), WOZ-historie (bronbasis voor het voorstel), en de twee aannamepercentages — exact het bestaande, geaccepteerde model. */
export function renderGemeentelijkeLastenForm(o: {
  actieUrl: string;
  terugUrl: string;
  fouten?: readonly string[];
  relevanteGrootboeken: readonly string[];
  glRegels: readonly GemeentelijkeLastenRegelVeld[];
  wozObjecten: readonly WozObjectVeld[];
  wozStijgingPercentage: string;
  lastenPercentageStijging: string;
  begrotingsPercentageOverride: string;
  werkelijkeGemeentelijkeLasten: string;
  beoordeeld: boolean;
  wozSetBevestigd: boolean;
  voorstelMogelijk: boolean;
  voorstelReden: string | null;
  portefeuilleTotaal: string;
}): string {
  const glRijen = [...o.glRegels, ...Array.from({ length: Math.max(0, 3 - o.glRegels.length) }, (): GemeentelijkeLastenRegelVeld => ({ id: null, grootboekrekening: "", ogbKostensoort: "", jaarbedrag: "" }))];
  const glRijHtml = (r: GemeentelijkeLastenRegelVeld, i: number) => `
    <tr>
      <td><input type="hidden" name="gl_id_${i}" value="${r.id ?? ""}" /><input type="text" name="gl_grootboekrekening_${i}" value="${escapeHtml(r.grootboekrekening)}" list="relevanteGrootboeken" style="width:80px" /></td>
      <td><input type="text" name="gl_ogb_${i}" value="${escapeHtml(r.ogbKostensoort)}" placeholder="optioneel" style="width:70px" /></td>
      <td><input type="text" name="gl_jaarbedrag_${i}" value="${escapeHtml(r.jaarbedrag)}" style="width:100px" /></td>
    </tr>`;
  const wozRijen = [...o.wozObjecten, ...Array.from({ length: Math.max(0, 3 - o.wozObjecten.length) }, (): WozObjectVeld => ({ id: null, complexnummer: "", objectType: "GEHEEL_COMPLEX", unitnummer: "", aanslagjaar: "", waardepeildatum: "", werkelijkeWoz: "", verwachteWozOverride: "" }))];
  const wozRijHtml = (r: WozObjectVeld, i: number) => `
    <tr>
      <td><input type="hidden" name="woz_id_${i}" value="${r.id ?? ""}" /><input type="text" name="woz_complex_${i}" value="${escapeHtml(r.complexnummer)}" style="width:70px" /></td>
      <td><select name="woz_objectType_${i}"><option value="GEHEEL_COMPLEX"${r.objectType === "GEHEEL_COMPLEX" ? " selected" : ""}>Geheel complex</option><option value="UNIT"${r.objectType === "UNIT" ? " selected" : ""}>Unit</option></select></td>
      <td><input type="text" name="woz_unit_${i}" value="${escapeHtml(r.unitnummer)}" placeholder="optioneel" style="width:60px" /></td>
      <td><input type="text" name="woz_aanslagjaar_${i}" value="${escapeHtml(r.aanslagjaar)}" style="width:70px" /></td>
      <td><input type="date" name="woz_waardepeildatum_${i}" value="${escapeHtml(r.waardepeildatum)}" style="width:130px" /></td>
      <td><input type="text" name="woz_werkelijk_${i}" value="${escapeHtml(r.werkelijkeWoz)}" style="width:100px" /></td>
      <td><input type="text" name="woz_override_${i}" value="${escapeHtml(r.verwachteWozOverride)}" placeholder="automatisch" style="width:100px" /></td>
    </tr>`;
  const voorstelKnop = o.voorstelMogelijk
    ? `<button type="submit" name="actie" value="voorstelOvernemen" class="secundair">Voorstel overnemen</button>`
    : o.voorstelReden !== null
      ? `<p class="sub">Voorstel overnemen niet mogelijk: ${escapeHtml(o.voorstelReden)}</p>`
      : "";
  const inhoud = `
    <datalist id="relevanteGrootboeken">${o.relevanteGrootboeken.map((gl) => `<option value="${escapeHtml(gl)}">`).join("")}</datalist>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <h2>Begroting per grootboekrekening</h2>
      <table style="margin-bottom:10px">
        <thead><tr><th style="text-align:left">Grootboek</th><th style="text-align:left">OGB</th><th style="text-align:left">Jaarbedrag</th></tr></thead>
        <tbody>${glRijen.map(glRijHtml).join("")}</tbody>
      </table>
      <p class="sub">Relevante grootboekrekeningen voor deze administratie: ${o.relevanteGrootboeken.length > 0 ? o.relevanteGrootboeken.map(escapeHtml).join(", ") : "geen bewezen mapping gevonden"}.</p>
      ${voorstelKnop}

      <h2>WOZ-historie</h2>
      <table style="margin-bottom:10px">
        <thead><tr><th style="text-align:left">Complex</th><th style="text-align:left">Type</th><th style="text-align:left">Unit</th><th>Aanslagjaar</th><th>Waardepeildatum</th><th>Werkelijke WOZ</th><th>Verwachte WOZ (override)</th></tr></thead>
        <tbody>${wozRijen.map(wozRijHtml).join("")}</tbody>
      </table>
      <label><input type="checkbox" name="wozSetBevestigd" value="1" style="width:auto;display:inline-block;margin-right:8px"${o.wozSetBevestigd ? " checked" : ""} />De WOZ-set is compleet (verplicht om vast te kunnen stellen)</label>

      <h2>Aannames</h2>
      <label for="wozStijging">Verwachte WOZ-stijging %</label><input type="text" name="wozStijging" id="wozStijging" value="${escapeHtml(o.wozStijgingPercentage)}" />
      <label for="lastenStijging">Verwachte stijging lastenpercentage %</label><input type="text" name="lastenStijging" id="lastenStijging" value="${escapeHtml(o.lastenPercentageStijging)}" />
      <label for="percentageOverride">Handmatige override lastenpercentage % (optioneel)</label><input type="text" name="percentageOverride" id="percentageOverride" value="${escapeHtml(o.begrotingsPercentageOverride)}" />
      <label for="werkelijkeLasten">Werkelijke totale gemeentelijke lasten (optioneel, voor het historisch percentage)</label><input type="text" name="werkelijkeLasten" id="werkelijkeLasten" value="${escapeHtml(o.werkelijkeGemeentelijkeLasten)}" />
      ${beoordeeldCheckbox("beoordeeld", o.beoordeeld)}

      <p class="sub">Totaal Gemeentelijke lasten pand (Jouw begroting): <strong>${escapeHtml(o.portefeuilleTotaal)}</strong></p>
      <button type="submit" name="actie" value="opslaan">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Gemeentelijke lasten / WOZ", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud });
}

export { geldWaarde };
export { paginaShell };
