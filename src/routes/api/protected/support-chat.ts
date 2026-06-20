import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { claudeChat, hasClaudeKey, type ChatMessage } from "@/lib/claude.server";
import { SUPPORT_SYSTEM } from "@/lib/support-knowledge";

// In-app support assistant: answers "how do I use Testrify" questions, grounded in SUPPORT_SYSTEM.
// Stateless — the client sends the running conversation each turn (history is ephemeral). We trim
// and length-cap the history server-side so a long chat (or a crafted payload) can't run up cost.
const MAX_TURNS = 20; // keep only the most recent N messages
const MAX_CHARS = 4000; // per-message content cap

export const Route = createFileRoute("/api/protected/support-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          if (!hasClaudeKey())
            return json(
              { error: "The assistant isn't configured on this server (ANTHROPIC_API_KEY missing)." },
              { status: 400 },
            );

          const body = await request.json();
          const raw = Array.isArray(body?.messages) ? body.messages : null;
          if (!raw || !raw.length)
            return json({ error: "messages required" }, { status: 400 });

          // Sanitize: keep only well-formed user/assistant turns, cap length, keep the last N.
          const messages: ChatMessage[] = raw
            .filter(
              (m: any) =>
                m &&
                (m.role === "user" || m.role === "assistant") &&
                typeof m.content === "string" &&
                m.content.trim().length > 0,
            )
            .slice(-MAX_TURNS)
            .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_CHARS) }));

          if (!messages.length || messages[messages.length - 1].role !== "user")
            return json({ error: "The last message must be from the user." }, { status: 400 });

          // Only accept a clean route-shaped path before interpolating it into the system prompt
          // (defense-in-depth against newline/quote injection from a crafted URL).
          const rawPath = typeof body?.path === "string" ? body.path : "";
          const path = /^[\w/\-.]{1,120}$/.test(rawPath) ? rawPath : "";
          const system = path
            ? `${SUPPORT_SYSTEM}\n\nContext: the user is currently on the "${path}" page.`
            : SUPPORT_SYSTEM;

          const reply = await claudeChat({ system, messages, maxTokens: 1024 });
          return json({ reply });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
