import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AllowMfaPending, AuthUser, CurrentUser, Public } from '../common/decorators';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

class LoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(1, 256) password: string;
}

class CodeDto {
  @IsString() @Length(6, 8) code: string;
}

class ChangePasswordDto {
  @IsString() @Length(1, 256) currentPassword: string;
  @IsString() @Length(12, 256) newPassword: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password, req.ip, req.headers['user-agent']);
    this.sessions.setCookie(res, result.token);
    return { mfaRequired: result.mfaRequired, mfaSetupRequired: result.mfaSetupRequired };
  }

  @AllowMfaPending()
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(user.sessionId);
    this.sessions.clearCookie(res);
    return { ok: true };
  }

  @AllowMfaPending()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id, user.mfaVerified);
  }

  @AllowMfaPending()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(@CurrentUser() user: AuthUser, @Body() dto: CodeDto) {
    await this.auth.verifyMfa(user.id, user.sessionId, dto.code);
    return { ok: true };
  }

  @AllowMfaPending()
  @Post('mfa/setup')
  @HttpCode(200)
  setupMfa(@CurrentUser() user: AuthUser) {
    return this.auth.beginMfaSetup(user.id);
  }

  @AllowMfaPending()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/enable')
  @HttpCode(200)
  async enableMfa(@CurrentUser() user: AuthUser, @Body() dto: CodeDto) {
    await this.auth.enableMfa(user.id, user.sessionId, dto.code);
    return { ok: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user.id, user.sessionId, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }
}
