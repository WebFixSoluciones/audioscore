import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/security/auth-guard", () => ({ requireAccount: vi.fn() }));
import { requireAccount } from "@/lib/security/auth-guard";
import { GET, POST } from "@/app/api/local/[...segments]/route";
import { ApiError } from "@/lib/utils/errors";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
describe("Firebase session gate for local audio", () => {
  it("rejects a missing, expired or suspended session before touching audio storage", async () => {
    vi.stubEnv("LOCAL_AUDIO_ENABLED", "1");
    vi.stubEnv("VERCEL", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const status of [401, 403]) {
      vi.mocked(requireAccount).mockRejectedValueOnce(
        new ApiError(status, "Cuenta no disponible"),
      );
      const response = await GET(
        new Request("http://localhost:3000/api/local/jobs"),
        { params: Promise.resolve({ segments: ["jobs"] }) },
      );
      expect(response.status).toBe(status);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the verified Firebase uid and ignores identity headers supplied by the browser", async () => {
    vi.stubEnv("LOCAL_AUDIO_ENABLED", "1");
    vi.stubEnv("LOCAL_AUDIO_TOKEN", "private-service-token");
    vi.stubEnv("VERCEL", "");
    vi.mocked(requireAccount).mockResolvedValue({
      uid: "verified-user",
      email: "test@example.test",
      role: "user",
      planId: "free",
      status: "active",
      subscriptionStatus: "active",
      projectCount: 0,
      activeJobs: 0,
    });
    const fetch = vi.fn().mockResolvedValue(Response.json({ jobs: [] }));
    vi.stubGlobal("fetch", fetch);
    const response = await POST(
      new Request("http://localhost:3000/api/local/jobs", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "x-local-user": "victim",
          "x-local-token": "fake-token",
          "x-analysis-options": '{"quality":"careful"}',
        },
        body: "audio",
      }),
      { params: Promise.resolve({ segments: ["jobs"] }) },
    );
    expect(response.ok).toBe(true);
    const headers = fetch.mock.calls[0][1].headers as Headers;
    expect(headers.get("x-local-user")).toBe("verified-user");
    expect(headers.get("x-local-token")).toBe("private-service-token");
    expect(headers.get("x-analysis-options")).toBe('{"quality":"careful"}');
    expect(response.headers.get("x-local-token")).toBeNull();
  });
  it("rejects a cross-site attempt even with a signed-in cookie", async () => {
    vi.stubEnv("LOCAL_AUDIO_ENABLED", "1");
    vi.stubEnv("VERCEL", "");
    const response = await POST(
      new Request("http://localhost:3000/api/local/jobs", {
        method: "POST",
        headers: { origin: "https://untrusted.example" },
      }),
      { params: Promise.resolve({ segments: ["jobs"] }) },
    );
    expect(response.status).toBe(403);
    expect(requireAccount).not.toHaveBeenCalled();
  });
});
