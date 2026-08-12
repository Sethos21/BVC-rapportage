import { readFileSync } from "node:fs";
import { PrismaClient } from "@bvc/db";
import { readFirstSheetAsRows, type RowIssue } from "@bvc/data-contracts";
import {
  parseBoekingen,
  parseBalans,
  parseRentroll,
  parseContracten,
  parseUnits,
  parseComplexTotalen,
  parseServicekosten,
} from "@bvc/data-contracts";
import { bestandHash, rondBatchAf, vindOfMaakBatch } from "./batch.js";
import { toJsonSafe } from "./jsonSafe.js";

export type BronSleutel = "boekingen" | "balans" | "rentroll" | "contracten" | "units" | "complexTotalen" | "servicekosten";

export interface ImportResultaat {
  batchId: string;
  bronTabel: string;
  rowCount: number;
  issueCount: number;
  duplicateCount: number;
  status: "GESLAAGD" | "GEBLOKKEERD";
}

/**
 * Eén generieke pijplijn per bron: bestand lezen -> hashen -> batch
 * vinden/aanmaken -> parsen tegen het broncontract -> gevalideerde rijen
 * wegschrijven naar de bronspecifieke staging-tabel -> batch afronden.
 * Schrijft NIETS naar de genormaliseerde dim_/fact_-tabellen — dat is een
 * afzonderlijke, latere stap (mapping moet eerst goedgekeurd zijn).
 */
export async function importeerBron(
  prisma: PrismaClient,
  bronSleutel: BronSleutel,
  bestandspad: string,
  administratieCode?: string,
): Promise<ImportResultaat> {
  const buffer = readFileSync(bestandspad);
  const ruweRijen = readFirstSheetAsRows(buffer);
  const hash = bestandHash(buffer);

  const config = BRON_CONFIG[bronSleutel];
  const batch = await vindOfMaakBatch(prisma, {
    bronTabel: config.bronTabel,
    bronBestandsnaam: bestandspad,
    bronBestandHash: hash,
    administratieCode: administratieCode ?? null,
  });

  const { rijen, issues, duplicaatIssues } = config.parse(ruweRijen);
  const alleIssues = [...issues, ...duplicaatIssues];

  // Alleen rijen zonder dubbele natuurlijke sleutel wegschrijven — een
  // duplicaat blokkeert de import (PAR-DQ-001), niet alleen de gerapporteerde rij.
  if (duplicaatIssues.length === 0 && rijen.length > 0) {
    await config.schrijfWeg(prisma, batch.id, rijen);
  }

  await rondBatchAf(prisma, batch.id, { rowCount: rijen.length, issues: alleIssues });

  return {
    batchId: batch.id,
    bronTabel: config.bronTabel,
    rowCount: rijen.length,
    issueCount: alleIssues.length,
    duplicateCount: duplicaatIssues.length,
    status: alleIssues.some((issue: RowIssue) => issue.ernst === "KRITIEK") || duplicaatIssues.length > 0 ? "GEBLOKKEERD" : "GESLAAGD",
  };
}

interface BronConfig {
  bronTabel: string;
  parse: (ruweRijen: Record<string, unknown>[]) => { rijen: any[]; issues: RowIssue[]; duplicaatIssues: RowIssue[] };
  schrijfWeg: (prisma: PrismaClient, batchId: string, rijen: any[]) => Promise<unknown>;
}

const BRON_CONFIG: Record<BronSleutel, BronConfig> = {
  boekingen: {
    bronTabel: "IDBC Boekingen",
    parse: parseBoekingen,
    schrijfWeg: (prisma, batchId, rijen) =>
      prisma.stgBoekingsregel.createMany({
        data: rijen.map((r) => ({
          batchId,
          bedrijfsnr: r.bedrijfsnr,
          boekingBoekjaar: r.boekingBoekjaar,
          boekingBoekperiode: r.boekingBoekperiode,
          boekingDagboeknr: r.boekingDagboeknr,
          boekingBoekstuknr: r.boekingBoekstuknr,
          boekingVolgnr: r.boekingVolgnr,
          boekstukSleutel: r.boekstukSleutel,
          boekingBoekdatum: r.boekingBoekdatum,
          boekingGrootboeknr: r.boekingGrootboeknr,
          boekingKostenplaatsnr: r.boekingKostenplaatsnr,
          boekingComplexnr: r.boekingComplexnr,
          boekingUnitnr: r.boekingUnitnr,
          boekingContractnr: r.boekingContractnr,
          boekingHuurdernr: r.boekingHuurdernr,
          boekingBedragDebet: r.boekingBedragDebet.toString(),
          boekingBedragCredit: r.boekingBedragCredit.toString(),
          boekingSaldo: r.boekingSaldo.toString(),
          boekingOmschrijving: r.boekingOmschrijving,
          boekingGrootboekA: r.boekingGrootboekA,
          boekingGrootboekB: r.boekingGrootboekB,
          raw: toJsonSafe(r.raw),
        })),
        skipDuplicates: true,
      }),
  },
  balans: {
    bronTabel: "IDCB Balans per jaar",
    parse: parseBalans,
    schrijfWeg: (prisma, batchId, rijen) =>
      prisma.stgBalansstand.createMany({
        data: rijen.map((r) => ({
          batchId,
          bedrijfsnr: r.bedrijfsnr,
          jaar: r.jaar,
          grootboekrekeningnr: r.grootboekrekeningnr,
          beginbalansDebet: r.beginbalansDebet?.toString(),
          beginbalansCredit: r.beginbalansCredit?.toString(),
          saldoDebet: r.saldoDebet.toString(),
          saldoCredit: r.saldoCredit.toString(),
          eindsaldoDebet: r.eindsaldoDebet?.toString(),
          eindsaldoCredit: r.eindsaldoCredit?.toString(),
          eindsaldo: r.eindsaldo.toString(),
          rekeningOmschrijving: r.rekeningOmschrijving,
          balansVw: r.balansVw,
          raw: toJsonSafe(r.raw),
        })),
        skipDuplicates: true,
      }),
  },
  rentroll: {
    bronTabel: "RentRoll",
    parse: parseRentroll,
    schrijfWeg: (prisma, batchId, rijen) =>
      prisma.stgRentrollregel.createMany({
        data: rijen.map((r) => ({
          batchId,
          bedrijfsnummer: r.bedrijfsnummer,
          contractnummer: r.contractnummer,
          vorderingsoort: r.vorderingsoort,
          unitnummer: r.unitnummer,
          complexnummer: r.complexnummer,
          rapportageDatum: r.rapportageDatum,
          prolongatieBedragJaar: r.prolongatieBedragJaar?.toString(),
          kortingBedragJaar: r.kortingBedragJaar?.toString(),
          serviceVoorschotJaar: r.serviceVoorschotJaar?.toString(),
          gehuurdOppervlak: r.gehuurdOppervlak?.toString(),
          contractExpiratiedatum: r.contractExpiratiedatum,
          contractOpzegdatum: r.contractOpzegdatum,
          raw: toJsonSafe(r.raw),
        })),
        skipDuplicates: true,
      }),
  },
  contracten: {
    bronTabel: "IDBC Contracten Huidig",
    parse: parseContracten,
    schrijfWeg: (prisma, batchId, rijen) =>
      prisma.stgContract.createMany({
        data: rijen.map((r) => ({
          batchId,
          bedrijfsnr: r.bedrijfsnr,
          contract: r.contract,
          complexnummer: r.complexnummer,
          unitnummer: r.unitnummer,
          huurdernummer: r.huurdernummer,
          ingangsdatum: r.ingangsdatum,
          afloopdatum: r.afloopdatum,
          expiratieExpiratiedatum: r.expiratieExpiratiedatum,
          expiratieOpzegdatum: r.expiratieOpzegdatum,
          expiratieAantalPerOptie: r.expiratieAantalPerOptie,
          expiratieHuidige: r.expiratieHuidige,
          checkLopendContract: r.checkLopendContract,
          raw: toJsonSafe(r.raw),
        })),
        skipDuplicates: true,
      }),
  },
  units: {
    bronTabel: "IDBC Units",
    parse: parseUnits,
    schrijfWeg: (prisma, batchId, rijen) =>
      prisma.stgUnit.createMany({
        data: rijen.map((r) => ({
          batchId,
          bedrijfsnr: r.bedrijfsnr,
          complexnummer: r.complexnummer,
          unitnummer: r.unitnummer,
          unitNonActief: r.unitNonActief,
          unitomschrijving: r.unitomschrijving,
          unitsoort: r.unitsoort,
          unitVvo: r.unitVvo?.toString(),
          unitBvo: r.unitBvo?.toString(),
          unitAdres: r.unitAdres,
          unitPostcode: r.unitPostcode,
          unitPlaats: r.unitPlaats,
          raw: toJsonSafe(r.raw),
        })),
        skipDuplicates: true,
      }),
  },
  complexTotalen: {
    bronTabel: "IDBC Complex Totalen",
    parse: parseComplexTotalen,
    schrijfWeg: (prisma, batchId, rijen) =>
      prisma.stgComplexTotaal.createMany({
        data: rijen.map((r) => ({
          batchId,
          bedrijfsnr: r.bedrijfsnr,
          complexnr: r.complexnr,
          totaalOppervlakte: r.totaalOppervlakte?.toString(),
          totaalVerhuurd: r.totaalVerhuurd?.toString(),
          totaalLeegstand: r.totaalLeegstand?.toString(),
          raw: toJsonSafe(r.raw),
        })),
        skipDuplicates: true,
      }),
  },
  servicekosten: {
    bronTabel: "IDBC Servicekosten Boekingen",
    parse: parseServicekosten,
    schrijfWeg: (prisma, batchId, rijen) =>
      prisma.stgServicekostenregel.createMany({
        data: rijen.map((r) => ({
          batchId,
          bedrijfsnr: r.bedrijfsnr,
          serviceBkBoekjaar: r.serviceBkBoekjaar,
          serviceBkBoekperiode: r.serviceBkBoekperiode,
          serviceBkDagboeknummer: r.serviceBkDagboeknummer,
          serviceBkBoekstuknummer: r.serviceBkBoekstuknummer,
          serviceBkVolgnummer: r.serviceBkVolgnummer,
          serviceBkComplexnummer: r.serviceBkComplexnummer,
          serviceBkUnitnummer: r.serviceBkUnitnummer,
          serviceBkContractnummer: r.serviceBkContractnummer,
          huurdernummer: r.huurdernummer,
          serviceBkKostensoort: r.serviceBkKostensoort,
          kostensoortOmschrijving: r.kostensoortOmschrijving,
          serviceBkOmschrijving: r.serviceBkOmschrijving,
          serviceBkBedragDebet: r.serviceBkBedragDebet.toString(),
          serviceBkBedragCredit: r.serviceBkBedragCredit.toString(),
          serviceBoekingSaldo: r.serviceBoekingSaldo.toString(),
          serviceBkDoorbelasten: r.serviceBkDoorbelasten,
          uitsluitingsstatus: r.uitsluitingsstatus,
          raw: toJsonSafe(r.raw),
        })),
        skipDuplicates: true,
      }),
  },
};

export { PrismaClient };
