import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { MessageCircle, X, Send, Loader2, Sparkles, Trash2, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";

type Msg = { role: "user" | "assistant"; content: string; error?: boolean };

const SUGGESTIONS = [
  "How do I record a test?",
  "How does a dataset drive a test?",
  "How do I add a visual-regression check?",
];

// Floating in-app support assistant: a bubble bottom-right that opens a Claude-powered chat about
// using Testrify. History is ephemeral (in-memory; the endpoint is stateless and re-sent each turn).
export function SupportChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Synchronous in-flight guard — `busy` state lags a tick behind a click, so a fast double
  // send/retry could otherwise fire two requests before the disabled state takes effect.
  const inFlight = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);
  // Focus the input when the panel opens so the user can type right away.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Post a conversation (already ending in a user turn) and append the reply, or an error bubble.
  const requestReply = async (history: Msg[]) => {
    inFlight.current = true;
    setBusy(true);
    try {
      const { reply } = await apiCall<{ reply: string }>("/api/protected/support-chat", {
        messages: history,
        path,
      });
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `⚠️ ${e.message || "Something went wrong."}`,
          error: true,
        },
      ]);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || inFlight.current) return;
    // Send only real turns — drop any prior error bubbles so they aren't replayed to Claude as
    // fake assistant history (wasted tokens / confused context).
    const history: Msg[] = [...messages.filter((m) => !m.error), { role: "user", content }];
    setMessages((m) => [...m, { role: "user", content }]);
    setInput("");
    await requestReply(history);
  };

  // Re-send after a failure: drop the trailing error bubble and replay the conversation (which
  // still ends at the last user turn) — no duplicate user message.
  const retry = async () => {
    if (inFlight.current) return;
    const cleaned = messages.filter((m) => !m.error);
    if (!cleaned.length || cleaned[cleaned.length - 1].role !== "user") return;
    setMessages(cleaned);
    await requestReply(cleaned);
  };

  return (
    <>
      {/* Launcher bubble */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Ask the Testrify assistant"
          className="fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full bg-gradient-primary text-primary-foreground shadow-glow flex items-center justify-center hover:scale-105 transition"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[min(380px,calc(100vw-2.5rem))] h-[min(560px,calc(100vh-2.5rem))] flex flex-col glass rounded-2xl shadow-card border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-surface/40">
            <Sparkles className="h-4 w-4 text-primary-glow" />
            <div className="flex-1">
              <div className="text-sm font-semibold leading-none">Testrify assistant</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Help with using the app
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                title="Clear conversation"
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              title="Close"
              className="text-muted-foreground hover:text-foreground p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-sm text-muted-foreground space-y-3 mt-2">
                <p>
                  Hi! I can help you use Testrify — recording, datasets, assertions, visual checks,
                  scheduling, and more. Ask away:
                </p>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-left text-xs px-3 py-2 rounded-lg border border-border bg-surface/40 hover:bg-surface-elevated transition"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-gradient-primary text-primary-foreground"
                      : m.error
                        ? "bg-destructive/10 border border-destructive/30 text-destructive"
                        : "bg-surface/60 border border-border"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <div className="prose prose-sm prose-invert max-w-none prose-p:my-1.5 prose-ol:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-headings:my-2 prose-code:text-primary-glow">
                      <ReactMarkdown
                        components={{
                          // Open any link the assistant returns in a new tab so a doc/app link
                          // doesn't navigate away from (and unmount) the app + this chat.
                          a: ({ node: _node, ...props }) => (
                            <a {...props} target="_blank" rel="noreferrer" />
                          ),
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    m.content
                  )}
                </div>
                {m.error && i === messages.length - 1 && (
                  <button
                    onClick={retry}
                    disabled={busy}
                    className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" /> Retry
                  </button>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-surface/60 border border-border rounded-2xl px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border p-2 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Ask about Testrify…"
              className="flex-1 resize-none bg-input/50 border border-border rounded-lg px-3 py-2 text-sm max-h-28 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <Button
              size="icon"
              disabled={busy || !input.trim()}
              onClick={() => send(input)}
              className="bg-gradient-primary border-0 shrink-0"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
