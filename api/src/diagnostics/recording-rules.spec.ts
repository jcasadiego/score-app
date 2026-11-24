import { AudioFormat } from '../../generated/prisma/enums';
import { detectAudioFormat } from './recording-rules';

const WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]),
  Buffer.from('B\x82\x84webmB\x87\x81\x04', 'latin1'),
  Buffer.alloc(32),
]);
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x1c]),
  Buffer.from('ftypM4A \x00\x00\x00\x00', 'latin1'),
  Buffer.alloc(32),
]);

describe('detectAudioFormat', () => {
  it('reconoce WebM de Chrome, con o sin parámetros de códec', () => {
    expect(detectAudioFormat(WEBM, 'audio/webm;codecs=opus')).toBe(
      AudioFormat.WEBM,
    );
    expect(detectAudioFormat(WEBM, 'audio/webm')).toBe(AudioFormat.WEBM);
  });

  it('reconoce MP4 de Safari', () => {
    expect(detectAudioFormat(MP4, 'audio/mp4')).toBe(AudioFormat.MP4);
    expect(detectAudioFormat(MP4, 'audio/x-m4a')).toBe(AudioFormat.MP4);
  });

  it('rechaza un tipo declarado que no coincide con el contenido', () => {
    expect(detectAudioFormat(MP4, 'audio/webm')).toBeNull();
    expect(detectAudioFormat(WEBM, 'audio/mp4')).toBeNull();
  });

  it('rechaza otros tipos aunque digan audio, y contenido que no es audio', () => {
    expect(detectAudioFormat(WEBM, 'audio/ogg')).toBeNull();
    expect(detectAudioFormat(WEBM, 'text/html')).toBeNull();
    expect(
      detectAudioFormat(Buffer.from('<script>alert(1)</script>'), 'audio/webm'),
    ).toBeNull();
    expect(detectAudioFormat(Buffer.alloc(0), 'audio/mp4')).toBeNull();
  });

  it('rechaza un EBML que no es WebM (por ejemplo, Matroska)', () => {
    const mkv = Buffer.from(WEBM);
    mkv.write('matr', WEBM.indexOf('webm'), 'latin1');
    expect(detectAudioFormat(mkv, 'audio/webm')).toBeNull();
  });
});
