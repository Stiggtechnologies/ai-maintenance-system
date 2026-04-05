import { describe, it, expect } from 'vitest';
import type { SignUpData } from './auth';

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
});
