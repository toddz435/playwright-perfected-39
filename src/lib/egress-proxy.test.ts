// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import net from "node:net";
import { startEgressProxy, type EgressProxy } from "./egress-proxy.server";

// A local target server on loopback — exactly the kind of address the proxy must refuse.
let target: http.Server;
let targetPort = 0;
beforeAll(async () => {
  target = http.createServer((_req, res) => res.end("secret-internal-data"));
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", () => r()));
  targetPort = (target.address() as net.AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => target.close(() => r())));

const proxyPort = (p: EgressProxy) => Number(new URL(p.url).port);

// Plain-HTTP request through the proxy (absolute URL in the request line).
function viaProxy(p: EgressProxy, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: proxyPort(p), path: url, headers: { host: new URL(url).host } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// CONNECT tunnel through the proxy; returns the proxy's status line + whatever the target says.
function connectVia(p: EgressProxy, hostPort: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = net.connect(proxyPort(p), "127.0.0.1", () => {
      s.write(`CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n\r\n`);
    });
    let buf = "";
    let sent = false;
    s.on("data", (c) => {
      buf += c.toString();
      if (!sent && buf.includes("200 Connection Established")) {
        sent = true;
        s.write(`GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      }
    });
    s.on("end", () => resolve(buf));
    s.on("error", reject);
  });
}

describe("egress proxy (network-level SSRF guard)", () => {
  it("refuses plain HTTP to a loopback address", async () => {
    const p = await startEgressProxy();
    try {
      const r = await viaProxy(p, `http://127.0.0.1:${targetPort}/`);
      expect(r.status).toBe(403);
      expect(r.body).not.toContain("secret-internal-data");
    } finally {
      await p.close();
    }
  });

  it("refuses 'localhost' (resolves to loopback)", async () => {
    const p = await startEgressProxy();
    try {
      expect((await viaProxy(p, `http://localhost:${targetPort}/`)).status).toBe(403);
    } finally {
      await p.close();
    }
  });

  it("refuses CONNECT tunnels to private/metadata addresses", async () => {
    const p = await startEgressProxy();
    try {
      const loop = await connectVia(p, `127.0.0.1:${targetPort}`);
      expect(loop).toMatch(/^HTTP\/1\.1 403/);
      expect(loop).not.toContain("secret-internal-data");
      expect(await connectVia(p, "169.254.169.254:80")).toMatch(/^HTTP\/1\.1 403/);
      expect(await connectVia(p, "[::1]:443")).toMatch(/^HTTP\/1\.1 403/);
    } finally {
      await p.close();
    }
  });

  it("forwards allowed traffic intact (HTTP and CONNECT)", async () => {
    const p = await startEgressProxy({ isBlockedIp: () => false });
    try {
      const r = await viaProxy(p, `http://127.0.0.1:${targetPort}/`);
      expect(r.status).toBe(200);
      expect(r.body).toBe("secret-internal-data");
      const t = await connectVia(p, `127.0.0.1:${targetPort}`);
      expect(t).toContain("200 Connection Established");
      expect(t).toContain("secret-internal-data");
    } finally {
      await p.close();
    }
  });
});
