import {
  BrandOptions,
  renderBaseTemplate,
  RenderedEmail,
} from './base-template';

export interface LinkMailData {
  name: string;
  link: string;
}

// TODO: textos provisionales — reemplazar cuando el cliente apruebe la
// redacción definitiva de los dos correos (PF-19, "Preparación").

export function diagnosticLinkEmail(
  data: LinkMailData,
  brand?: BrandOptions,
): RenderedEmail {
  return renderBaseTemplate(
    {
      subject: 'Tu diagnóstico SCORE',
      title: `Hola, ${data.name}`,
      paragraphs: [
        'Ya puedes responder tu diagnóstico SCORE. Entra con el botón de abajo: no necesitas crear usuario ni contraseña.',
        'Puedes pausar y retomar cuando quieras desde este mismo enlace mientras siga vigente.',
      ],
      button: { text: 'Empezar mi diagnóstico', url: data.link },
      note: 'Este enlace es personal: no lo reenvíes. Si vence, puedes pedir uno nuevo desde la plataforma.',
    },
    brand,
  );
}

export function linkRecoveryEmail(
  data: LinkMailData,
  brand?: BrandOptions,
): RenderedEmail {
  return renderBaseTemplate(
    {
      subject: 'Recupera tu enlace de SCORE',
      title: `Hola, ${data.name}`,
      paragraphs: [
        'Recibimos una solicitud para recuperar el acceso a tu diagnóstico SCORE. Usa el botón de abajo para continuar donde lo dejaste.',
      ],
      button: { text: 'Continuar mi diagnóstico', url: data.link },
      note: 'Si no pediste este correo, puedes ignorarlo: tu diagnóstico sigue igual.',
    },
    brand,
  );
}

export function passwordResetEmail(
  data: LinkMailData,
  brand?: BrandOptions,
): RenderedEmail {
  return renderBaseTemplate(
    {
      subject: 'Restablece tu contraseña del panel SCORE',
      title: `Hola, ${data.name}`,
      paragraphs: [
        'Recibimos una solicitud para restablecer la contraseña de tu cuenta del panel SCORE. Usa el botón de abajo para elegir una nueva.',
        'El enlace sirve una sola vez y vence en 1 hora. Al cambiar la contraseña se cierran las sesiones que tengas abiertas.',
      ],
      button: { text: 'Restablecer contraseña', url: data.link },
      note: 'Si no pediste este cambio, ignora este correo: tu contraseña sigue igual.',
    },
    brand,
  );
}
