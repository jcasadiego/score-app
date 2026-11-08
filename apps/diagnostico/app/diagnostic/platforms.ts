import type { ExternalPlatform } from "@/lib/api/types";

/** Plataformas de enlaces externos, en el orden en que se muestran. */
export const PLATFORMS: {
  id: ExternalPlatform;
  label: string;
  placeholder: string;
}[] = [
  {
    id: "SPOTIFY",
    label: "Spotify",
    placeholder: "https://open.spotify.com/artist/…",
  },
  {
    id: "YOUTUBE",
    label: "YouTube",
    placeholder: "https://www.youtube.com/@…",
  },
  {
    id: "INSTAGRAM",
    label: "Instagram",
    placeholder: "https://www.instagram.com/…",
  },
  { id: "TIKTOK", label: "TikTok", placeholder: "https://www.tiktok.com/@…" },
  { id: "WEBSITE", label: "Sitio web", placeholder: "https://…" },
];
