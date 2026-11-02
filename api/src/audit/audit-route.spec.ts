import { failureAction } from './audit-failures.middleware';

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
