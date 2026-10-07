import { notFound } from "next/navigation";
import { AdminPanel } from "@/components/admin/AdminPanel";
export default async function AdminSection({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (
    !["users", "plans", "jobs", "usage", "logs", "settings"].includes(section)
  )
    notFound();
  return <AdminPanel section={section} />;
}
