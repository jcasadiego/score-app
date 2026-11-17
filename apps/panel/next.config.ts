import type { NextConfig } from "next";

/**
 * La Content-Security-Policy no está aquí: lleva un nonce distinto por petición,
 * así que la pone `proxy.ts`.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  // El panel no usa estas capacidades del navegador.
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
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
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
