import { z } from "zod";
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(
  value: unknown,
  status = 404,
  message = "This resource is unavailable.",
): asserts value {
  if (!value) throw new HttpError(status, message);
}
export const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const text = z.string().trim().min(1);
export const page = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().datetime().optional(),
  })
  .strict();
