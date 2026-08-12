import { PrismaClient } from "@bvc/db";
import { importeerBron, type BronSleutel } from "./import/importSource.js";

const BRON_SLEUTELS: BronSleutel[] = ["boekingen", "balans", "rentroll", "contracten", "units", "complexTotalen", "servicekosten"];

function printGebruik(): never {
  console.error(
    [
      "Gebruik: pnpm --filter @bvc/worker import -- <bron> <bestandspad> [administratieCode]",
      `<bron> is één van: ${BRON_SLEUTELS.join(", ")}`,
      "Vereist DATABASE_URL (zie packages/db/.env.example).",
    ].join("\n"),
  );
  process.exit(1);
}

async function main() {
  const [bronArg, bestandspad, administratieCode] = process.argv.slice(2);
  if (!bronArg || !bestandspad || !BRON_SLEUTELS.includes(bronArg as BronSleutel)) {
    printGebruik();
  }

  const prisma = new PrismaClient();
  try {
    const resultaat = await importeerBron(prisma, bronArg as BronSleutel, bestandspad, administratieCode);
    console.log(JSON.stringify(resultaat, null, 2));
    if (resultaat.status === "GEBLOKKEERD") {
      console.error(`Batch ${resultaat.batchId} is GEBLOKKEERD — zie stg_import_batch.validatieIssues voor details.`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
