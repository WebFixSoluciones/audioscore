import { ZodError } from "zod";
import { ApiError, log, messageOf } from "@/lib/utils/errors";
export async function handleApi(work: () => Promise<unknown>) {
  try {
    return Response.json(await work(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ZodError)
      return Response.json(
        {
          error: "Datos inválidos",
          issues: e.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    if (e instanceof ApiError)
      return Response.json({ error: e.message }, { status: e.status });
    log("error", "api_error", { message: messageOf(e) });
    return Response.json(
      { error: "No se pudo completar la operación. Inténtalo de nuevo." },
      { status: 500 },
    );
  }
}
