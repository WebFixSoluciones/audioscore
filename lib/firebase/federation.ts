import "server-only";
import { IdentityPoolClient } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";
import type { Credential } from "firebase-admin/app";

let client: IdentityPoolClient | undefined;
export function federationOptions() {
  const audience = process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE;
  const serviceAccount = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  if (!audience || !serviceAccount) return undefined;
  return {
    type: "external_account" as const,
    audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() },
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  };
}
export function federatedFirebase() {
  const options = federationOptions();
  if (!options) return undefined;
  client ??= new IdentityPoolClient(options);
  const authClient = client;
  const credential: Credential = {
    async getAccessToken() {
      const { token } = await authClient.getAccessToken();
      if (!token)
        throw new Error("No se pudo autenticar el servidor con Google.");
      return {
        access_token: token,
        expires_in: Math.max(
          1,
          Math.floor(
            ((authClient.credentials.expiry_date ?? Date.now() + 3600000) -
              Date.now()) /
              1000,
          ),
        ),
      };
    },
  };
  return { authClient, credential };
}
