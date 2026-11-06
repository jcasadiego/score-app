import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../generated/prisma/client';
import { PASSWORD_MAX, PASSWORD_MIN } from '../src/users/dto/limits';
import {
  sampleDataAllowed,
  seedSampleQuestionnaire,
} from './sample-questionnaire';

/**
 * Crea el primer usuario ADMIN si todavía no existe. Necesario porque
 * `UsersController` (POST /users) exige estar ya autenticado como
 * ADMIN — sin este seed no hay forma de entrar al panel por primera vez.
 * Idempotente: si el email ya existe, no le toca el password.
 *
 * Fuera de producción carga además el cuestionario de prueba
 * (`sample-questionnaire.ts`), publicado a nombre de ese ADMIN.
 */
async function main() {
  const email = requireEnv('ADMIN_EMAIL');
  const password = requireEnv('ADMIN_PASSWORD');
  const name = requireEnv('ADMIN_NAME');

  // El seed no pasa por los DTOs: sin esto, el ADMIN inicial, la cuenta con más
  // privilegios, sería la única exenta de la política de contraseñas.
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new Error(
      `ADMIN_PASSWORD debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres`,
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const passwordHash = await argon2.hash(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: name, email, passwordHash, active: true, role: 'ADMIN' },
  });

  console.log(`Usuario admin listo: ${user.email} (${user.id})`);

  if (sampleDataAllowed(process.env)) {
    await seedSampleQuestionnaire(prisma, user.id);
  } else {
    console.log('Cuestionario de prueba: omitido en este entorno');
  }

  await prisma.$disconnect();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name} para correr el seed`);
  }
  return value;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
