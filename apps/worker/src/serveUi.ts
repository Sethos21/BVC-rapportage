import { escapeHtml } from "@bvc/reporting";
import type { AdministratieListItem } from "./administratie.js";

/**
 * Server-rendered HTML-shell voor `bvc-worker.exe serve` (v1, 2026-08-26).
 * Bewust GEEN client-side JavaScript en een eigen, kleine stijl — dit is
 * de tijdelijke app-shell (selectiescherm/foutpagina's), niet de
 * rapport-huisstijl (`@bvc/reporting`'s `huisstijl.ts`, die blijft
 * uitsluitend voor rapport-HTML zelf). Rekent niets uit — presenteert
 * alleen wat de aanroeper (`serveServer.ts`) al heeft opgehaald/gevalideerd.
 */

export const BOEKPERIODES: readonly { waarde: string; label: string }[] = [
  { waarde: "01", label: "01 - januari" },
  { waarde: "02", label: "02 - februari" },
  { waarde: "03", label: "03 - maart" },
  { waarde: "04", label: "04 - april" },
  { waarde: "05", label: "05 - mei" },
  { waarde: "06", label: "06 - juni" },
  { waarde: "07", label: "07 - juli" },
  { waarde: "08", label: "08 - augustus" },
  { waarde: "09", label: "09 - september" },
  { waarde: "10", label: "10 - oktober" },
  { waarde: "11", label: "11 - november" },
  { waarde: "12", label: "12 - december" },
];

const BASIS_CSS = `
  :root{ --ink:#1c2521; --muted:#626b64; --green:#21594a; --red:#bf4a30; --paper:#f6f4ee; --line:#e6e4dc; }
  body{font-family:system-ui,'IBM Plex Sans',sans-serif;color:var(--ink);background:var(--paper);margin:0;padding:0}
  .wrap{max-width:520px;margin:60px auto;padding:0 24px}
  .eyebrow{font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted)}
  h1{font-size:26px;margin:6px 0 24px}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:28px}
  label{display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin:16px 0 6px}
  label:first-of-type{margin-top:0}
  select,input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--line);border-radius:6px;font-size:14px;font-family:inherit}
  button{margin-top:24px;width:100%;padding:11px;border:none;border-radius:6px;background:var(--green);color:#fff;font-size:14.5px;font-weight:600;cursor:pointer}
  button:hover{opacity:0.92}
  .fouten{background:#fdecea;border:1px solid #f3c6bf;border-radius:8px;padding:12px 16px;margin-bottom:20px;color:var(--red)}
  .fouten ul{margin:4px 0 0;padding-left:18px}
  .toelichting{color:var(--muted);font-size:13px;margin-top:16px}
  .terug{display:inline-block;margin-top:20px;color:var(--green);text-decoration:none;font-size:13.5px}
`;

function paginaShell(titel: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(titel)}</title>
<style>${BASIS_CSS}</style>
</head>
<body>
<div class="wrap">
${bodyHtml}
</div>
</body>
</html>`;
}

export interface SelectieSchermOpties {
  fouten?: readonly string[];
  ingevoerd?: { administratieId?: string; boekjaar?: string; boekperiodeTotEnMet?: string };
}

export function renderSelectieScherm(administraties: readonly AdministratieListItem[], opties: SelectieSchermOpties = {}): string {
  const geselecteerdeAdministratie = opties.ingevoerd?.administratieId ?? "";
  const administratieOpties = administraties
    .map(
      (a) =>
        `<option value="${escapeHtml(a.administratieId)}"${a.administratieId === geselecteerdeAdministratie ? " selected" : ""}>${escapeHtml(a.weergavenaam)} (${escapeHtml(a.bedrijfsnr)})</option>`,
    )
    .join("");

  const geselecteerdePeriode = opties.ingevoerd?.boekperiodeTotEnMet ?? "";
  const periodeOpties = BOEKPERIODES.map((p) => `<option value="${p.waarde}"${p.waarde === geselecteerdePeriode ? " selected" : ""}>${escapeHtml(p.label)}</option>`).join("");

  const boekjaarWaarde = opties.ingevoerd?.boekjaar ?? "";

  const foutenHtml =
    opties.fouten && opties.fouten.length > 0
      ? `<div class="fouten"><strong>Controleer de invoer:</strong><ul>${opties.fouten.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>`
      : "";

  const administratieVeld =
    administraties.length === 0
      ? `<div class="fouten">Geen administraties gevonden onder <code>BVC_DATA_ROOT/administraties</code>.</div>`
      : `<select name="administratieId" required>
          <option value="" disabled${geselecteerdeAdministratie ? "" : " selected"}>Kies een administratie…</option>
          ${administratieOpties}
        </select>`;

  const body = `
    <div class="eyebrow">BVC Vastgoed Consultants</div>
    <h1>Managementrapportage</h1>
    <div class="card">
      ${foutenHtml}
      <form method="POST" action="/rapport/management">
        <label for="administratieId">Administratie</label>
        ${administratieVeld}

        <label for="boekjaar">Boekjaar</label>
        <input type="number" name="boekjaar" id="boekjaar" min="2000" max="2100" step="1" value="${escapeHtml(boekjaarWaarde)}" required />

        <label for="boekperiodeTotEnMet">Periode t/m</label>
        <select name="boekperiodeTotEnMet" id="boekperiodeTotEnMet" required>
          <option value="" disabled${geselecteerdePeriode ? "" : " selected"}>Kies een periode…</option>
          ${periodeOpties}
        </select>

        <button type="submit">Managementrapport openen</button>
      </form>
      <div class="toelichting">Genereert het gecombineerde managementrapport (financieel, vastgoed, huur, kasstroom) voor de gekozen administratie en periode.</div>
    </div>`;

  return paginaShell("BVC Rapportage — Managementrapportage", body);
}

export function renderFoutPagina(titel: string, bericht: string): string {
  const body = `
    <div class="eyebrow">BVC Vastgoed Consultants</div>
    <h1>${escapeHtml(titel)}</h1>
    <div class="card">
      <div class="fouten">${escapeHtml(bericht)}</div>
      <a class="terug" href="/">← Terug naar selectie</a>
    </div>`;
  return paginaShell(titel, body);
}
