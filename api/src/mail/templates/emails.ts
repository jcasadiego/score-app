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

/**
 * Por qué el dueño de la cuenta tiene que definir su contraseña. En los tres
 * casos la anterior, si la había, ya no sirve.
 */
export type PasswordSetupReason =
  'ACCOUNT_CREATED' | 'PASSWORD_RESET_BY_APPROVER' | 'MFA_RESET';

const PASSWORD_SETUP_TEXT: Record<
  PasswordSetupReason,
  { subject: string; intro: string }
> = {
  ACCOUNT_CREATED: {
    subject: 'Activa tu cuenta del panel SCORE',
    intro:
      'Te crearon una cuenta en el panel SCORE. Para activarla, define tu contraseña con el botón de abajo y después configura la verificación en dos pasos.',
  },
  PASSWORD_RESET_BY_APPROVER: {
    subject: 'Define una contraseña nueva para el panel SCORE',
    intro:
      'Un Aprobador restableció la contraseña de tu cuenta del panel SCORE: la anterior ya no sirve. Define una nueva con el botón de abajo.',
  },
  MFA_RESET: {
    subject: 'Vuelve a configurar tu acceso al panel SCORE',
    intro:
      'Un Aprobador restableció la verificación en dos pasos de tu cuenta del panel SCORE. Por seguridad, tu contraseña anterior ya no sirve: define una nueva con el botón de abajo y vuelve a configurar la verificación en dos pasos.',
  },
};

export function passwordSetupEmail(
  data: LinkMailData & { reason: PasswordSetupReason; ttlHours: number },
  brand?: BrandOptions,
): RenderedEmail {
  const text = PASSWORD_SETUP_TEXT[data.reason];
  return renderBaseTemplate(
    {
      subject: text.subject,
      title: `Hola, ${data.name}`,
      paragraphs: [
        text.intro,
        `El enlace sirve una sola vez y vence en ${data.ttlHours} horas. Si vence, pide uno nuevo con "¿Olvidaste tu contraseña?" en el inicio de sesión.`,
      ],
      button: { text: 'Definir mi contraseña', url: data.link },
      note: 'Si no esperabas este correo, avisa al equipo de Music Finance Pro.',
    },
    brand,
  );
}

// El nombre y los UTM los escribe cualquiera en el formulario público: van solo
// en el cuerpo, escapados por la plantilla, nunca en el asunto.
export interface SecurityNoticeData {
  name: string;
  event: SecurityNoticeEvent;
}

export type SecurityNoticeEvent = 'MFA_ENROLLED' | 'MFA_RECOVERY_CODE_USED';

const SECURITY_NOTICE_TEXT: Record<SecurityNoticeEvent, string> = {
  MFA_ENROLLED: 'Se activó la verificación en dos pasos en tu cuenta.',
  MFA_RECOVERY_CODE_USED:
    'Se inició sesión en tu cuenta con un código de recuperación.',
};

export function securityNoticeEmail(
  data: SecurityNoticeData,
  brand?: BrandOptions,
): RenderedEmail {
  return renderBaseTemplate(
    {
      subject: 'Cambio de seguridad en tu cuenta del panel SCORE',
      title: `Hola, ${data.name}`,
      paragraphs: [
        SECURITY_NOTICE_TEXT[data.event],
        'Si no fuiste tú, avisa de inmediato a un Aprobador del panel.',
      ],
      footerReason: TEAM_NOTICE_FOOTER,
    },
    brand,
  );
}

export interface AccountLockedData {
  name: string;
  lockMinutes: number;
  /** Pantalla "¿Olvidaste tu contraseña?" del panel. */
  link: string;
}

/** Sin IP, dispositivo ni nada de quien lo intentó: solo el hecho (PF-65). */
export function accountLockedEmail(
  data: AccountLockedData,
  brand?: BrandOptions,
): RenderedEmail {
  return renderBaseTemplate(
    {
      subject: 'Tu cuenta del panel SCORE quedó bloqueada temporalmente',
      title: `Hola, ${data.name}`,
      paragraphs: [
        `Por varios intentos fallidos de inicio de sesión, tu cuenta del panel SCORE quedó bloqueada durante ${data.lockMinutes} minutos. Pasado ese tiempo puedes volver a entrar como siempre.`,
        'Si no fuiste tú, o no recuerdas tu contraseña, restablécela con el botón de abajo.',
      ],
      button: { text: 'Restablecer contraseña', url: data.link },
      footerReason: TEAM_NOTICE_FOOTER,
    },
    brand,
  );
}

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
