import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock supabase before importing apiCall
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

import { apiCall } from "./api-client";
import { supabase } from "@/integrations/supabase/client";

describe("apiCall", () => {
  const mockGetSession = vi.mocked(supabase.auth.getSession);

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "test-token" } },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a POST request with JSON body", async () => {
    await apiCall("/api/test", { key: "value" });
    expect(fetch).toHaveBeenCalledWith("/api/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ key: "value" }),
    });
  });

  it("includes Authorization header when session exists", async () => {
    await apiCall("/api/test");
    const callArgs = vi.mocked(fetch).mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
  });

  it("omits Authorization header when no session", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    await apiCall("/api/test");
    const callArgs = vi.mocked(fetch).mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("returns parsed JSON on success", async () => {
    const result = await apiCall("/api/test");
    expect(result).toEqual({ result: "ok" });
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "bad request" }), {
          status: 400,
        }),
      ),
    );
    await expect(apiCall("/api/test")).rejects.toThrow("bad request");
  });

  it("throws generic message when no error field in response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await expect(apiCall("/api/test")).rejects.toThrow("Request failed: 500");
  });

  it("sends empty object when no body provided", async () => {
    await apiCall("/api/test");
    const callArgs = vi.mocked(fetch).mock.calls[0];
    expect(callArgs[1]?.body).toBe(JSON.stringify({}));
  });

  it("handles non-JSON response text gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("plain text", { status: 200 })));
    const result = await apiCall("/api/test");
    expect(result).toEqual({ raw: "plain text" });
  });
});
