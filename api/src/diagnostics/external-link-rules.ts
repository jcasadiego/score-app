import { isIP } from 'node:net';
import { ExternalPlatform } from '../../generated/prisma/enums';

export const EXTERNAL_LINK_MAX = 2048;

/**
 * Dominios permitidos por plataforma: el dominio exacto o un subdominio suyo.
 * El sitio web propio admite cualquier dominio público.
 */
const ALLOWED_DOMAINS: Record<
  Exclude<ExternalPlatform, 'WEBSITE'>,
  string[]
> = {
  SPOTIFY: ['spotify.com', 'spotify.link'],
  YOUTUBE: ['youtube.com', 'youtu.be'],
  INSTAGRAM: ['instagram.com'],
  TIKTOK: ['tiktok.com'],
};

const PLATFORM_LABEL: Record<ExternalPlatform, string> = {
  SPOTIFY: 'Spotify',
  YOUTUBE: 'YouTube',
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  WEBSITE: 'sitio web',
};

function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Valida un enlace externo y lo devuelve normalizado, o el motivo del rechazo.
 * Solo `https`, sin usuario ni contraseña en la URL, sin puerto propio y con un
 * nombre de dominio (nunca una IP ni `localhost`).
 */
export function validateExternalLink(
  platform: ExternalPlatform,
  raw: string,
): { url: string } | { error: string } {
  const label = PLATFORM_LABEL[platform];
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: `El enlace de ${label} no es una URL válida.` };
  }

  if (url.protocol !== 'https:') {
    return { error: `El enlace de ${label} debe empezar con https://.` };
  }
  if (url.username || url.password || url.port) {
    return {
      error: `El enlace de ${label} no puede llevar usuario, contraseña ni puerto.`,
    };
  }
  const hostname = url.hostname.toLowerCase();
  if (
    isIP(hostname.replace(/^\[|\]$/g, '')) !== 0 ||
    !hostname.includes('.') ||
    hostname.endsWith('.localhost')
  ) {
    return { error: `El enlace de ${label} debe usar un dominio público.` };
  }
  if (platform !== ExternalPlatform.WEBSITE) {
    const domains = ALLOWED_DOMAINS[platform];
    if (!domains.some((domain) => matchesDomain(hostname, domain))) {
      return {
        error: `El enlace de ${label} debe ser de ${domains.join(' o ')}.`,
      };
    }
  }
  if (url.href.length > EXTERNAL_LINK_MAX) {
    return {
      error: `El enlace de ${label} no puede superar ${EXTERNAL_LINK_MAX} caracteres.`,
    };
  }
  return { url: url.href };
}
