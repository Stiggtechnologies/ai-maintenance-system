import { describe, it, expect } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { resolveAuthSource, type SignUpData } from './auth';

describe('Auth types', () => {
  it('SignUpData interface has required fields', () => {
    const data: SignUpData = {
      email: 'test@example.com',
      password: 'password123',
      fullName: 'Test User',
      company: 'Test Corp',
      role: 'admin',
      industry: 'tech',
    };

    expect(data.email).toBe('test@example.com');
    expect(data.fullName).toBe('Test User');
  });

  it('derives identity provenance from the verified user rather than browser flags', () => {
    const user = {
      id: 'entra-user',
      aud: 'authenticated',
      created_at: '2026-09-29T00:00:00Z',
      app_metadata: { provider: 'email', providers: ['email', 'azure'] },
      user_metadata: {},
      identities: [],
    } as unknown as User;

    expect(resolveAuthSource(user)).toBe('azure_ad');
  });
});
