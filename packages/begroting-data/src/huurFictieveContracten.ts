import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgBelastOnbelast, BgContractFeiten } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor fictieve begrotingscontracten ("Contract toevoegen", besluit 07-10-2026 §11) —
 * contracten die UITSLUITEND binnen de begroting bestaan, de bronadministratie nooit muteren, en
 * door de ONGEWIJZIGDE `berekenBegroteHuuropbrengsten` worden verwerkt alsof het een bronfeit-
 * contract is. `naarBgContractFeiten` is de enige plek die de mapping doet — de calculator zelf
 * kent geen "fictief"-begrip en onderscheidt deze contracten op geen enkele manier.
 *
 * `contractnummer` wordt hier gegenereerd met een `FICTIEF-`-prefix (een bronfeit-contractnummer is
 * in de bewezen bron altijd een numerieke string, zie `begroteHuuropbrengsten.ts`'s moduledoc) —
 * dit kan dus nooit met een echt contract botsen, ook niet toevallig.
 *
 * VASTGESTELD-immutability loopt via DB-triggers (migratie 44, zelfde patroon als
 * `begroting_contract_snapshot`) — geen applicatielaag-duplicaat van die check nodig voor INSERT/
 * UPDATE/DELETE zelf, al geven de functies hieronder toch een vroege, duidelijke foutmelding vóór
 * de trigger het afdwingt (zelfde stijl als `schrijfModule1Snapshot`).
 */

export interface BgHuurFictiefContract {
  contractnummer: string;
  huurderNaam: string;
  complexnummer: string | null;
  ingangsdatum: Date;
  brutoJaarhuur: Decimal;
  belastOnbelast: Exclude<BgBelastOnbelast, "ONBEKEND">;
  kortingJaar: Decimal;
  aangemaaktOp: Date;
}

interface FictiefContractRow {
  contractnummer: string;
  huurder_naam: string;
  complexnummer: string | null;
  ingangsdatum: string;
  bruto_jaarhuur: string;
  belast_onbelast: string;
  korting_jaar: string;
  aangemaakt_op: string;
}

function formatBusinessDate(date: Date): string {
  const jaar = date.getUTCFullYear().toString().padStart(4, "0");
  const maand = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dag = date.getUTCDate().toString().padStart(2, "0");
  return `${jaar}-${maand}-${dag}`;
}

function parseBusinessDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`Ongeldige businessdatum uit persistence: "${value}" (verwacht YYYY-MM-DD).`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function rijNaarContract(rij: FictiefContractRow): BgHuurFictiefContract {
  return {
    contractnummer: rij.contractnummer,
    huurderNaam: rij.huurder_naam,
    complexnummer: rij.complexnummer,
    ingangsdatum: parseBusinessDate(rij.ingangsdatum),
    brutoJaarhuur: new Decimal(rij.bruto_jaarhuur),
    belastOnbelast: rij.belast_onbelast as "BELAST" | "ONBELAST",
    kortingJaar: new Decimal(rij.korting_jaar),
    aangemaaktOp: new Date(rij.aangemaakt_op),
  };
}

function controleerConceptVersie(db: DatabaseSync, versieId: string): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — fictieve contracten mogen uitsluitend op een CONCEPT-versie worden toegevoegd/gewijzigd/verwijderd.`);
  }
}

/**
 * Voegt een nieuw fictief contract toe en geeft het gegenereerde `contractnummer` terug. Gebruikt
 * nooit een bestaand/opgegeven contractnummer — altijd zelf gegenereerd, zodat botsing met een
 * bronfeit-contract of een ander fictief contract structureel is uitgesloten.
 */
export function voegHuurFictiefContractToe(
  db: DatabaseSync,
  versieId: string,
  invoer: { huurderNaam: string; complexnummer: string | null; ingangsdatum: Date; brutoJaarhuur: Decimal; belastOnbelast: "BELAST" | "ONBELAST"; kortingJaar: Decimal },
): string {
  controleerConceptVersie(db, versieId);
  const contractnummer = `FICTIEF-${randomUUID()}`;
  db.prepare(
    `INSERT INTO begroting_huur_fictief_contract (begroting_versie_id, contractnummer, huurder_naam, complexnummer, ingangsdatum, bruto_jaarhuur, belast_onbelast, korting_jaar, aangemaakt_op)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    versieId,
    contractnummer,
    invoer.huurderNaam,
    invoer.complexnummer,
    formatBusinessDate(invoer.ingangsdatum),
    invoer.brutoJaarhuur.toString(),
    invoer.belastOnbelast,
    invoer.kortingJaar.toString(),
    new Date().toISOString(),
  );
  return contractnummer;
}

/** Wijzigt een bestaand fictief contract (volledige vervanging van de bewerkbare velden) — `aangemaaktOp` blijft ongewijzigd. */
export function wijzigHuurFictiefContract(
  db: DatabaseSync,
  versieId: string,
  contractnummer: string,
  invoer: { huurderNaam: string; complexnummer: string | null; ingangsdatum: Date; brutoJaarhuur: Decimal; belastOnbelast: "BELAST" | "ONBELAST"; kortingJaar: Decimal },
): void {
  controleerConceptVersie(db, versieId);
  const resultaat = db
    .prepare(
      `UPDATE begroting_huur_fictief_contract
       SET huurder_naam = ?, complexnummer = ?, ingangsdatum = ?, bruto_jaarhuur = ?, belast_onbelast = ?, korting_jaar = ?
       WHERE begroting_versie_id = ? AND contractnummer = ?`,
    )
    .run(invoer.huurderNaam, invoer.complexnummer, formatBusinessDate(invoer.ingangsdatum), invoer.brutoJaarhuur.toString(), invoer.belastOnbelast, invoer.kortingJaar.toString(), versieId, contractnummer);
  if (resultaat.changes === 0) {
    throw new Error(`Fictief contract ${contractnummer} bestaat niet binnen begrotingsversie ${versieId}.`);
  }
}

/** Verwijdert een fictief contract. Geen foutmelding als het al niet (meer) bestaat (idempotent verwijderen). */
export function verwijderHuurFictiefContract(db: DatabaseSync, versieId: string, contractnummer: string): void {
  controleerConceptVersie(db, versieId);
  db.prepare(`DELETE FROM begroting_huur_fictief_contract WHERE begroting_versie_id = ? AND contractnummer = ?`).run(versieId, contractnummer);
}

/** Leest alle fictieve contracten van een begrotingsversie, op contractnummer (deterministisch). */
export function leesHuurFictieveContracten(db: DatabaseSync, versieId: string): readonly BgHuurFictiefContract[] {
  const rijen = db
    .prepare(
      `SELECT contractnummer, huurder_naam, complexnummer, ingangsdatum, bruto_jaarhuur, belast_onbelast, korting_jaar, aangemaakt_op
       FROM begroting_huur_fictief_contract WHERE begroting_versie_id = ? ORDER BY contractnummer`,
    )
    .all(versieId) as unknown as FictiefContractRow[];
  return rijen.map(rijNaarContract);
}

/**
 * Vertaalt één fictief contract naar exact de vorm die de ONGEWIJZIGDE `berekenBegroteHuuropbrengsten`
 * als bronfeit verwacht — één VS=01-component (bruto) en, indien `kortingJaar` > 0, één VS=13-component
 * (korting, in de bewezen negatieve brontekenconventie). `btwYn` volgt rechtstreeks uit
 * `belastOnbelast` zodat de bestaande, ongewijzigde `bepaalBelastOnbelast` het fictieve contract
 * precies zo classificeert als een echt contract — geen apart "fictief"-veld op `BgContractFeiten`.
 * Geen indexatiedatum/-herhaling (een fictief contract kent geen `Verhoging_datum`-bronfeit) en geen
 * toekomstige kortingswijziging — beide blijven gewoon beschikbaar als latere Maandverloop-override.
 */
export function naarBgContractFeiten(contract: BgHuurFictiefContract, bedrijfsnr: string): BgContractFeiten {
  const btwYn = contract.belastOnbelast === "BELAST" ? "Y" : "N";
  return {
    bedrijfsnr,
    contractnummer: contract.contractnummer,
    huurdernummer: null,
    huurderNaam: contract.huurderNaam,
    complexnummer: contract.complexnummer,
    rentrollComponenten: [
      { vorderingsoort: "01", bedragJaar: contract.brutoJaarhuur, btwYn },
      ...(contract.kortingJaar.isZero() ? [] : [{ vorderingsoort: "13", bedragJaar: contract.kortingJaar.negated(), btwYn }]),
    ],
    ingangsdatum: contract.ingangsdatum,
    einddatum: null,
    indexatiedatum: null,
    indexatieHerhalingMaanden: null,
    toekomstigeKortingswijzigingen: [],
  };
}
