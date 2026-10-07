import "server-only";
import { adminFirebase } from "@/lib/firebase/admin";
import { PLANS, planSchema, type Plan } from "./plans";
export async function publishedPlans(): Promise<Plan[]> {
  if (!process.env.FIREBASE_PROJECT_ID) return PLANS;
  const rows = (await adminFirebase().db.collection("plans").get()).docs;
  const plans = rows.map((doc) => planSchema.parse(doc.data()));
  return plans.sort(
    (a, b) =>
      PLANS.findIndex((p) => p.id === a.id) -
      PLANS.findIndex((p) => p.id === b.id),
  );
}
