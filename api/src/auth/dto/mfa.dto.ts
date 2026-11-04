import { IsString, Matches, MaxLength } from 'class-validator';

export class MfaChallengeDto {
  @IsString()
  @MaxLength(2048)
  mfaToken!: string;
}

export class VerifyMfaCodeDto extends MfaChallengeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class VerifyRecoveryCodeDto extends MfaChallengeDto {
  @IsString()
  @MaxLength(32)
  recoveryCode!: string;
}
