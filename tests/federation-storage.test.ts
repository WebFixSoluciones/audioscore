import { afterEach, expect, it, vi } from "vitest";
import { Storage } from "@google-cloud/storage";
import { federationOptions } from "@/lib/firebase/federation";
afterEach(() => vi.unstubAllEnvs());
it("lets the Storage SDK build its own compatible federated auth client without private credentials", async () => {
  vi.stubEnv(
    "GCP_WORKLOAD_IDENTITY_AUDIENCE",
    "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/test/providers/vercel",
  );
  vi.stubEnv(
    "GCP_SERVICE_ACCOUNT_EMAIL",
    "web@test-project.iam.gserviceaccount.com",
  );
  const sdk = new Storage({
    projectId: "test-project",
    credentials: federationOptions(),
  });
  const client = await sdk.authClient.getClient();
  expect(client.constructor.name).toBe("IdentityPoolClient");
  expect((await sdk.authClient.getCredentials()).client_email).toBe(
    "web@test-project.iam.gserviceaccount.com",
  );
});
