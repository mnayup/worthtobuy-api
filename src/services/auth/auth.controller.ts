import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() body: { login?: string; email?: string; username?: string; password: string }) {
    // Accepts login, username, or email field seamlessly
    const identifier = body.login || body.username || body.email || '';
    return this.authService.login(identifier, body.password);
  }

  @Post('mfa/verify')
  async verifyMfa(@Body() body: { tempToken: string; code: string }) {
    return this.authService.verifyMfa(body.tempToken, body.code);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser('id') userId: number) {
    return this.authService.getMe(userId);
  }
}
