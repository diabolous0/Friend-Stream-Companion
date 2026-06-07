import { useGetLinkPreview, getGetLinkPreviewQueryKey } from "@workspace/api-client-react";

interface LinkPreviewProps {
  url: string;
}

export function LinkPreview({ url }: LinkPreviewProps) {
  const { data, isError } = useGetLinkPreview(
    { url },
    { query: { queryKey: getGetLinkPreviewQueryKey({ url }), staleTime: 30 * 60 * 1000, retry: false } }
  );

  if (isError || !data) return null;
  if (!data.title && !data.description && !data.image) return null;

  let host = "";
  try { host = new URL(data.url || url).hostname.replace(/^www\./, ""); } catch { host = ""; }

  return (
    <a
      href={data.url || url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-1 flex max-w-md overflow-hidden rounded-lg border border-border/40 bg-muted/20 hover:bg-muted/30 transition-colors"
    >
      {data.image && (
        <span className="shrink-0 w-20 bg-muted/40">
          <img src={data.image} alt="" className="h-full w-20 object-cover" loading="lazy"
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
        </span>
      )}
      <span className="flex min-w-0 flex-col justify-center gap-0.5 px-2.5 py-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60 truncate">
          {data.siteName || host}
        </span>
        {data.title && (
          <span className="text-xs font-semibold text-foreground/90 line-clamp-1">{data.title}</span>
        )}
        {data.description && (
          <span className="text-[11px] text-muted-foreground/70 line-clamp-2">{data.description}</span>
        )}
      </span>
    </a>
  );
}

const IMG_URL_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[^\s]*)?$/i;

// Extract the first non-image http(s) URL from message content (skips our screencrew markers).
export function firstPreviewableLink(content: string): string | null {
  if (/\[screencrew:/.test(content)) {
    content = content.replace(/\[screencrew:[^\]]+\]/g, " ");
  }
  const m = content.match(/https?:\/\/[^\s)>\]]+/);
  if (!m) return null;
  const url = m[0].replace(/[.,!?]+$/, "");
  if (IMG_URL_RE.test(url)) return null;
  try {
    const u = new URL(url);
    if (u.hostname === "giphy.com" || u.hostname.endsWith(".giphy.com")) return null;
  } catch { return null; }
  return url;
}
