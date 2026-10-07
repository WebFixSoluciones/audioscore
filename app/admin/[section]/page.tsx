import { notFound } from "next/navigation";
import { AdminPanel } from "@/components/admin/AdminPanel";
import { AdminPlans } from "@/components/admin/AdminPlans";
import { AdminOverview } from "@/components/admin/AdminOverview";
export default async function AdminSection({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (
    ![
      "overview",
      "users",
      "plans",
      "jobs",
      "usage",
      "logs",
      "settings",
    ].includes(section)
  )
    notFound();
  if (section === "overview") return <AdminOverview />;
  if (section === "plans") return <AdminPlans />;
  return <AdminPanel section={section} />;
}
