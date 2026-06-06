import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { SearchGiphyQueryParams, SearchGiphyResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const GIPHY_ENDPOINT = "https://api.giphy.com/v1/gifs";
const GIPHY_TIMEOUT_MS = 5000;

function isGiphyUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "giphy.com" || u.hostname.endsWith(".giphy.com"));
  } catch {
    return false;
  }
}

type GiphyImage = { url?: string; width?: string; height?: string };
type GiphyItem = {
  id?: string;
  title?: string;
  images?: {
    fixed_height?: GiphyImage;
    fixed_height_downsampled?: GiphyImage;
    fixed_height_small?: GiphyImage;
    preview_gif?: GiphyImage;
  };
};

router.get("/giphy/search", requireAuth, async (req, res): Promise<void> => {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Giphy is not configured" });
    return;
  }

  const parsed = SearchGiphyQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const q = parsed.data.q?.trim() ?? "";
  const limit = Math.min(Math.max(parsed.data.limit, 1), 50);

  const params = new URLSearchParams({
    api_key: apiKey,
    limit: String(limit),
    rating: "pg-13",
    bundle: "messaging_non_clips",
  });
  let url: string;
  if (q) {
    params.set("q", q);
    url = `${GIPHY_ENDPOINT}/search?${params.toString()}`;
  } else {
    url = `${GIPHY_ENDPOINT}/trending?${params.toString()}`;
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(GIPHY_TIMEOUT_MS) });
  } catch (err) {
    req.log.error({ err }, "Giphy request failed");
    res.status(502).json({ error: "Failed to reach Giphy" });
    return;
  }

  if (!upstream.ok) {
    req.log.error({ status: upstream.status }, "Giphy returned an error");
    res.status(502).json({ error: "Giphy returned an error" });
    return;
  }

  let body: { data?: GiphyItem[] };
  try {
    body = (await upstream.json()) as { data?: GiphyItem[] };
  } catch (err) {
    req.log.error({ err }, "Giphy returned invalid JSON");
    res.status(502).json({ error: "Giphy returned an invalid response" });
    return;
  }
  const items = Array.isArray(body?.data) ? body.data : [];

  const mapped = items
    .map((g) => {
      const imgs = g.images ?? {};
      const main = imgs.fixed_height ?? imgs.fixed_height_downsampled;
      const preview = imgs.fixed_height_small ?? imgs.preview_gif ?? main;
      if (!g.id || !main?.url || !preview?.url) return null;
      if (!isGiphyUrl(main.url) || !isGiphyUrl(preview.url)) return null;
      return {
        id: g.id,
        url: main.url,
        previewUrl: preview.url,
        title: g.title ?? "",
        width: Number(main.width) || 0,
        height: Number(main.height) || 0,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  res.json(SearchGiphyResponse.parse(mapped));
});

export default router;
