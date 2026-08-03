// Commercial VIP Card Code Utils & Security Checksum

export const CHANNEL_PREFIX_MAP: Record<string, string> = {
  '淘宝旗舰店': 'TB',
  '抖音直播间': 'DY',
  '微信私域社群': 'WX',
  '线下代理合作': 'DL',
  '活动赠送卡': 'HD',
};

/**
 * Computes a 2-character deterministic checksum for a payload string.
 */
export function compute2CharChecksum(payload: string): string {
  let hash = 5381;
  const clean = payload.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) + hash) ^ clean.charCodeAt(i);
  }
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const val1 = Math.abs(hash) % chars.length;
  const val2 = Math.abs(Math.floor(hash / chars.length)) % chars.length;
  return chars[val1] + chars[val2];
}

/**
 * Generates a 3-segment commercial card code:
 * CHANNEL_PREFIX(2) - RANDOM_STRING(10) - CHECKSUM(2)
 * Example: TB-7D29FK8S7G-4A
 */
export function generateCommercialVipCode(channelTag: string): string {
  const prefix = CHANNEL_PREFIX_MAP[channelTag] || 'PR';
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude ambiguous 0,1,I,O
  let random10 = '';
  for (let i = 0; i < 10; i++) {
    random10 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const payload = `${prefix}${random10}`;
  const checksum = compute2CharChecksum(payload);
  return `${prefix}-${random10}-${checksum}`;
}

/**
 * Fast client-side checksum validation against code tampering/bruteforce.
 */
export function verifyCardChecksum(code: string): boolean {
  const parts = code.trim().toUpperCase().split('-');
  if (parts.length !== 3) return false;
  const [prefix, random10, checksum] = parts;
  if (prefix.length < 2 || random10.length !== 10 || checksum.length !== 2) return false;
  const expectedChecksum = compute2CharChecksum(`${prefix}${random10}`);
  return checksum === expectedChecksum;
}

/**
 * Mask code for privacy protection in Admin UI lists:
 * TB-7D29FK8S7G-4A -> TB-********-4A
 */
export function maskCardCode(code: string): string {
  if (!code) return '';
  const parts = code.trim().toUpperCase().split('-');
  if (parts.length === 3) {
    return `${parts[0]}-********-${parts[2]}`;
  }
  if (code.length > 8) {
    return `${code.slice(0, 3)}****${code.slice(-3)}`;
  }
  return `${code.slice(0, 2)}****`;
}
