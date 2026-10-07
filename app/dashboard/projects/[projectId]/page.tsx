import { requireAccount } from "@/lib/security/auth-guard";
import { ownedProject } from "@/lib/security/ownership";
import { MusicEditor } from "@/components/editor/MusicEditor";
import Link from "next/link";
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const account = await requireAccount();
  const project = await ownedProject(account.uid, projectId);
  return (
    <>
      <div style={{ padding: "15px 34px 0" }}>
        <Link
          className="text-button"
          href={`/dashboard/projects/${projectId}/exports`}
        >
          Ver exportaciones y descargas →
        </Link>
      </div>
      <MusicEditor projectId={projectId} initial={project} />
    </>
  );
}
