import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Crea el primer usuario ADMIN si todavía no existe. Necesario porque
 * `UsersController` (POST /users) exige estar ya autenticado como
 * ADMIN — sin este seed no hay forma de entrar al panel por primera vez.
 * Idempotente: si el email ya existe, no le toca el password.
 */
async function main() {
  const email = requireEnv('ADMIN_EMAIL');
  const password = requireEnv('ADMIN_PASSWORD');
  const name = requireEnv('ADMIN_NAME');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const passwordHash = await argon2.hash(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: name, email, passwordHash, active: true },
  });

  console.log(`Usuario admin listo: ${user.email} (${user.id})`);

  await prisma.$disconnect();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name} para correr el seed`,
    );
  }
  return value;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
