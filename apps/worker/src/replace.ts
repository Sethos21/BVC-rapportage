import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  BRON_BESTANDSNAAM,
  administratieCachePad,
  administratiesDir,
  auditGedeeldPad,
  bronGedeeldDir,
  administratieAuditPad,
  administratieBronDir,
  type BronType,
} from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { schrijfAudit, type AuditRecord } from "./audit.js";
import { laadBeheerparameters } from "./parameters.js";
import { valideerBron, type ValidatieContext } from "./validateBron.js";

export type VervangDoel = { type: "gedeeld" } | { type: "eigen"; administratieId: string };

export interface VervangBronParams {
  root: string;
  bronType: BronType;
  doel: VervangDoel;
  kandidaatBestandspad: string;
  gebruiker: string;
  context?: ValidatieContext;
  validatieversie?: string;
}

export interface VervangBronResultaat {
  uitkomst: "GESLAAGD" | "GEBLOKKEERD";
  issues: { rowIndex: number; bericht: string; ernst: "KRITIEK" | "WAARSCHUWING" }[];
  hash: string;
  rowCount: number;
  betrokkenAdministraties: string[];
}

/**
 * Veilig vervangingsprotocol (CLAUDE_OVERDRACHT_LOKALE_DATAOPZET_v0.1.md §
 * "Import- en vervangingsprotocol"; CLAUDE_AANVULLENDE_INSTRUCTIES_LOKALE_
 * BRONNEN_v0.1.md §6): kopieer -> hash+valideer -> bij fout niets wijzigen
 * -> bij succes atomisch vervangen -> caches ongeldig maken -> audit ->
 * opruimen. Het bestaande geldige bestand wordt nooit aangeraakt vóórdat
 * validatie is geslaagd.
 */
export function vervangBron(params: VervangBronParams): VervangBronResultaat {
  const { root, bronType, doel, kandidaatBestandspad, gebruiker, context = {}, validatieversie = "v0.1" } = params;

  // Stap 1/2: kopie buiten de actieve bronmap + hash + validatie.
  const tmpKopie = join(tmpdir(), `bvc-import-${randomUUID()}-${basename(kandidaatBestandspad)}`);
  copyFileSync(kandidaatBestandspad, tmpKopie);
  const buffer = readFileSync(tmpKopie);
  const hash = createHash("sha256").update(buffer).digest("hex");

  const effectieveContext: ValidatieContext = {
    beheerparameters: laadBeheerparameters(root),
    ...context,
    ...(doel.type === "eigen" ? { verwachtBedrijfsnr: leesAdministratieConfig(root, doel.administratieId).bedrijfsnr } : {}),
  };

  let validatie;
  try {
    validatie = valideerBron(bronType, buffer, effectieveContext);
  } catch (error) {
    unlinkSync(tmpKopie);
    throw error;
  }

  const alleIssues = [...validatie.issues, ...validatie.duplicaatIssues];
  const heeftKritiek = alleIssues.some((issue) => issue.ernst === "KRITIEK");
  const betrokkenAdministraties = vindBetrokkenAdministraties(root, bronType, doel);

  // Stap 3: bij een blokkerende fout blijft het huidige geldige bestand onaangetast.
  if (heeftKritiek) {
    unlinkSync(tmpKopie);
    schrijfAuditVoorDoel(root, doel, {
      tijdstip: new Date().toISOString(),
      bronLocatie: doel.type,
      bronType,
      betrokkenAdministraties,
      oorspronkelijkeBestandsnaam: basename(kandidaatBestandspad),
      hash,
      gebruiker,
      boekjaar: context.boekjaar,
      boekperiode: context.boekperiode,
      validatieversie,
      uitkomst: "GEBLOKKEERD",
      issues: alleIssues.map((issue) => `${issue.ernst}: ${issue.bericht}`),
    });
    return { uitkomst: "GEBLOKKEERD", issues: alleIssues, hash, rowCount: validatie.rowCount, betrokkenAdministraties };
  }

  // Stap 4: canoniek bestand pas na geslaagde validatie atomisch vervangen.
  const canoniekPad = bepaalCanoniekPad(root, bronType, doel);
  mkdirSync(dirname(canoniekPad), { recursive: true });
  const siblingTmp = `${canoniekPad}.tmp-${randomUUID()}`;
  copyFileSync(tmpKopie, siblingTmp);
  renameSync(siblingTmp, canoniekPad);
  unlinkSync(tmpKopie);

  // Stap 5: betrokken caches ongeldig maken — eenvoudig verwijderen; de
  // eerstvolgende rapportgeneratie herbouwt de cache uit de actuele bron.
  for (const administratieId of betrokkenAdministraties) {
    const cachePad = administratieCachePad(root, administratieId);
    if (existsSync(cachePad)) rmSync(cachePad);
  }

  // Stap 6/7: auditmetadata wegschrijven, geen oude bestandsinhoud bewaren.
  schrijfAuditVoorDoel(root, doel, {
    tijdstip: new Date().toISOString(),
    bronLocatie: doel.type,
    bronType,
    betrokkenAdministraties,
    oorspronkelijkeBestandsnaam: basename(kandidaatBestandspad),
    hash,
    gebruiker,
    boekjaar: context.boekjaar,
    boekperiode: context.boekperiode,
    validatieversie,
    uitkomst: "GESLAAGD",
    issues: alleIssues.length > 0 ? alleIssues.map((issue) => `${issue.ernst}: ${issue.bericht}`) : undefined,
  });

  return { uitkomst: "GESLAAGD", issues: alleIssues, hash, rowCount: validatie.rowCount, betrokkenAdministraties };
}

function bepaalCanoniekPad(root: string, bronType: BronType, doel: VervangDoel): string {
  const bestandsnaam = BRON_BESTANDSNAAM[bronType];
  return doel.type === "gedeeld" ? join(bronGedeeldDir(root), bestandsnaam) : join(administratieBronDir(root, doel.administratieId), bestandsnaam);
}

function schrijfAuditVoorDoel(root: string, doel: VervangDoel, record: AuditRecord): void {
  const auditPad = doel.type === "gedeeld" ? auditGedeeldPad(root) : administratieAuditPad(root, doel.administratieId);
  schrijfAudit(auditPad, record);
}

/**
 * Vervanging van een gedeeld bestand raakt de cache van elke administratie
 * die dit brontype op 'gedeeld' heeft staan; vervanging van een eigen
 * bestand raakt uitsluitend die ene administratie.
 */
function vindBetrokkenAdministraties(root: string, bronType: BronType, doel: VervangDoel): string[] {
  if (doel.type === "eigen") return [doel.administratieId];

  const dir = administratiesDir(root);
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((administratieId) => {
      try {
        return leesAdministratieConfig(root, administratieId).bronlocaties[bronType] === "gedeeld";
      } catch {
        return false;
      }
    });
}
