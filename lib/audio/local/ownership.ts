import type { LocalJob } from "./types";
export function ownsLocalJob(
  job: LocalJob | undefined,
  uid: string,
): job is LocalJob {
  return Boolean(uid && job?.ownerUid === uid);
}
export function savedLocalProjects(jobs: Iterable<LocalJob>, uid: string) {
  return [...jobs]
    .filter(
      (job) =>
        ownsLocalJob(job, uid) &&
        job.status === "completed" &&
        Boolean(job.savedAt),
    )
    .sort((a, b) => b.savedAt!.localeCompare(a.savedAt!));
}
