import { z } from 'zod';

const emailSchema = z.string().trim().email().max(320);
const passwordSchema = z.string().min(12).max(128);

export const registerRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const changePasswordRequestSchema = z
  .object({
    currentPassword: passwordSchema,
    newPassword: passwordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'The new password must be different from the current password.',
    path: ['newPassword'],
  });

export const userSchema = z
  .object({
    id: z.string().min(20).max(30),
    email: emailSchema,
    emailVerifiedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const csrfTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]+$/);

export const authResponseSchema = z
  .object({
    user: userSchema,
    csrfToken: csrfTokenSchema,
  })
  .strict();

export const sessionSchema = z
  .object({
    id: z.string().min(20).max(30),
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    lastSeenAt: z.iso.datetime({ offset: true }),
    current: z.boolean(),
    userAgentSummary: z.string().max(255).nullable(),
  })
  .strict();

export const sessionListResponseSchema = z
  .object({
    items: z.array(sessionSchema).max(100),
  })
  .strict();

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type UserDto = z.infer<typeof userSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type SessionDto = z.infer<typeof sessionSchema>;
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
