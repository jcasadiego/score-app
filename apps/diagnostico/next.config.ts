import type { NextConfig } from "next";

/**
 * La Content-Security-Policy no está aquí: lleva un nonce distinto por petición,
 * así que la pone `proxy.ts`.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // El token del enlace viaja en el fragmento (`#`), que nunca va en el
  // `Referer`; aun así, a otros sitios solo se manda el origen.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  // `microphone` se habilitará solo cuando exista el modo de voz (P3).
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // La descarga del informe no manda ni el origen a otros sitios. Va
      // después: con la misma clave, gana la última regla que coincide.
      {
        source: "/report",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
