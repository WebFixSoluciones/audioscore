"use client";
import type { Feature, Plan } from "@/lib/billing/plans";
export function FeatureGate({
  feature,
  plan,
  active,
  children,
}: {
  feature: Feature;
  plan?: Plan;
  active: boolean;
  children: React.ReactNode;
}) {
  if (!active || !plan?.features[feature])
    return (
      <div className="notice">
        Esta herramienta requiere una cuenta activa con un plan que incluya{" "}
        {feature}. Consulta los planes disponibles.
      </div>
    );
  return <>{children}</>;
}
