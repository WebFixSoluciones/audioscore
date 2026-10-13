import { Shell } from "@/components/layout/Shell";
import { MusicEditor } from "@/components/editor/MusicEditor";
import { redirect } from "next/navigation";
export default function Studio() {
  const localEngine =
    process.env.LOCAL_AUDIO_ENABLED === "1" && process.env.VERCEL !== "1";
  if (localEngine) redirect("/dashboard/studio");
  return (
    <Shell localMode={localEngine}>
      <MusicEditor localEngine={localEngine} />
    </Shell>
  );
}
