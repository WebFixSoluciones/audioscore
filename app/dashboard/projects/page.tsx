import { ProjectList } from "@/components/projects/ProjectList";
import { LocalProjects } from "@/components/projects/LocalProjects";
export default function ProjectsPage() {
  return process.env.LOCAL_AUDIO_ENABLED === "1" &&
    process.env.VERCEL !== "1" ? (
    <LocalProjects />
  ) : (
    <ProjectList />
  );
}
