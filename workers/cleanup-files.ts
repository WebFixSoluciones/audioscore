import { cleanupAssets, recoverUndispatchedJobs } from "../lib/jobs/cleanup";
async function main() {
  console.log(
    JSON.stringify({
      cleanup: await cleanupAssets(),
      recovery: await recoverUndispatchedJobs(),
    }),
  );
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
