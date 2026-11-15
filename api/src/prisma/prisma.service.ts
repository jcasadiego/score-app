import { PrismaPg } from '@prisma/adapter-pg';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { assertLeastPrivilege, databaseUserFromUrl } from './database-roles';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  async onModuleInit() {
    await this.$connect();
    // En producción (QA y PROD) la API no arranca con un rol que pueda alterar
    // el esquema o la bitácora, ni con uno al que le falte un permiso (PF-58).
    // En desarrollo y tests se usa un solo rol, dueño de todo.
    if (process.env.NODE_ENV === 'production') {
      const { schema } = databaseUserFromUrl(process.env.DATABASE_URL ?? '');
      await assertLeastPrivilege(
        (sql, params) => this.$queryRawUnsafe(sql, ...params),
        schema,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
