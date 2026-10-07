import "server-only";
import { adminFirebase } from "@/lib/firebase/admin";
import {
  planSchema,
  type Feature,
  type Plan,
  type ExportFormat,
} from "@/lib/billing/plans";
import { ApiError } from "@/lib/utils/errors";
import type { Account } from "./auth-guard";
export async function activePlan(account: Account): Promise<Plan> {
  if (account.subscriptionStatus !== "active")
    throw new ApiError(403, "Tu plan no está activo");
  const doc = await adminFirebase().db.doc(`plans/${account.planId}`).get();
  if (!doc.exists)
    throw new ApiError(503, "Los planes todavía no están inicializados");
  return planSchema.parse(doc.data());
}
export function featureAllowed(plan: Plan, feature: Feature) {
  if (!plan.features[feature])
    throw new ApiError(403, `Tu plan no incluye ${feature}`);
}
export function exportAllowed(
  plan: Plan,
  format: ExportFormat,
  fullScore: boolean,
) {
  if (!plan.allowedExports.includes(format))
    throw new ApiError(403, "Este formato no está incluido en tu plan");
  if (fullScore && !plan.features.fullScoreExport)
    throw new ApiError(403, "La partitura global requiere el plan Pro");
}
