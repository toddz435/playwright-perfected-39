// Network-level SSRF guard: a tiny forward proxy (HTTP + CONNECT) that every cloud browser is
// launched behind. For each connection it resolves the host, REFUSES it if any resolved address is
// private/internal (loopback, RFC1918, link-local/metadata, …), and connects to the exact address
// it checked — so it can't be bypassed by redirects (any hop, any engine), subresources, websockets,
// or DNS rebinding between the check and the connect.
//
// Complements the in-browser route guard (ssrf-route.server.ts), which still gives friendlier
// per-request failures and redirect vetting on Chromium. Only used when ALLOW_PRIVATE_HOSTS is off.
import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import type { Duplex } from "node:stream";
import { isPrivateIp } from "@/lib/ssrf.server";

export type EgressProxy = { url: string; close: () => Promise<void> };

type Options = {
  // Override for tests: decide whether a resolved IP may be connected to.
  isBlockedIp?: (ip: string) => boolean;
};

const CONNECT_TIMEOUT_MS = 15000;

// Resolve `host` and return the address to connect to, or null if it's (or resolves to) private.
async function vet(host: string, isBlockedIp: (ip: string) => boolean): Promise<string | null> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) return isBlockedIp(bare) ? null : bare;
  let addrs: { address: string }[];
  try {
    addrs = await lookup(bare, { all: true });
  } catch {
    return null;
  }
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) return null;
  return addrs[0].address;
}

// "host:port" (CONNECT target, IPv6 in brackets) → [host, port]
function splitHostPort(target: string, defaultPort: number): [string, number] {
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(target) || /^([^:]+)(?::(\d+))?$/.exec(target);
  if (!m) return ["", 0];
  return [m[1], m[2] ? Number(m[2]) : defaultPort];
}

function deny(socket: Duplex, why: string) {
  socket.end(
    `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n` +
      `Blocked by Testrify: ${why}\r\n`,
  );
}

export function startEgressProxy(opts: Options = {}): Promise<EgressProxy> {
  const isBlockedIp = opts.isBlockedIp ?? isPrivateIp;

  const server = http.createServer(async (req, res) => {
    // Plain-HTTP proxying: the request line carries an absolute URL.
    let url: URL;
    try {
      url = new URL(req.url || "");
    } catch {
      res.writeHead(400).end("Bad proxy request");
      return;
    }
    if (url.protocol !== "http:") {
      res.writeHead(400).end("Only http:// is proxied directly (https uses CONNECT)");
      return;
    }
    const ip = await vet(url.hostname, isBlockedIp);
    if (!ip) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end(`Blocked by Testrify: ${url.hostname} is a private/internal address`);
      return;
    }
    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: url.host };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const upstream = http.request(
      {
        host: ip,
        port: Number(url.port) || 80,
        method: req.method,
        path: url.pathname + url.search,
        headers,
        setHost: false,
        timeout: CONNECT_TIMEOUT_MS,
      },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502).end("Bad gateway");
      else res.destroy();
    });
    req.pipe(upstream);
  });

  // HTTPS (and wss) — opaque tunnel to the vetted address; TLS stays end-to-end with the browser.
  server.on("connect", async (req, client: Duplex, head: Buffer) => {
    client.on("error", () => {});
    const [host, port] = splitHostPort(req.url || "", 443);
    if (!host || !port) return deny(client, "bad CONNECT target");
    const ip = await vet(host, isBlockedIp);
    if (!ip) return deny(client, `${host} is a private/internal address`);
    const upstream = net.connect({ host: ip, port, timeout: CONNECT_TIMEOUT_MS }, () => {
      upstream.setTimeout(0);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });

  // Plain ws:// upgrades through the proxy: vet, then splice the raw upgrade through.
  server.on("upgrade", async (req, client: Duplex, head: Buffer) => {
    client.on("error", () => {});
    let url: URL;
    try {
      url = new URL(req.url || "");
    } catch {
      return deny(client, "bad upgrade target");
    }
    const ip = await vet(url.hostname, isBlockedIp);
    if (!ip) return deny(client, `${url.hostname} is a private/internal address`);
    const upstream = net.connect({ host: ip, port: Number(url.port) || 80 }, () => {
      const lines = [`${req.method} ${url.pathname + url.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        if (/^proxy-/i.test(k)) continue;
        lines.push(`${k}: ${/^host$/i.test(k) ? url.host : req.rawHeaders[i + 1]}`);
      }
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });

  server.on("clientError", (_e, socket) => socket.destroy());

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// One shared proxy per runner process, started on first use.
let shared: Promise<EgressProxy> | null = null;
export function sharedEgressProxy(): Promise<EgressProxy> {
  shared ??= startEgressProxy().catch((e) => {
    shared = null;
    throw e;
  });
  return shared;
}

// Playwright launch options that route a browser through the egress proxy — including loopback,
// which browsers bypass by default ("<-loopback>" for Chromium; a pref for Firefox).
export async function egressLaunchOptions(
  browser: "chromium" | "firefox" | "webkit" | string,
): Promise<Record<string, unknown>> {
  const { url } = await sharedEgressProxy();
  const opts: Record<string, unknown> = { proxy: { server: url, bypass: "<-loopback>" } };
  if (browser === "firefox") {
    opts.firefoxUserPrefs = {
      "network.proxy.allow_hijacking_localhost": true,
      "network.proxy.no_proxies_on": "",
    };
  }
  return opts;
}
