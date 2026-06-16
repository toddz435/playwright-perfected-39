// Server-only AI helper. Originally targeted the Lovable AI Gateway (whose key is
// injected only inside Lovable's cloud and hidden from local dev). Repointed to the
// Anthropic Claude API, which uses ANTHROPIC_API_KEY — a key you create and can see at
// https://console.anthropic.com. The signature is unchanged so all existing callers
// (failure analysis, codegen, test generation, selector healing) work as-is.
import { claudeTool, claudeText } from "@/lib/claude.server";

// General app AI tasks (analysis/codegen) benefit from a stronger model than the
// fast Haiku default used for selector healing.
const APP_MODEL = "claude-sonnet-4-6";

export async function aiChat(opts: {
  model?: string;
  system?: string;
  user: string;
  tool?: { name: string; description: string; parameters: any };
}): Promise<any> {
  if (opts.tool) {
    // Map the OpenAI-style {parameters} schema to Claude's {input_schema}.
    return claudeTool({
      model: APP_MODEL,
      system: opts.system,
      user: opts.user,
      tool: {
        name: opts.tool.name,
        description: opts.tool.description,
        input_schema: opts.tool.parameters,
      },
    });
  }
  return claudeText({ model: APP_MODEL, system: opts.system, user: opts.user });
}
