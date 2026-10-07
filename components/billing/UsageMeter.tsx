"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/firebase/client";
import type { Plan } from "@/lib/billing/plans";
import { messageOf } from "@/lib/utils/errors";
export function UsageMeter() {
  const [usage, setUsage] = useState<{
      minutesUsed: number;
      minutesReserved: number;
      plan: Plan;
    }>(),
    [error, setError] = useState("");
  useEffect(() => {
    void api<typeof usage>("/api/usage/current")
      .then(setUsage)
      .catch((e) => setError(messageOf(e)));
  }, []);
  return (
    <section className="detail-card">
      <h3>Consumo del mes</h3>
      {error && <p className="error-text">{error}</p>}
      {usage && (
        <>
          <p>
            Plan {usage.plan.name} · {usage.minutesUsed.toFixed(1)} de{" "}
            {usage.plan.monthlyAudioMinutes} minutos consumidos ·{" "}
            {usage.minutesReserved.toFixed(1)} reservados
          </p>
          <progress
            max={usage.plan.monthlyAudioMinutes}
            value={usage.minutesUsed + usage.minutesReserved}
          />
        </>
      )}
    </section>
  );
}
