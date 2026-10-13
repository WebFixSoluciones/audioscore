import { notFound } from "next/navigation";
import { requireAccount } from "@/lib/security/auth-guard";
import { localBackend } from "@/lib/audio/local/server";
import type { LocalJob } from "@/lib/audio/local/types";
import { MusicEditor } from "@/components/editor/MusicEditor";
import { ApiError } from "@/lib/utils/errors";
export default async function LocalProjectPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  if (!/^[a-f0-9-]{36}$/.test(jobId)) notFound();
  const account = await requireAccount();
  let job: LocalJob;
  try {
    job = (await localBackend<{ job: LocalJob }>(`jobs/${jobId}`, account.uid))
      .job;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  if (!job.savedAt || job.status !== "completed") notFound();
  return <MusicEditor key={jobId} localEngine initialLocalJobId={jobId} />;
}
