import "server-only";
import { rm, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative, basename, join } from "node:path";
export async function createTemporaryDirectory(
  purpose: "job" | "upload" | "export" | "test",
) {
  const root = join(tmpdir(), "audioscore-ai");
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, `audioscore-${purpose}-`));
}
export async function removeTemporaryDirectory(folder: string) {
  const absolute = resolve(folder),
    root = resolve(tmpdir(), "audioscore-ai"),
    local = relative(root, absolute);
  if (
    local.startsWith("..") ||
    local.includes("\\") ||
    local.includes("/") ||
    !basename(absolute).startsWith("audioscore-") ||
    absolute === root
  )
    throw new Error(
      "La limpieza rechazó un directorio fuera del área temporal de AudioScore",
    );
  await rm(absolute, { recursive: true, force: true });
}
