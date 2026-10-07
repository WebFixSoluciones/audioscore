import { adminFirebase } from "../lib/firebase/admin";
import { PLANS } from "../lib/billing/plans";
async function main() {
  const { db } = adminFirebase(),
    batch = db.batch(),
    now = new Date().toISOString();
  for (const plan of PLANS)
    batch.set(
      db.doc(`plans/${plan.id}`),
      { ...plan, createdAt: now, updatedAt: now },
      { merge: true },
    );
  batch.set(
    db.doc("system/config"),
    {
      originalRetentionHours: 24,
      stemRetentionHours: 24,
      maxExportRetentionDays: 7,
      updatedAt: now,
    },
    { merge: true },
  );
  await batch.commit();
  console.log("Planes y configuración inicializados.");
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
