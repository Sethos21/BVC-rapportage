import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgContractFeiten, BgRentrollComponent, BgToekomstigeKortingswijziging } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de bevroren Module-1-inputsnapshot (`BgContractFeiten[]`,
 * `packages/reporting/src/begroting/begroteHuuropbrengsten.ts` op HEAD).
 * UITSLUITEND opslag/reconstructie van reeds-genormaliseerde bronfeiten —
 * geen bronextractie, geen broninterpretatie, geen aanroep van de pure
 * Module-1-rekenfunctie zelf. `toekomstigeKortingswijzigingen` worden hier
 * ongewijzigd doorgegeven: deze laag kiest GEEN kandidaatregels, past GEEN
 * "hoogste Prijs_regelnr wint"-logica toe en normaliseert GEEN
 * `Prolongeren_na_perioden` — dat is (toekomstige) bronextractiescope, vóór
 * deze persistencegrens.
 */

/**
 * Businessdatum → kale `YYYY-MM-DD` (UTC-kalenderdag, expliciet via de
 * UTC-getters). Zelfde conventie/implementatie als `begrotingsversies.ts`'s
 * eigen `formatBusinessDate` — bewust hier gedupliceerd (2 kleine functies)
 * in plaats van een gedeelde util te introduceren, om `begrotingsversies.ts`
 * (al goedgekeurd in Fase 1D.2) niet aan te hoeven raken voor deze fase.
 */
function formatBusinessDate(date: Date): string {
  const jaar = date.getUTCFullYear().toString().padStart(4, "0");
  const maand = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dag = date.getUTCDate().toString().padStart(2, "0");
  return `${jaar}-${maand}-${dag}`;
}

/** Kale `YYYY-MM-DD` → `Date` op UTC-middernacht van diezelfde kalenderdag — exacte inverse van `formatBusinessDate`. */
function parseBusinessDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`Ongeldige businessdatum uit persistence: "${value}" (verwacht YYYY-MM-DD).`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function optioneleBusinessDate(date: Date | null): string | null {
  return date !== null ? formatBusinessDate(date) : null;
}

function optioneleParsedBusinessDate(value: string | null): Date | null {
  return value !== null ? parseBusinessDate(value) : null;
}

/** Kleine, herbruikbare transactie-helper — uitsluitend voor operaties die zelf een COMPLETE, op zichzelf staande eenheid van werk zijn. */
function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const resultaat = fn();
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

interface ContractSnapshotRow {
  contractnummer: string;
  bedrijfsnr: string;
  huurdernummer: string | null;
  huurder_naam: string | null;
  complexnummer: string | null;
  ingangsdatum: string | null;
  einddatum: string | null;
  indexatiedatum: string | null;
  indexatie_herhaling_maanden: number | null;
}

interface RentrollComponentRow {
  vorderingsoort: string;
  bedrag_jaar: string;
  btw_yn: string | null;
}

interface KortingswijzigingRow {
  ingangsdatum: string;
  nieuwe_korting_per_maand: string;
}

/**
 * Schrijft een COMPLETE Module-1-inputsnapshot voor één begrotingsversie,
 * atomair. Vervangt (verwijdert + voegt opnieuw in) de volledige bestaande
 * snapshot voor deze versie — geen gedeeltelijke/append-route. Faalt hard,
 * vóór de transactie, als de versie niet bestaat of geen CONCEPT is (de
 * DB-triggers van migratie 3 zijn de uiteindelijke garantie; deze check
 * geeft alleen een duidelijkere foutmelding vooraf).
 *
 * Beheert zelf een eigen, complete transactie (`BEGIN`…`COMMIT`/`ROLLBACK`)
 * — in tegenstelling tot `markeerVastgesteld` (dat bewust GEEN eigen
 * transactie beheert, omdat het straks als bouwblok bínnen de grotere
 * 1D.6-VASTSTELLEN-transactie moet passen). Deze functie is hier anders:
 * 1D.6 schrijft nooit een snapshot (die moet al bestaan en CONCEPT zijn vóór
 * vaststellen) — `schrijfModule1Snapshot` is dus altijd een volledig op
 * zichzelf staande operatie, nooit een stap ín een grotere transactie. Mocht
 * een toekomstige fase haar toch binnen een grotere transactie willen
 * aanroepen, dan moet dat expliciet opnieuw worden ontworpen (geneste
 * `BEGIN` faalt in SQLite) — niet aannemen dat het "gewoon werkt".
 */
export function schrijfModule1Snapshot(db: DatabaseSync, versieId: string, contracten: readonly BgContractFeiten[]): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — een Module-1-snapshot mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  const geziencontractnummers = new Set<string>();
  for (const contract of contracten) {
    if (geziencontractnummers.has(contract.contractnummer)) {
      throw new Error(
        `Dubbel contractnummer "${contract.contractnummer}" binnen dezelfde Module-1-snapshot voor versie ${versieId} — dit hoort al vóór persistence eenduidig te zijn.`,
      );
    }
    geziencontractnummers.add(contract.contractnummer);

    // Structurele consistentie-invariant: één begrotingsversie hoort bij precies één administratie —
    // hetzelfde bedrijfsnr als de versie zelf, ook technisch afgedwongen door de DB-triggers hieronder.
    if (contract.bedrijfsnr !== versie.bedrijfsnr) {
      throw new Error(
        `Contract ${contract.contractnummer}: bedrijfsnr "${contract.bedrijfsnr}" komt niet overeen met het bedrijfsnr "${versie.bedrijfsnr}" van begrotingsversie ${versieId}.`,
      );
    }
  }

  withTransaction(db, () => {
    db.prepare(`DELETE FROM begroting_contract_kortingswijziging WHERE begroting_versie_id = ?`).run(versieId);
    db.prepare(`DELETE FROM begroting_contract_rentroll_component WHERE begroting_versie_id = ?`).run(versieId);
    db.prepare(`DELETE FROM begroting_contract_snapshot WHERE begroting_versie_id = ?`).run(versieId);

    const insertSnapshot = db.prepare(
      `INSERT INTO begroting_contract_snapshot
         (begroting_versie_id, contractnummer, bedrijfsnr, huurdernummer, huurder_naam, complexnummer, ingangsdatum, einddatum, indexatiedatum, indexatie_herhaling_maanden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertComponent = db.prepare(
      `INSERT INTO begroting_contract_rentroll_component
         (begroting_versie_id, contractnummer, volgnr, vorderingsoort, bedrag_jaar, btw_yn)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertKorting = db.prepare(
      `INSERT INTO begroting_contract_kortingswijziging
         (begroting_versie_id, contractnummer, volgnr, ingangsdatum, nieuwe_korting_per_maand)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const contract of contracten) {
      insertSnapshot.run(
        versieId,
        contract.contractnummer,
        contract.bedrijfsnr,
        contract.huurdernummer,
        contract.huurderNaam,
        contract.complexnummer,
        optioneleBusinessDate(contract.ingangsdatum),
        optioneleBusinessDate(contract.einddatum),
        optioneleBusinessDate(contract.indexatiedatum),
        contract.indexatieHerhalingMaanden,
      );

      contract.rentrollComponenten.forEach((component, volgnr) => {
        insertComponent.run(versieId, contract.contractnummer, volgnr, component.vorderingsoort, component.bedragJaar.toString(), component.btwYn);
      });

      contract.toekomstigeKortingswijzigingen.forEach((wijziging, volgnr) => {
        insertKorting.run(
          versieId,
          contract.contractnummer,
          volgnr,
          formatBusinessDate(wijziging.ingangsdatum),
          wijziging.nieuweKortingPerMaand.toString(),
        );
      });
    }
  });
}

/**
 * Reconstrueert de exacte `BgContractFeiten[]` voor een begrotingsversie —
 * rechtstreeks bruikbaar als eerste argument van `berekenBegroteHuuropbrengsten`
 * (deze module roept die functie zelf niet aan). Lege snapshot → lege array.
 *
 * Ordening (deterministisch, geen afhankelijkheid van SQLite's toevallige
 * rijvolgorde): contracten op `contractnummer`; rentrollcomponenten op
 * `vorderingsoort` (canoniek, betekenisvol) met `volgnr` als noodzakelijke
 * tiebreaker (twee componenten kunnen legitiem dezelfde vorderingsoort
 * hebben — bv. een multi-unit-contract — dus is een unieke tiebreaker
 * vereist, niet optioneel); kortingswijzigingen op `ingangsdatum`
 * (chronologisch, betekenisvol) met `volgnr` als tiebreaker. `volgnr` is
 * sowieso al nodig als deel van de primary key van beide child-tabellen —
 * hergebruikt als tiebreaker, geen aparte "bewaar exacte array-volgorde"-kolom.
 */
export function leesModule1Snapshot(db: DatabaseSync, versieId: string): readonly BgContractFeiten[] {
  const snapshotRijen = db
    .prepare(
      `SELECT contractnummer, bedrijfsnr, huurdernummer, huurder_naam, complexnummer, ingangsdatum, einddatum, indexatiedatum, indexatie_herhaling_maanden
       FROM begroting_contract_snapshot
       WHERE begroting_versie_id = ?
       ORDER BY contractnummer`,
    )
    .all(versieId) as unknown as ContractSnapshotRow[];

  const componentStmt = db.prepare(
    `SELECT vorderingsoort, bedrag_jaar, btw_yn
     FROM begroting_contract_rentroll_component
     WHERE begroting_versie_id = ? AND contractnummer = ?
     ORDER BY vorderingsoort, volgnr`,
  );
  const kortingStmt = db.prepare(
    `SELECT ingangsdatum, nieuwe_korting_per_maand
     FROM begroting_contract_kortingswijziging
     WHERE begroting_versie_id = ? AND contractnummer = ?
     ORDER BY ingangsdatum, volgnr`,
  );

  return snapshotRijen.map((rij): BgContractFeiten => {
    const componentRijen = componentStmt.all(versieId, rij.contractnummer) as unknown as RentrollComponentRow[];
    const kortingRijen = kortingStmt.all(versieId, rij.contractnummer) as unknown as KortingswijzigingRow[];

    const rentrollComponenten: BgRentrollComponent[] = componentRijen.map((c) => ({
      vorderingsoort: c.vorderingsoort,
      bedragJaar: new Decimal(c.bedrag_jaar),
      btwYn: c.btw_yn,
    }));

    const toekomstigeKortingswijzigingen: BgToekomstigeKortingswijziging[] = kortingRijen.map((k) => ({
      ingangsdatum: parseBusinessDate(k.ingangsdatum),
      nieuweKortingPerMaand: new Decimal(k.nieuwe_korting_per_maand),
    }));

    return {
      bedrijfsnr: rij.bedrijfsnr,
      contractnummer: rij.contractnummer,
      huurdernummer: rij.huurdernummer,
      huurderNaam: rij.huurder_naam,
      complexnummer: rij.complexnummer,
      rentrollComponenten,
      ingangsdatum: optioneleParsedBusinessDate(rij.ingangsdatum),
      einddatum: optioneleParsedBusinessDate(rij.einddatum),
      indexatiedatum: optioneleParsedBusinessDate(rij.indexatiedatum),
      indexatieHerhalingMaanden: rij.indexatie_herhaling_maanden,
      toekomstigeKortingswijzigingen,
    };
  });
}
