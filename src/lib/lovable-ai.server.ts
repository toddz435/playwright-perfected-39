// Server-only Lovable AI helper.
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export async function aiChat(opts: {
  model?: string;
  system?: string;
  user: string;
  tool?: { name: string; description: string; parameters: any };
}): Promise<any> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const messages: any[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const body: any = {
    model: opts.model ?? "google/gemini-3-flash-preview",
    messages,
  };
  if (opts.tool) {
    body.tools = [{ type: "function", function: opts.tool }];
    body.tool_choice = { type: "function", function: { name: opts.tool.name } };
  }

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("AI rate limit hit — try again in a moment.");
  if (res.status === 402) throw new Error("AI credits exhausted — add credits in Workspace > Usage.");
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`AI gateway error ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  if (opts.tool) {
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("AI did not return a tool call");
    try { return JSON.parse(call.function.arguments); }
    catch { throw new Error("AI returned malformed JSON"); }
  }
  return data.choices?.[0]?.message?.content ?? "";
}
