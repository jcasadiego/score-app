import type { PrismaClient } from '../generated/prisma/client';

/**
 * Cuestionario de PRUEBA (PF-12), solo para desarrollo y QA mientras el cliente
 * entrega el oficial. No es contenido oficial: cada versión queda con
 * `isSample = true` y cada texto empieza con `[Prueba]`. Para reemplazarlo, se
 * publica una versión nueva desde el panel; un borrador nunca copia una versión
 * de prueba.
 */

type SampleType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'FREE_TEXT';
type SampleFamily = 'PROJECT' | 'B2B' | 'PROFESSIONAL' | 'CATALOG';

export interface SampleQuestion {
  code: string;
  text: string;
  type: SampleType;
  helpText: string;
  required: boolean;
  maxLength?: number;
  /** `[value, texto]`, en orden. */
  options?: [string, string][];
}

export const SAMPLE_PREFIX = '[Prueba] ';

const YES_PARTIAL_NO: [string, string][] = [
  ['yes', 'Sí'],
  ['partially', 'En parte'],
  ['no', 'No'],
];

export const SAMPLE_QUESTIONNAIRE: Record<SampleFamily, SampleQuestion[]> = {
  PROJECT: [
    {
      code: 'project_type',
      text: '¿Qué tipo de proyecto quieres financiar?',
      type: 'SINGLE_CHOICE',
      helpText: 'Elige el que represente la mayor parte del presupuesto.',
      required: true,
      options: [
        ['album', 'Álbum'],
        ['single_ep', 'Sencillo o EP'],
        ['tour', 'Gira'],
        ['music_video', 'Videoclip'],
        ['festival', 'Festival o evento propio'],
      ],
    },
    {
      code: 'funding_sources',
      text: '¿Con qué fuentes de financiamiento cuentas hoy?',
      type: 'MULTIPLE_CHOICE',
      helpText: 'Marca todas las que ya estén confirmadas, no las que buscas.',
      required: true,
      options: [
        ['own_savings', 'Ahorros propios'],
        ['label_advance', 'Adelanto de un sello'],
        ['grants', 'Becas o fondos públicos'],
        ['crowdfunding', 'Crowdfunding'],
        ['private_investor', 'Inversionista privado'],
        ['none', 'Ninguna todavía'],
      ],
    },
    {
      code: 'budget_range',
      text: '¿Cuál es el presupuesto total estimado del proyecto?',
      type: 'SINGLE_CHOICE',
      helpText: 'En dólares. Incluye producción, promoción y logística.',
      required: true,
      options: [
        ['under_5k', 'Menos de 5.000'],
        ['from_5k_to_20k', 'De 5.000 a 20.000'],
        ['from_20k_to_100k', 'De 20.000 a 100.000'],
        ['over_100k', 'Más de 100.000'],
      ],
    },
    {
      code: 'has_budget_breakdown',
      text: '¿Tienes el presupuesto desglosado por partidas?',
      type: 'SINGLE_CHOICE',
      helpText: 'Ejemplo: estudio, mezcla, máster, diseño, pauta en redes.',
      required: true,
      options: YES_PARTIAL_NO,
    },
    {
      code: 'release_timeline',
      text: '¿En cuánto tiempo esperas lanzar el proyecto?',
      type: 'SINGLE_CHOICE',
      helpText: 'Cuenta desde hoy hasta la fecha de lanzamiento o estreno.',
      required: false,
      options: [
        ['under_3_months', 'Menos de 3 meses'],
        ['from_3_to_6_months', 'De 3 a 6 meses'],
        ['from_6_to_12_months', 'De 6 a 12 meses'],
        ['over_12_months', 'Más de 12 meses'],
      ],
    },
    {
      code: 'revenue_plan',
      text: '¿Cómo esperas recuperar la inversión?',
      type: 'FREE_TEXT',
      helpText:
        'Ejemplo: "60 % en taquilla de la gira, 30 % en streaming y 10 % en merch".',
      required: true,
      maxLength: 1000,
    },
  ],
  B2B: [
    {
      code: 'business_type',
      text: '¿Qué tipo de empresa de la industria musical es la tuya?',
      type: 'SINGLE_CHOICE',
      helpText: 'Si haces varias cosas, elige la que más ingresos genera.',
      required: true,
      options: [
        ['label', 'Sello discográfico'],
        ['publisher', 'Editorial musical'],
        ['booking_agency', 'Agencia de booking o management'],
        ['studio', 'Estudio de grabación'],
        ['distributor', 'Distribuidora'],
        ['other', 'Otra'],
      ],
    },
    {
      code: 'revenue_streams',
      text: '¿De dónde vienen los ingresos de la empresa?',
      type: 'MULTIPLE_CHOICE',
      helpText: 'Marca todas las fuentes de los últimos 12 meses.',
      required: true,
      options: [
        ['service_fees', 'Honorarios por servicios'],
        ['royalty_share', 'Participación en regalías'],
        ['licensing', 'Licencias y sincronización'],
        ['events', 'Eventos'],
        ['merchandising', 'Merchandising'],
      ],
    },
    {
      code: 'client_concentration',
      text: '¿Qué parte de tus ingresos viene de tus 3 clientes más grandes?',
      type: 'SINGLE_CHOICE',
      helpText: 'Ejemplo: si 3 artistas generan la mitad de la facturación, es 50 %.',
      required: true,
      options: [
        ['under_25', 'Menos del 25 %'],
        ['from_25_to_50', 'Del 25 % al 50 %'],
        ['over_50', 'Más del 50 %'],
      ],
    },
    {
      code: 'payment_terms',
      text: '¿En cuántos días te pagan tus clientes, en promedio?',
      type: 'SINGLE_CHOICE',
      helpText: 'Cuenta desde que emites la factura hasta que cobras.',
      required: true,
      options: [
        ['under_30_days', 'Menos de 30 días'],
        ['from_30_to_60_days', 'De 30 a 60 días'],
        ['over_60_days', 'Más de 60 días'],
      ],
    },
    {
      code: 'accounting',
      text: '¿Cómo lleva la contabilidad la empresa?',
      type: 'SINGLE_CHOICE',
      helpText: 'Elige la opción que describe cómo se hace hoy.',
      required: false,
      options: [
        ['external_accountant', 'Contador externo'],
        ['internal_team', 'Equipo interno'],
        ['spreadsheets', 'Hojas de cálculo propias'],
        ['none', 'No se lleva'],
      ],
    },
    {
      code: 'main_challenge',
      text: '¿Cuál es hoy el mayor reto financiero de la empresa?',
      type: 'FREE_TEXT',
      helpText:
        'Ejemplo: "los adelantos a artistas tardan más de un año en recuperarse".',
      required: true,
      maxLength: 1000,
    },
  ],
  PROFESSIONAL: [
    {
      code: 'main_role',
      text: '¿Cuál es tu rol principal en la música?',
      type: 'SINGLE_CHOICE',
      helpText: 'El que más ingresos te deja, aunque hagas varios.',
      required: true,
      options: [
        ['artist', 'Artista'],
        ['producer', 'Productor'],
        ['mix_engineer', 'Ingeniero de mezcla o máster'],
        ['session_musician', 'Músico de sesión'],
        ['composer', 'Compositor'],
      ],
    },
    {
      code: 'income_sources',
      text: '¿De dónde vienen tus ingresos como profesional?',
      type: 'MULTIPLE_CHOICE',
      helpText: 'Marca todas las fuentes de los últimos 12 meses.',
      required: true,
      options: [
        ['live_shows', 'Conciertos'],
        ['streaming', 'Streaming'],
        ['sync', 'Sincronización'],
        ['teaching', 'Clases'],
        ['session_work', 'Sesiones de grabación'],
        ['merch', 'Merch'],
      ],
    },
    {
      code: 'income_stability',
      text: '¿Qué tan estables son tus ingresos de un mes a otro?',
      type: 'SINGLE_CHOICE',
      helpText: 'Muy variable: hay meses con el doble o con la mitad de lo usual.',
      required: true,
      options: [
        ['stable', 'Estables'],
        ['variable', 'Algo variables'],
        ['very_variable', 'Muy variables'],
      ],
    },
    {
      code: 'separates_finances',
      text: '¿Separas tus finanzas personales de las profesionales?',
      type: 'SINGLE_CHOICE',
      helpText: 'Ejemplo: una cuenta bancaria solo para cobros y gastos de la música.',
      required: true,
      options: YES_PARTIAL_NO,
    },
    {
      code: 'emergency_fund',
      text: '¿Cuántos meses de gastos podrías cubrir sin ingresos?',
      type: 'SINGLE_CHOICE',
      helpText: 'Cuenta solo ahorros disponibles, no créditos.',
      required: false,
      options: [
        ['none', 'Ninguno'],
        ['under_3_months', 'Menos de 3'],
        ['from_3_to_6_months', 'De 3 a 6'],
        ['over_6_months', 'Más de 6'],
      ],
    },
    {
      code: 'financial_goal',
      text: '¿Cuál es tu principal meta financiera para los próximos 12 meses?',
      type: 'FREE_TEXT',
      helpText: 'Ejemplo: "comprar equipo propio para dejar de alquilar estudio".',
      required: true,
      maxLength: 500,
    },
  ],
  CATALOG: [
    {
      code: 'catalog_rights',
      text: '¿Qué derechos tienes sobre tu catálogo?',
      type: 'MULTIPLE_CHOICE',
      helpText: 'Marca todos los que te pertenezcan, aunque sea en parte.',
      required: true,
      options: [
        ['masters', 'Masters (grabaciones)'],
        ['publishing', 'Edición (composiciones)'],
        ['neighboring_rights', 'Derechos conexos'],
        ['sync_rights', 'Derechos de sincronización'],
      ],
    },
    {
      code: 'catalog_size',
      text: '¿Cuántas canciones tiene el catálogo?',
      type: 'SINGLE_CHOICE',
      helpText: 'Cuenta cada grabación o composición una sola vez.',
      required: true,
      options: [
        ['under_50', 'Menos de 50'],
        ['from_50_to_500', 'De 50 a 500'],
        ['over_500', 'Más de 500'],
      ],
    },
    {
      code: 'royalty_tracking',
      text: '¿Cómo controlas las regalías que genera el catálogo?',
      type: 'SINGLE_CHOICE',
      helpText: 'Software especializado: un programa hecho para gestionar regalías.',
      required: true,
      options: [
        ['platform_reports', 'Con los reportes de cada plataforma'],
        ['specialized_software', 'Con software especializado'],
        ['spreadsheets', 'Con hojas de cálculo'],
        ['not_tracked', 'No las controlo'],
      ],
    },
    {
      code: 'top_track_share',
      text: '¿Qué parte de los ingresos genera tu canción más escuchada?',
      type: 'SINGLE_CHOICE',
      helpText: 'Mide qué tan concentrado está el catálogo en un solo éxito.',
      required: true,
      options: [
        ['under_20', 'Menos del 20 %'],
        ['from_20_to_50', 'Del 20 % al 50 %'],
        ['over_50', 'Más del 50 %'],
      ],
    },
    {
      code: 'registered_works',
      text: '¿Tus obras están registradas en una sociedad de gestión?',
      type: 'SINGLE_CHOICE',
      helpText: 'Ejemplo: SGAE, SACM, ASCAP o la sociedad de tu país.',
      required: false,
      options: [
        ['all', 'Todas'],
        ['some', 'Algunas'],
        ['none', 'Ninguna'],
        ['unknown', 'No lo sé'],
      ],
    },
    {
      code: 'catalog_plans',
      text: '¿Qué planes tienes para tu catálogo?',
      type: 'FREE_TEXT',
      helpText: 'Ejemplo: venderlo, licenciarlo para cine y TV, o ampliarlo.',
      required: true,
      maxLength: 1000,
    },
  ],
};

/**
 * Solo desarrollo y QA. `APP_ENV` distingue QA de producción, que pueden compartir
 * `NODE_ENV=production`; sin `APP_ENV`, solo con `NODE_ENV=development`.
 */
export function sampleDataAllowed(env: NodeJS.ProcessEnv): boolean {
  if (env.APP_ENV) return ['development', 'qa'].includes(env.APP_ENV);
  return env.NODE_ENV === 'development';
}

/**
 * Carga una versión publicada de prueba por familia. Idempotente: una familia
 * que ya tiene su versión de prueba no se toca, ni tampoco una con un borrador
 * abierto (solo puede haber uno).
 */
export async function seedSampleQuestionnaire(
  prisma: PrismaClient,
  publisherId: string,
): Promise<void> {
  for (const [family, questions] of Object.entries(SAMPLE_QUESTIONNAIRE) as [
    SampleFamily,
    SampleQuestion[],
  ][]) {
    const [sample, draft] = await Promise.all([
      prisma.questionnaireVersion.findFirst({
        where: { family, isSample: true },
        select: { versionNumber: true },
      }),
      prisma.questionnaireVersion.findFirst({
        where: { family, status: 'DRAFT' },
        select: { id: true },
      }),
    ]);
    if (sample) {
      console.log(`Cuestionario de prueba ${family}: ya existe (v${sample.versionNumber})`);
      continue;
    }
    if (draft) {
      console.warn(`Cuestionario de prueba ${family}: omitido, hay un borrador abierto`);
      continue;
    }

    const version = await prisma.$transaction(async (tx) => {
      const last = await tx.questionnaireVersion.aggregate({
        where: { family },
        _max: { versionNumber: true },
      });
      // Se crea como borrador y se publica después: el trigger no deja agregar
      // preguntas a una versión ya publicada.
      const created = await tx.questionnaireVersion.create({
        data: {
          family,
          versionNumber: (last._max.versionNumber ?? 0) + 1,
          isSample: true,
          createdById: publisherId,
          questions: {
            create: questions.map((question, position) => ({
              code: question.code,
              text: SAMPLE_PREFIX + question.text,
              type: question.type,
              helpText: question.helpText,
              required: question.required,
              maxLength: question.maxLength ?? null,
              position,
              options: {
                create: (question.options ?? []).map(([value, text], i) => ({
                  value,
                  text,
                  position: i,
                })),
              },
            })),
          },
        },
        select: { id: true, versionNumber: true },
      });
      await tx.questionnaireVersion.update({
        where: { id: created.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          publishedById: publisherId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'QUESTIONNAIRE_VERSION_PUBLISHED',
          entity: 'QuestionnaireVersion',
          entityId: created.id,
          data: {
            family,
            versionNumber: created.versionNumber,
            questionCount: questions.length,
            sample: true,
          },
        },
      });
      return created;
    });
    console.log(`Cuestionario de prueba ${family}: publicado como v${version.versionNumber}`);
  }
}
