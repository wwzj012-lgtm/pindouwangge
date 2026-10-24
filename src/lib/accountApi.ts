import { apiPost } from '../utils/api';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  member_type: 0 | 1 | 2;
  member_expire: number | null;
  member_source?: string | null;
  isVip: boolean;
  vipExpireAt: number | null;
  freeTrialUsed?: boolean;
  role: 'user' | 'admin';
  /** Server-computed navigation capability; independent of membership benefits. */
  canAccessAdmin?: boolean;
  authProvider?: 'firebase' | 'password' | 'guest';
  createdAt: number;
  updatedAt: number;
}

export interface AuditLog {
  id?: string;
  operatorUid: string;
  operatorEmail: string;
  action: string;
  details: string;
  timestamp: number;
}

export interface AuthSession {
  token: string;
  profile: UserProfile;
}

export async function sha256(message: string): Promise<string> {
  const bytes = new TextEncoder().encode(message.trim().toUpperCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function recordAuditLog(
  _operatorUid: string,
  _operatorEmail: string,
  action: string,
  details: string,
): Promise<void> {
  const result = await apiPost<{ recorded: boolean }>('/api/admin/record-audit-log', { action, details });
  if (!result.ok) console.warn('Audit log write failed:', result.error);
}
