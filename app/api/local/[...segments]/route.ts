import { localAccessAllowed } from "@/lib/audio/local/access";
import { requireAccount } from "@/lib/security/auth-guard";
import { ApiError } from "@/lib/utils/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function proxy(
  request: Request,
  context: { params: Promise<{ segments: string[] }> },
) {
  try {
    if (
      !localAccessAllowed(
        request,
        process.env.LOCAL_AUDIO_ENABLED === "1" && process.env.VERCEL !== "1",
      )
    )
      return Response.json(
        { error: "El motor local no está disponible en esta dirección." },
        { status: 403 },
      );
    const { segments } = await context.params;
    if (segments.some((s) => !/^[a-zA-Z0-9_.-]+$/.test(s) || s === ".."))
      return Response.json({ error: "Ruta inválida" }, { status: 400 });
    let account;
    try {
      account = await requireAccount();
    } catch (e) {
      return Response.json(
        {
          error:
            e instanceof ApiError
              ? e.message
              : "No se pudo verificar tu cuenta de Firebase.",
        },
        { status: e instanceof ApiError ? e.status : 503 },
      );
    }
    const headers = new Headers();
    for (const key of [
      "content-type",
      "content-length",
      "x-audio-name",
      "x-analysis-options",
      "range",
    ])
      if (request.headers.has(key)) headers.set(key, request.headers.get(key)!);
    headers.set("x-local-token", process.env.LOCAL_AUDIO_TOKEN || "");
    headers.set("x-local-user", encodeURIComponent(account.uid));
    try {
      const hasBody = request.body && !["GET", "HEAD"].includes(request.method);
      const upstream = await fetch(
        `http://127.0.0.1:8765/${segments.join("/")}${new URL(request.url).search}`,
        {
          method: request.method,
          headers,
          ...(hasBody ? { body: request.body, duplex: "half" } : {}),
          signal: request.signal,
          cache: "no-store",
        } as RequestInit,
      );
      const outgoing = new Headers();
      for (const key of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "content-disposition",
      ])
        if (upstream.headers.has(key))
          outgoing.set(key, upstream.headers.get(key)!);
      outgoing.set("cache-control", "no-store");
      return new Response(upstream.body, {
        status: upstream.status,
        headers: outgoing,
      });
    } catch {
      return Response.json(
        {
          error:
            "El motor de audio local está apagado. Inicia AudioScore con npm run local.",
        },
        { status: 503 },
      );
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error interno en el proxy local",
      },
      { status: 500 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as DELETE };
