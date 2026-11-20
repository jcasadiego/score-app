import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { CurrencyCode, PaymentMethod } from '../../../generated/prisma/enums';
import { ID_MAX } from '../../diagnostics/dto/limits';
import { Trim } from '../../users/dto/normalize-text';
import { AMOUNT_PATTERN, REFERENCE_MAX } from './limits';

/** La fecha del pago no puede ser futura: es cuándo pagó el cliente. */
@ValidatorConstraint({ name: 'notFuture' })
class NotFuture implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && Date.parse(value) <= Date.now();
  }

  defaultMessage(): string {
    return 'paidAt no puede ser una fecha futura';
  }
}

export class CreatePaymentDto {
  @ApiProperty({ maxLength: ID_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ID_MAX)
  leadId!: string;

  /** Decimal como string, mayor que cero y con hasta 2 decimales. */
  @ApiProperty({ example: '150.00', pattern: AMOUNT_PATTERN.source })
  @IsString()
  @Matches(AMOUNT_PATTERN, {
    message: 'amount debe ser un monto mayor que cero con hasta 2 decimales',
  })
  amount!: string;

  @ApiProperty({ enum: CurrencyCode, enumName: 'CurrencyCode' })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiProperty({ minLength: 1, maxLength: REFERENCE_MAX })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(REFERENCE_MAX)
  reference!: string;

  /** RFC 3339, con zona horaria. */
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Validate(NotFuture)
  paidAt!: string;
}
