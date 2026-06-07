import { requireUser, json } from "@/lib/server-auth.server";

type HandlerContext = {
  request: Request;
  userId: string;
  token: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>;
};

type ProtectedHandler = (ctx: HandlerContext) => Promise<Response>;

export function protectedHandler(handler: ProtectedHandler) {
  return async ({ request }: { request: Request }) => {
    try {
      const { userId, token } = await requireUser(request);
      const body = await request.json();
      return await handler({ request, userId, token, body });
    } catch (e: unknown) {
      if (e instanceof Response) return e;
      console.error(e);
      return json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
    }
  };
}
