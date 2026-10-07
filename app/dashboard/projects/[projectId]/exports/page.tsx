import { Exports } from "@/components/projects/Exports";
export default async function ExportsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return <Exports projectId={(await params).projectId} />;
}
