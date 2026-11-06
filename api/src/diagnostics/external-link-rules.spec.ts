import { ExternalPlatform } from '../../generated/prisma/enums';
import { validateExternalLink } from './external-link-rules';

describe('validateExternalLink', () => {
  it.each([
    [ExternalPlatform.SPOTIFY, 'https://open.spotify.com/artist/abc'],
    [ExternalPlatform.SPOTIFY, 'https://spotify.link/xyz'],
    [ExternalPlatform.YOUTUBE, 'https://www.youtube.com/@banda'],
    [ExternalPlatform.YOUTUBE, 'https://youtu.be/abc'],
    [ExternalPlatform.YOUTUBE, 'https://music.youtube.com/channel/x'],
    [ExternalPlatform.INSTAGRAM, 'https://www.instagram.com/banda'],
    [ExternalPlatform.TIKTOK, 'https://www.tiktok.com/@banda'],
    [ExternalPlatform.WEBSITE, 'https://banda.com.mx/discos'],
  ])('acepta %s %s', (platform, url) => {
    expect(validateExternalLink(platform, url)).toEqual({
      url: new URL(url).href,
    });
  });

  it('recorta espacios y normaliza la URL', () => {
    expect(
      validateExternalLink(ExternalPlatform.WEBSITE, '  https://Banda.com  '),
    ).toEqual({ url: 'https://banda.com/' });
  });

  it.each([
    ['http', ExternalPlatform.WEBSITE, 'http://banda.com'],
    ['javascript', ExternalPlatform.WEBSITE, 'javascript:alert(1)'],
    ['sin URL', ExternalPlatform.WEBSITE, 'banda.com'],
    ['IP', ExternalPlatform.WEBSITE, 'https://10.0.0.1/admin'],
    ['IPv6', ExternalPlatform.WEBSITE, 'https://[::1]/'],
    ['localhost', ExternalPlatform.WEBSITE, 'https://localhost/'],
    [
      'subdominio de localhost',
      ExternalPlatform.WEBSITE,
      'https://api.localhost/',
    ],
    ['usuario en la URL', ExternalPlatform.WEBSITE, 'https://a:b@banda.com'],
    ['puerto propio', ExternalPlatform.WEBSITE, 'https://banda.com:8443/'],
    ['otro dominio', ExternalPlatform.SPOTIFY, 'https://spotify.evil.com/x'],
    [
      'dominio parecido',
      ExternalPlatform.INSTAGRAM,
      'https://notinstagram.com/x',
    ],
    [
      'plataforma cruzada',
      ExternalPlatform.TIKTOK,
      'https://www.youtube.com/x',
    ],
  ])('rechaza %s', (_case, platform, url) => {
    expect(validateExternalLink(platform, url)).toHaveProperty('error');
  });

  it('rechaza una URL demasiado larga', () => {
    const url = `https://banda.com/${'a'.repeat(2100)}`;
    expect(validateExternalLink(ExternalPlatform.WEBSITE, url)).toHaveProperty(
      'error',
    );
  });
});
