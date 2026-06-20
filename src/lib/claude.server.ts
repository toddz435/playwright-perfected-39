// Server-only Anthropic Claude helper. Talks to the Messages API directly via fetch
// (no SDK dependency). The API key lives in ANTHROPIC_API_KEY — a key you create and
// can see at https://console.anthropic.com (unlike the gateway key, nothing is hidden).
const ENDPOINT = "https://api.anthropic.com/v1/messages";

// Fast + cheap, well-suited to short structured tasks like selector healing.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// Cap each request so a hung connection can't park a run (and pin an open browser).
const REQUEST_TIMEOUT_MS = 30000;

function describeFetchError(e: any): string {
  return e?.name === "TimeoutError" || e?.name === "AbortError"
    ? "Claude request timed out — try again."
    : e?.message || "Claude request failed";
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  if (res.status === 429) throw new Error("Claude rate limit hit — try again in a moment.");
  if (res.status === 402)
    throw new Error("Claude credits exhausted — add credits to your Anthropic account.");
  const txt = await res.text().catch(() => "");
  throw new Error(`Claude API error ${res.status}: ${txt.slice(0, 300)}`);
}

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

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new Error(describeFetchError(e));
  }

  await throwIfNotOk(res);
  const data = await res.json();
  const block = (data.content || []).find((b: any) => b.type === "tool_use");
  if (!block) throw new Error("Claude did not return a tool call");
  return block.input;
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

// Calls Claude for a plain-text completion over a multi-turn conversation (the `messages` array
// alternates user/assistant). The single source of truth for text completions.
export async function claudeChat(opts: {
  model?: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
}): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
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
        messages: opts.messages,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new Error(describeFetchError(e));
  }

  await throwIfNotOk(res);
  const data = await res.json();
  return (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
}

// Calls Claude for a plain-text completion from a single user prompt (thin wrapper over claudeChat).
export async function claudeText(opts: {
  model?: string;
  system?: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  return claudeChat({
    model: opts.model,
    system: opts.system,
    maxTokens: opts.maxTokens,
    messages: [{ role: "user", content: opts.user }],
  });
}
