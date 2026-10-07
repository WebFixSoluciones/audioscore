export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado";
}
export function log(
  level: "info" | "error",
  event: string,
  fields: Record<string, unknown> = {},
) {
  console[level](
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    }),
  );
}
