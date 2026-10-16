// Live-view tickets: a short-lived, signed pass that lets ONE user's browser open a WebSocket
// straight to the cloud runner to watch ONE run ("watch") or drive ONE cloud recording ("record"). The Worker signs (it knows the user from their
// Supabase JWT); the runner verifies. Both share RUNNER_SECRET, which never reaches the browser.
//
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, payloadPart)).
import { createHmac, timingSafeEqual } from "node:crypto";

// A ticket is only valid for the kind it was issued for — a watch pass can't start a recording.
export type TicketKind = "watch" | "record";
export type LiveTicket = { userId: string; liveId: string; exp: number; kind: TicketKind };

export const LIVE_TICKET_TTL_MS = 2 * 60 * 1000;

// Client-generated run handle — a UUID, so it's unguessable and safe in a URL.
const LIVE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidLiveId(id: unknown): id is string {
  return typeof id === "string" && LIVE_ID_RE.test(id);
}

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signLiveTicket(
  secret: string,
  userId: string,
  liveId: string,
  kind: TicketKind,
  now = Date.now(),
): string {
  if (!secret) throw new Error("RUNNER_SECRET not set");
  if (!isValidLiveId(liveId)) throw new Error("invalid liveId");
  const payload: LiveTicket = { userId, liveId, exp: now + LIVE_TICKET_TTL_MS, kind };
  const part = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${part}.${sign(secret, part)}`;
}

// Returns the ticket's payload, or null if it's malformed, forged, expired, or of another kind.
export function verifyLiveTicket(
  secret: string,
  ticket: string,
  kind: TicketKind,
  now = Date.now(),
): LiveTicket | null {
  if (!secret || typeof ticket !== "string") return null;
  const [part, mac, extra] = ticket.split(".");
  if (!part || !mac || extra !== undefined) return null;
  const want = Buffer.from(sign(secret, part));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let payload: LiveTicket;
  try {
    payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload?.userId !== "string" || !payload.userId) return null;
  if (!isValidLiveId(payload.liveId)) return null;
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  // Tickets minted before kinds existed were all watch passes.
  if ((payload.kind ?? "watch") !== kind) return null;
  return payload;
}
