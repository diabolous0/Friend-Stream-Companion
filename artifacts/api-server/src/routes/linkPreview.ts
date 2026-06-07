import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";

const router: IRouter = Router();

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;

type Preview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

const cache = new Map<string, { value: Preview; expires: number }>();

function cacheGet(key: string): Preview | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) { cache.delete(key); return undefined; }
  return hit.value;
}

function cacheSet(key: string, value: Preview): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

// Reject loopback, private, link-local and other non-public ranges to prevent SSRF.
function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  if (v === 6) {
    const lc = ip.toLowerCase();
    if (lc === "::1" || lc === "::") return true;
    if (lc.startsWith("fe80") || lc.startsWith("fc") || lc.startsWith("fd")) return true;
    if (lc.startsWith("::ffff:")) return isPrivateAddress(lc.slice(7));
    return false;
  }
  return true;
}

// Resolve a hostname and return a public IP to connect to, rejecting if ANY
// resolved address is private. We connect to this exact IP (pinning) so a
// DNS-rebinding swap between validation and connection cannot reach internal
// hosts, and TLS SNI/Host stay set to the original hostname.
async function resolvePublicIp(hostname: string): Promise<{ address: string; family: number }> {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("private address");
    return { address: hostname, family: isIP(hostname) };
  }
  const results = await lookup(hostname, { all: true });
  if (results.length === 0) throw new Error("no DNS results");
  if (results.some((r) => isPrivateAddress(r.address))) throw new Error("private address");
  return { address: results[0].address, family: results[0].family };
}

function requestOnce(target: URL, ip: { address: string }): Promise<IncomingMessage> {
  const mod = target.protocol === "https:" ? https : http;
  const port = target.port || (target.protocol === "https:" ? 443 : 80);
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        host: ip.address,
        servername: target.hostname,
        port: Number(port),
        path: target.pathname + target.search,
        method: "GET",
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          host: target.host,
          "user-agent": "ScreenCrew-LinkPreview/1.0",
          accept: "text/html",
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

// Follow redirects manually, re-validating and IP-pinning every hop so a public
// URL cannot redirect into private/internal address space.
async function safeFetch(start: URL): Promise<{ res: IncomingMessage; finalUrl: URL }> {
  let current = start;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    const ip = await resolvePublicIp(current.hostname);
    const res = await requestOnce(current, ip);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      res.destroy();
      if (i === MAX_REDIRECTS) throw new Error("too many redirects");
      current = new URL(location, current);
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error("too many redirects");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&nbsp;/g, " ");
}

function metaContent(html: string, attr: "property" | "name", key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
    "i"
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content.trim()) : null;
}

function parsePreview(html: string, baseUrl: string): Preview {
  const head = html.slice(0, 200_000);
  const title =
    metaContent(head, "property", "og:title") ??
    metaContent(head, "name", "twitter:title") ??
    (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ? decodeEntities(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1].trim())
      : null);
  const description =
    metaContent(head, "property", "og:description") ??
    metaContent(head, "name", "twitter:description") ??
    metaContent(head, "name", "description");
  let image =
    metaContent(head, "property", "og:image") ??
    metaContent(head, "name", "twitter:image") ??
    metaContent(head, "property", "og:image:url");
  const siteName = metaContent(head, "property", "og:site_name");

  if (image) {
    try { image = new URL(image, baseUrl).toString(); } catch { image = null; }
    if (image && !/^https?:\/\//i.test(image)) image = null;
  }

  return { url: baseUrl, title, description, image, siteName };
}

router.get("/link-preview", requireAuth, async (req, res): Promise<void> => {
  const raw = (req.query.url as string | undefined)?.trim();
  if (!raw) { res.status(400).json({ error: "url is required" }); return; }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    res.status(400).json({ error: "Invalid URL" }); return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.status(400).json({ error: "Only http(s) URLs are supported" }); return;
  }

  const cacheKey = parsed.toString();
  const cached = cacheGet(cacheKey);
  if (cached) { res.json(cached); return; }

  let res2: IncomingMessage;
  let finalUrl: URL;
  try {
    ({ res: res2, finalUrl } = await safeFetch(parsed));
  } catch (err) {
    req.log.warn({ err }, "Link preview fetch failed");
    if (err instanceof Error && (err.message === "private address" || err.message === "unsupported protocol")) {
      res.status(400).json({ error: "URL host is not allowed" }); return;
    }
    res.status(502).json({ error: "Failed to fetch URL" }); return;
  }

  const status = res2.statusCode ?? 0;
  const contentType = res2.headers["content-type"] ?? "";
  if (status < 200 || status >= 300 || !contentType.includes("text/html")) {
    res2.destroy();
    const empty: Preview = { url: finalUrl.toString(), title: null, description: null, image: null, siteName: null };
    cacheSet(cacheKey, empty);
    res.json(empty); return;
  }

  // Read up to MAX_BYTES so a huge page can't exhaust memory.
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for await (const chunk of res2) {
      chunks.push(chunk as Buffer);
      received += (chunk as Buffer).length;
      if (received >= MAX_BYTES) break;
    }
  } catch (err) {
    req.log.warn({ err }, "Link preview read failed");
  } finally {
    res2.destroy();
  }
  const html = Buffer.concat(chunks).toString("utf8");

  const preview = parsePreview(html, finalUrl.toString());
  cacheSet(cacheKey, preview);
  res.json(preview);
});

export default router;
