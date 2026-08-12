import { PrismaClient } from "@prisma/client";

/**
 * Pilot-startwaarden uit 12_MANAGEMENTPARAMETERS_v0.1.md.
 * Dit zijn pilot-startwaarden, geen wettelijke normen (zie document) —
 * per-administratie overschrijvingen gaan hier altijd vóór.
 */
const PILOT_PARAMETERS: { code: string; waarde: string; eenheid: string }[] = [
  { code: "PAR-FIN-001", waarde: "1", eenheid: "hele_euro_afronding" },
  { code: "PAR-CTRL-001", waarde: "1", eenheid: "euro" },
  { code: "PAR-CTRL-002", waarde: "0.01", eenheid: "euro" },
  { code: "PAR-MAP-001", waarde: "0", eenheid: "euro" },
  { code: "PAR-BUD-001", waarde: "1000|10", eenheid: "euro|percent" },
  { code: "PAR-BUD-002", waarde: "5000|20", eenheid: "euro|percent" },
  { code: "PAR-HUUR-001", waarde: "1000|10", eenheid: "euro|percent" },
  { code: "PAR-OND-001", waarde: "2500", eenheid: "euro" },
  { code: "PAR-INV-001", waarde: "5000", eenheid: "euro" },
  { code: "PAR-OND-002", waarde: "2500|25", eenheid: "euro|percent" },
  { code: "PAR-CTR-001", waarde: "90", eenheid: "dagen" },
  { code: "PAR-CTR-002", waarde: "180", eenheid: "dagen" },
  { code: "PAR-CTR-003", waarde: "12", eenheid: "maanden" },
  { code: "PAR-CTR-004", waarde: "12-24", eenheid: "maanden" },
  { code: "PAR-CTR-005", waarde: "24-36", eenheid: "maanden" },
  { code: "PAR-VG-001", waarde: "1|0.1", eenheid: "m2|percent" },
  { code: "PAR-DQ-001", waarde: "0", eenheid: "aantal" },
  { code: "PAR-DQ-002", waarde: "0", eenheid: "aantal" },
  { code: "PAR-DQ-003", waarde: "1", eenheid: "euro" },
  { code: "PAR-DQ-004", waarde: "1", eenheid: "euro" },
  // PAR-LIQ-001 (bankstreefwaarde) is bewust NIET geseed: het document
  // vereist een verplichte, per-administratie waarde zonder universele
  // default ("ontbrekend = Datacontrole, geen hardcoded waarde").
];

const prisma = new PrismaClient();

async function main() {
  for (const parameter of PILOT_PARAMETERS) {
    await prisma.defManagementparameter.upsert({
      where: { code_scope_geldigVanaf: { code: parameter.code, scope: "algemeen", geldigVanaf: new Date("2026-08-12") } },
      update: {},
      create: {
        code: parameter.code,
        scope: "algemeen",
        waarde: parameter.waarde,
        eenheid: parameter.eenheid,
        geldigVanaf: new Date("2026-08-12"),
        status: "pilot",
        versie: "v0.1",
      },
    });
  }
  console.log(`Geseed: ${PILOT_PARAMETERS.length} pilot-managementparameters.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
