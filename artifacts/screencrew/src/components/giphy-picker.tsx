import { useEffect, useState } from "react";
import { useSearchGiphy } from "@workspace/api-client-react";
import { Loader2, Search, X } from "lucide-react";

interface GiphyPickerProps {
  query: string;
  onPick: (url: string) => void;
  onClose: () => void;
}

export function GiphyPicker({ query, onPick, onClose }: GiphyPickerProps) {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isLoading, error } = useSearchGiphy(
    { q: debounced || undefined, limit: 18 },
    { query: { queryKey: ["giphy", debounced] } },
  );

  const notConfigured = (error as { status?: number } | null)?.status === 503;
  const gifs = data ?? [];

  return (
    <div className="mb-2 rounded-xl border border-primary/25 bg-card/95 backdrop-blur-sm shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
        <Search className="w-3.5 h-3.5 text-primary/60 shrink-0" />
        <span className="text-xs font-semibold text-foreground/80 truncate">
          {debounced ? <>GIPHY · <span className="text-primary/80">{debounced}</span></> : "GIPHY · trending"}
        </span>
        <span className="ml-auto text-[9px] font-bold tracking-wide text-muted-foreground/40">GIPHY</span>
        <button onClick={onClose} title="Close" className="text-muted-foreground/40 hover:text-foreground transition-colors shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="max-h-52 overflow-y-auto p-2">
        {notConfigured ? (
          <div className="py-6 text-center text-xs text-muted-foreground/60 px-3">
            GIFs aren't set up yet — a Giphy API key is needed on the server.
          </div>
        ) : error ? (
          <div className="py-6 text-center text-xs text-red-400/70">Couldn't load GIFs. Try again.</div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-primary/60 animate-spin" />
          </div>
        ) : gifs.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground/60">No GIFs found.</div>
        ) : (
          <div className="columns-3 gap-2 [&>*]:mb-2">
            {gifs.map(g => (
              <button
                key={g.id}
                onClick={() => onPick(g.url)}
                title={g.title || "Send GIF"}
                className="block w-full overflow-hidden rounded-lg border border-border/30 hover:border-primary/60 transition-colors focus:outline-none focus:border-primary">
                <img src={g.previewUrl} alt={g.title || "gif"} loading="lazy"
                  className="w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
