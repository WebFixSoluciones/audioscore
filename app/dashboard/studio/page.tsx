import { MusicEditor } from "@/components/editor/MusicEditor";
export default function AccountStudio() {
  const localEngine =
    process.env.LOCAL_AUDIO_ENABLED === "1" && process.env.VERCEL !== "1";
  return <MusicEditor key="new-audio" localEngine={localEngine} />;
}
