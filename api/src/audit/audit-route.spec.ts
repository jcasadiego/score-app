import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AccessLinkController } from '../access-link/access-link.controller';
import { AuthController } from '../auth/auth.controller';
import { LeadsController } from '../leads/leads.controller';
import { LegacyPrequalificationController } from '../leads/legacy/legacy-prequalification.controller';
import { PasswordResetController } from '../password-reset/password-reset.controller';
import { UsersController } from '../users/users.controller';
import { failureAction } from './audit-failures.middleware';
import { AUDIT_ROUTE } from './audit-route.decorator';

const CONTROLLERS = [
  AccessLinkController,
  AuthController,
  LeadsController,
  LegacyPrequalificationController,
  PasswordResetController,
  UsersController,
];

function mutatingHandlers(controller: { prototype: object }) {
  const prototype = controller.prototype as Record<string, object>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => ({ name, handler: prototype[name] }))
    .filter(
      ({ handler }) =>
        Reflect.getMetadata(PATH_METADATA, handler) !== undefined &&
        Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.GET,
    );
}

describe('@AuditRoute', () => {
  it.each(CONTROLLERS.map((c) => [c.name, c] as const))(
    '%s declara cómo se audita cada ruta que cambia datos',
    (_name, controller) => {
      const handlers = mutatingHandlers(controller);

      expect(handlers.length).toBeGreaterThan(0);
      for (const { name, handler } of handlers) {
        expect(
          Reflect.getMetadata(AUDIT_ROUTE, handler),
          `${controller.name}.${name}`,
        ).toBeDefined();
      }
    },
  );
});

describe('failureAction', () => {
  it.each([
    ['GET', 403, 'ACCESS_DENIED'],
    ['PATCH', 403, 'ACCESS_DENIED'],
    ['POST', 401, 'AUTHENTICATION_FAILED'],
    ['POST', 409, 'REQUEST_CONFLICT'],
    ['DELETE', 500, 'REQUEST_FAILED'],
    ['GET', 401, null],
    ['GET', 500, null],
    ['POST', 400, null],
    ['POST', 404, null],
    ['POST', 429, null],
    ['POST', 201, null],
  ])('%s con %i → %s', (method, status, action) => {
    expect(failureAction(method, status)).toBe(action);
  });
});
