import { DiagnosticFamily } from '../../../generated/prisma/enums';
import {
  BrandOptions,
  renderBaseTemplate,
  RenderedEmail,
} from './base-template';

export interface LinkMailData {
  name: string;
  link: string;
}

export interface NewLeadNoticeData {
  name: string;
  family: DiagnosticFamily;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  link: string;
}

export interface DiagnosticCompletedNoticeData {
  leadName: string;
  family: DiagnosticFamily;
  link: string;
}

const FAMILY_LABEL: Record<DiagnosticFamily, string> = {
  PROJECT: 'Proyecto',
  B2B: 'B2B',
  PROFESSIONAL: 'Profesional',
  CATALOG: 'Catálogo',
};

const TEAM_NOTICE_FOOTER =
  'Recibes este aviso porque tienes una cuenta activa en el panel SCORE.';

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

// El nombre y los UTM los escribe cualquiera en el formulario público: van solo
// en el cuerpo, escapados por la plantilla, nunca en el asunto.
export function newLeadNoticeEmail(
  data: NewLeadNoticeData,
  brand?: BrandOptions,
): RenderedEmail {
  const campaignOrigin =
    [data.utmSource, data.utmMedium, data.utmCampaign]
      .filter(Boolean)
      .join(' / ') || 'sin datos';

  return renderBaseTemplate(
    {
      subject: 'Nuevo lead en SCORE',
      title: 'Llegó un lead nuevo',
      paragraphs: [
        `Nombre: ${data.name}`,
        `Familia: ${FAMILY_LABEL[data.family]}`,
        `Origen de campaña: ${campaignOrigin}`,
      ],
      button: { text: 'Ver leads en el panel', url: data.link },
      footerReason: TEAM_NOTICE_FOOTER,
    },
    brand,
  );
}

export function diagnosticCompletedNoticeEmail(
  data: DiagnosticCompletedNoticeData,
  brand?: BrandOptions,
): RenderedEmail {
  return renderBaseTemplate(
    {
      subject: 'Diagnóstico listo para revisión en SCORE',
      title: 'Un cliente completó su diagnóstico',
      paragraphs: [
        `Lead: ${data.leadName}`,
        `Familia: ${FAMILY_LABEL[data.family]}`,
      ],
      button: { text: 'Revisar el diagnóstico', url: data.link },
      footerReason: TEAM_NOTICE_FOOTER,
    },
    brand,
  );
}
