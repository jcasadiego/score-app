import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmPasswordResetDto } from '../../password-reset/dto/confirm-password-reset.dto';
import { CreateUserDto } from './create-user.dto';
import { ListUsersDto } from './list-users.dto';

describe('DTOs de usuarios', () => {
  it('normaliza espacios en nombre y recorta el email', async () => {
    const dto = plainToInstance(CreateUserDto, {
      name: '  Sam   Lee ',
      email: ' sam@example.com ',
      role: 'REVIEWER',
    });

    expect(dto.name).toBe('Sam Lee');
    expect(dto.email).toBe('sam@example.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza un nombre más largo que el límite', async () => {
    const dto = plainToInstance(CreateUserDto, {
      name: 'a'.repeat(121),
      email: 'a@example.com',
      role: 'REVIEWER',
    });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('name');
  });

  it('exige un rol válido al crear: nadie lo recibe por omisión', async () => {
    for (const role of [undefined, 'SUPERADMIN']) {
      const dto = plainToInstance(CreateUserDto, {
        name: 'Sam Lee',
        email: 'sam@example.com',
        role,
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('role');
    }
  });

  it('exige el largo de contraseña de la política', async () => {
    // La única puerta para definir una contraseña es el enlace (PF-59).
    const withPassword = (password: string) =>
      plainToInstance(ConfirmPasswordResetDto, { token: 't', password });

    for (const password of ['a'.repeat(11), 'a'.repeat(129)]) {
      const errors = await validate(withPassword(password));
      expect(errors.map((e) => e.property)).toContain('password');
    }
    expect(await validate(withPassword('a'.repeat(12)))).toHaveLength(0);
    expect(await validate(withPassword('a'.repeat(128)))).toHaveLength(0);
  });

  it('aplica valores por defecto y convierte la paginación a número', async () => {
    const empty = plainToInstance(ListUsersDto, {});
    expect(empty).toMatchObject({ page: 1, pageSize: 20 });

    const dto = plainToInstance(ListUsersDto, {
      page: '3',
      pageSize: '500',
    });
    expect(dto.page).toBe(3);
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['pageSize']);
  });

  it('rechaza una página enorme aunque sea un entero', async () => {
    const dto = plainToInstance(ListUsersDto, { page: '1e21' });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['page']);
  });
});
