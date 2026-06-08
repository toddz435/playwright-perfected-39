/**
 * Validates an agent API key from the Authorization header.
 * MVP: compares against TESTRIFY_AGENT_KEY env var.
 * Phase 4: will query the agent_keys table in Supabase.
 */
export function requireAgentKey(request: Request): { agentId: string } {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "Missing agent API key" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const key = auth.slice(7);
  const expectedKey = process.env.TESTRIFY_AGENT_KEY;

  if (!expectedKey) {
    throw new Response(
      JSON.stringify({
        error: "Agent key not configured on server (set TESTRIFY_AGENT_KEY)",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  if (key !== expectedKey) {
    throw new Response(JSON.stringify({ error: "Invalid agent API key" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  // MVP: all valid keys map to a single agent identity
  return { agentId: "default-agent" };
}
