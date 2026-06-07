import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import {
  useListRooms,
  useGetChannels,
  getGetChannelsQueryKey,
  useGetServerInfo,
} from "@workspace/api-client-react";
import {
  Hash,
  Volume2,
  Megaphone,
  Image as ImageIcon,
  ChevronRight,
  Star,
  Server as ServerIcon,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useFavoriteRoomIds } from "@/lib/favorites";
import { getServerLabel } from "@/lib/server-connection";

function channelIcon(type: string) {
  switch (type) {
    case "voice":
      return Volume2;
    case "announcement":
      return Megaphone;
    case "media":
      return ImageIcon;
    default:
      return Hash;
  }
}

function FavoriteRoomItem({
  room,
  activeRoomId,
  activeChannelId,
  classic,
  onNavigate,
}: {
  room: { id: number; name: string };
  activeRoomId: number | null;
  activeChannelId: number | null;
  classic: boolean;
  onNavigate: (path: string) => void;
}) {
  const isActiveRoom = room.id === activeRoomId;
  const [expanded, setExpanded] = useState(isActiveRoom);
  const open = expanded || isActiveRoom;

  const { data: channels } = useGetChannels(room.id, {
    query: {
      enabled: open,
      queryKey: getGetChannelsQueryKey(room.id),
    },
  });

  const rounded = classic ? "rounded-sm" : "rounded-md";

  return (
    <div>
      <button
        onClick={() => setExpanded((s) => !s)}
        className={`group flex items-center gap-1.5 w-full px-2 py-1.5 text-left ${rounded} transition-colors ${
          isActiveRoom
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        } ${classic ? "font-mono uppercase tracking-wider text-[11px]" : "text-sm"}`}
      >
        <ChevronRight
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="truncate flex-1 font-medium">{room.name}</span>
      </button>

      {open && (
        <div className="ml-3 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-border/40 pl-2">
          {channels && channels.length > 0 ? (
            channels.map((ch: any) => {
              const Icon = channelIcon(ch.type);
              const isActiveChannel = isActiveRoom && ch.id === activeChannelId;
              return (
                <button
                  key={ch.id}
                  onClick={() => onNavigate(`/room/${room.id}?channel=${ch.id}`)}
                  className={`flex items-center gap-1.5 px-2 py-1 ${rounded} transition-colors ${
                    isActiveChannel
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground/70 hover:bg-muted/30 hover:text-foreground"
                  } ${classic ? "font-mono text-[10px]" : "text-[13px]"}`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{ch.name}</span>
                </button>
              );
            })
          ) : (
            <span className="px-2 py-1 text-[11px] text-muted-foreground/40">
              {channels ? "No channels" : "…"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function NavColumn() {
  const [, setLocation] = useLocation();
  const [matchRoom, roomParams] = useRoute("/room/:roomId");
  const { theme } = useTheme();
  const classic = theme === "classic";

  const activeRoomId =
    matchRoom && roomParams?.roomId ? parseInt(roomParams.roomId, 10) : null;
  const activeChannelId = (() => {
    const cid = new URLSearchParams(window.location.search).get("channel");
    return cid ? parseInt(cid, 10) : null;
  })();

  const { data: serverInfo } = useGetServerInfo({ query: { queryKey: ["serverInfo"] } });
  const { data: rooms } = useListRooms({ query: { queryKey: ["listRooms"] } });

  const favIds = useFavoriteRoomIds();
  const favoriteRooms = (rooms ?? []).filter((r: any) => favIds.includes(r.id));

  const serverName = serverInfo?.serverName || getServerLabel();

  return (
    <aside className="flex flex-col w-60 shrink-0 h-full bg-card/30 border-r border-border/50">
      <div
        className={`flex items-center gap-2 px-3 h-12 shrink-0 border-b border-border/50 ${
          classic ? "font-mono uppercase tracking-widest text-primary" : ""
        }`}
      >
        <ServerIcon className="w-4 h-4 text-primary shrink-0" />
        <span className="font-semibold text-sm truncate">{serverName}</span>
      </div>

      <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
        <Star className="w-3.5 h-3.5 text-primary/70" />
        <span
          className={`text-[11px] font-semibold uppercase tracking-widest ${
            classic ? "font-mono text-primary/70" : "text-muted-foreground/60"
          }`}
        >
          Favorite Rooms
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {favoriteRooms.length > 0 ? (
          favoriteRooms.map((room: any) => (
            <FavoriteRoomItem
              key={room.id}
              room={room}
              activeRoomId={activeRoomId}
              activeChannelId={activeChannelId}
              classic={classic}
              onNavigate={setLocation}
            />
          ))
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground/50 leading-relaxed">
            Star a room to pin it here for quick access.
          </p>
        )}
      </div>

      <button
        onClick={() => setLocation("/rooms")}
        className={`m-2 px-3 py-2 text-xs font-medium border border-border/50 transition-colors text-muted-foreground hover:text-primary hover:border-primary/40 ${
          classic ? "rounded-sm font-mono uppercase tracking-wider" : "rounded-md"
        }`}
      >
        All Rooms
      </button>
    </aside>
  );
}
