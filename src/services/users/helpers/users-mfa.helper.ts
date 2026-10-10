import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../../config/prisma/prisma.service';

export async function setupUserMfa(prisma: PrismaService, user_id: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: user_id } });
  const secret = generateSecret();
  const accountIdentifier = user.username || user.email || user.name;
  const otpauthUrl = generateURI({
    label: accountIdentifier,
    issuer: 'Worthtobuy',
    secret,
  });

  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  return {
    secret,
    qrCodeDataUrl,
    otpauthUrl,
    accountIdentifier,
  };
}

export async function enableUserMfa(prisma: PrismaService, user_id: number, code: string, secret: string) {
  if (!code || !secret) {
    throw new BadRequestException('Kode verifikasi dan secret token diperlukan.');
  }

  const verification = verifySync({ token: code.trim(), secret: secret.trim() });
  if (!verification.valid) {
    throw new BadRequestException('Kode OTP tidak valid atau sudah kedaluwarsa.');
  }

  // Generate 8 recovery backup codes (8 characters each)
  const recoveryCodes: string[] = [];
  for (let i = 0; i < 8; i++) {
    recoveryCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }

  await prisma.user.update({
    where: { id: user_id },
    data: {
      mfa_enabled: true,
      mfa_secret: secret.trim(),
      mfa_recovery_codes: recoveryCodes,
    },
  });

  return {
    success: true,
    message: 'MFA 2-Faktor berhasil diaktifkan.',
    recoveryCodes,
  };
}

export async function disableUserMfa(prisma: PrismaService, user_id: number, passwordOrCode: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: user_id } });
  if (!user.mfa_enabled) {
    throw new BadRequestException('MFA belum diaktifkan.');
  }

  let isAuthorized = false;

  if (await bcrypt.compare(passwordOrCode, user.password_hash)) {
    isAuthorized = true;
  } else if (user.mfa_secret) {
    const verification = verifySync({ token: passwordOrCode.trim(), secret: user.mfa_secret });
    if (verification.valid) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    throw new BadRequestException('Verifikasi gagal: Password atau kode OTP salah.');
  }

  await prisma.user.update({
    where: { id: user_id },
    data: {
      mfa_enabled: false,
      mfa_secret: null,
      mfa_recovery_codes: [],
    },
  });

  return { success: true, message: 'MFA berhasil dinonaktifkan.' };
}
