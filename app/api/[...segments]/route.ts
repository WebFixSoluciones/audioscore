import { dispatch } from "@/lib/api/dispatch";
import { handleApi } from "@/lib/security/response";
export const runtime = "nodejs";
export const maxDuration = 1800;
type Context = { params: Promise<{ segments: string[] }> };
async function route(request: Request, context: Context) {
  return handleApi(async () =>
    dispatch(request, (await context.params).segments),
  );
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
