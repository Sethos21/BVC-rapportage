import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBalans, parseBoekingen, readFirstSheetAsRows, type RowIssue } from "@bvc/data-contracts";
import { inventariseerGrootboekrekeningen, type GrootboekInventarisatieResultaat } from "@bvc/reporting";
import { BRON_BESTANDSNAAM, bronGedeeldDir } from "./paths.js";

export interface GenereerGrootboekInventarisatieResultaat {
  inventarisatie: GrootboekInventarisatieResultaat;
  boekingenIssues: RowIssue[];
  balansIssues: RowIssue[];
}

/**
 * Leest de gedeelde bronnen `boekingen` en `balans_per_jaar` rechtstreeks
 * (ongefilterd — alle Bedrijfsnr-waarden die in het bestand voorkomen),
 * niet via een per-administratie cache. Dit is bewust de voorbereidende,
 * alleen-lezen stap voor een centrale master-grootboekmapping: het past
 * geen mapping toe en verandert niets, het inventariseert alleen.
 *
 * Beperking: dekt alleen administraties die deze bronnen op 'gedeeld'
 * hebben staan (de standaardinstelling, zie `DEFAULT_BRONLOCATIES`). Een
 * administratie met 'eigen' boekingen/balans_per_jaar zit hier niet in —
 * nog niet ondersteund in deze eerste versie.
 */
export function genereerGrootboekInventarisatie(root: string): GenereerGrootboekInventarisatieResultaat {
  const boekingenPad = join(bronGedeeldDir(root), BRON_BESTANDSNAAM.boekingen);
  const balansPad = join(bronGedeeldDir(root), BRON_BESTANDSNAAM.balans_per_jaar);

  if (!existsSync(boekingenPad)) {
    throw new Error(`Gedeelde bron ontbreekt: ${boekingenPad}`);
  }
  if (!existsSync(balansPad)) {
    throw new Error(`Gedeelde bron ontbreekt: ${balansPad}`);
  }

  const boekingenRuw = readFirstSheetAsRows(readFileSync(boekingenPad));
  const balansRuw = readFirstSheetAsRows(readFileSync(balansPad));

  const { rijen: boekingenRijen, issues: boekingenIssues } = parseBoekingen(boekingenRuw);
  const { rijen: balansRijen, issues: balansIssues } = parseBalans(balansRuw);

  const inventarisatie = inventariseerGrootboekrekeningen(
    boekingenRijen.map((r) => ({
      bedrijfsnr: r.bedrijfsnr,
      grootboekrekening: r.boekingGrootboeknr,
      bedragDebet: r.boekingBedragDebet,
      bedragCredit: r.boekingBedragCredit,
    })),
    balansRijen.map((r) => ({
      bedrijfsnr: r.bedrijfsnr,
      grootboekrekening: r.grootboekrekeningnr,
      jaar: r.jaar,
      omschrijving: r.rekeningOmschrijving,
      balansVw: r.balansVw,
    })),
  );

  return { inventarisatie, boekingenIssues, balansIssues };
}
