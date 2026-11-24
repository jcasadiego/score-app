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
  // Micrófono solo para este origen: responder por voz (P3, PF-87).
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(self), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // En Render, el build lleva el SHA del commit como id (PF-71): el workflow de
  // despliegue confirma que la versión nueva está arriba pidiendo
  // `/_next/static/<sha>/_ssgManifest.js`. Fuera de Render, el id por defecto.
  generateBuildId: async () => {
    const commit = process.env.RENDER_GIT_COMMIT;
    return commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null;
  },
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
