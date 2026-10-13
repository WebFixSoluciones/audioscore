import "server-only";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { audibleGain, panMatrix, type ChannelMix } from "./mixer";
export async function renderStemMix(
  inputs: { path: string; channel: ChannelMix }[],
  output: string,
) {
  const hasSolo = inputs.some(({ channel }) => channel.solo);
  const audible = inputs.filter(
    ({ channel }) => audibleGain(channel, hasSolo) > 0,
  );
  if (!audible.length)
    throw new Error("La mezcla está silenciada. Activa al menos una pista.");
  const filters = audible.map(({ channel }, index) => {
    const [ll, rl, lr, rr] = panMatrix(channel.pan);
    return `[${index}:a]volume=${audibleGain(channel, hasSolo)},pan=stereo|c0=${ll}*c0+${rl}*c1|c1=${lr}*c0+${rr}*c1[a${index}]`;
  });
  filters.push(
    `${audible.map((_, i) => `[a${i}]`).join("")}amix=inputs=${audible.length}:normalize=0:duration=longest[mix]`,
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.env.FFMPEG_PATH || ffmpegStatic!,
      [
        "-y",
        "-v",
        "error",
        ...audible.flatMap(({ path }) => ["-i", path]),
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[mix]",
        "-ar",
        "44100",
        "-c:a",
        "pcm_s16le",
        output,
      ],
      { windowsHide: true },
    );
    let error = "";
    child.stderr.on("data", (b: Buffer) => {
      error = (error + b.toString()).slice(-1000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("La mezcla tardó demasiado en exportarse"));
    }, 120000);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`No se pudo exportar la mezcla: ${error}`));
    });
  });
}
