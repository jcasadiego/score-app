import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { catchError, Observable, throwError } from 'rxjs';
import { RECORDING_TOO_LARGE } from './diagnostic-view';
import { MAX_RECORDING_BYTES } from './recording-rules';

/**
 * Va por fuera del `FileInterceptor`: le pone el `code` propio al 413 que
 * lanza multer al pasar el límite, para que el cliente lo distinga.
 */
@Injectable()
export class RecordingTooLargeInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof PayloadTooLargeException
            ? new PayloadTooLargeException({
                message: `El audio no puede superar ${MAX_RECORDING_BYTES / (1024 * 1024)} MB.`,
                code: RECORDING_TOO_LARGE,
              })
            : error,
        ),
      ),
    );
  }
}
