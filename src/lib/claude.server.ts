// Server-only Anthropic Claude helper. Talks to the Messages API directly via fetch
// (no SDK dependency). The API key lives in ANTHROPIC_API_KEY — a key you create and
// can see at https://console.anthropic.com (unlike the gateway key, nothing is hidden).
const ENDPOINT = "https://api.anthropic.com/v1/messages";

// Fast + cheap, well-suited to short structured tasks like selector healing.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function hasClaudeKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Calls Claude forcing a single tool call, and returns the validated tool input object.
export async function claudeTool(opts: {
  model?: string;
  system?: string;
  user: string;
  maxTokens?: number;
  tool: { name: string; description: string; input_schema: any };
}): Promise<any> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      tools: [opts.tool],
      tool_choice: { type: "tool", name: opts.tool.name },
    }),
  });

  if (res.status === 429) throw new Error("Claude rate limit hit — try again in a moment.");
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude API error ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((b: any) => b.type === "tool_use");
  if (!block) throw new Error("Claude did not return a tool call");
  return block.input;
}

// Calls Claude for a plain-text completion.
export async function claudeText(opts: {
  model?: string;
  system?: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });

  if (res.status === 429) throw new Error("Claude rate limit hit — try again in a moment.");
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude API error ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
}
