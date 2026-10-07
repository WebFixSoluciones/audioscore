import { CloudScore } from "@/components/scores/CloudScore";
export default async function ScoresPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return <CloudScore projectId={(await params).projectId} />;
}
