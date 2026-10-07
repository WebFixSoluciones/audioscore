import { adminFirebase } from "../lib/firebase/admin";
import { PLANS } from "../lib/billing/plans";
async function main() {
  const { db } = adminFirebase();
  await db.runTransaction(async (tx) => {
    const refs = [
      ...PLANS.map((plan) => db.doc(`plans/${plan.id}`)),
      db.doc("system/config"),
    ];
    const docs = await tx.getAll(...refs),
      now = new Date().toISOString();
    for (let index = 0; index < PLANS.length; index++)
      if (!docs[index].exists)
        tx.create(refs[index], {
          ...PLANS[index],
          createdAt: now,
          updatedAt: now,
        });
    if (!docs[PLANS.length].exists)
      tx.create(refs[PLANS.length], {
        originalRetentionHours: 24,
        stemRetentionHours: 24,
        maxExportRetentionDays: 7,
        updatedAt: now,
      });
  });
  console.log(
    "Inicialización completada; se conservaron los planes y ajustes existentes.",
  );
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
