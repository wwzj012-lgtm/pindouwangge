// Commercial VIP & Pro Card Code Utils & Security Checksum

export const CHANNEL_PREFIX_MAP: Record<string, string> = {
  '淘宝旗舰店': 'TB',
  '抖音直播间': 'DY',
  '微信私域社群': 'WX',
  '线下代理合作': 'DL',
  '活动赠送卡': 'HD',
  '分销代理': 'FX',
};

export type MemberCodeType = 'PV' | 'BP'; // PV = 普通VIP, BP = 商家Pro

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
 * Determines member_type (1 = 普通VIP, 2 = 商家Pro) from redemption code prefix.
 */
export function getMemberTypeFromCode(code: string): 1 | 2 {
  const clean = code.trim().toUpperCase();
  if (clean.startsWith('BP')) {
    return 2; // 商家Pro
  }
  return 1; // 普通VIP
}

/**
 * Generates a 4-segment commercial card code:
 * MEMBER_PREFIX + CHANNEL_PREFIX (4) - RANDOM4 - RANDOM4 - RANDOM2 + CHECKSUM2
 * PV (普通VIP): PVTB-7D29-FK8S-7G4A
 * BP (商家Pro): BPTB-8E30-GL9T-8H5B
 */
export function generateCommercialVipCode(
  channelTag: string = '淘宝旗舰店',
  memberTypePrefix: MemberCodeType = 'PV'
): string {
  const channelCode = CHANNEL_PREFIX_MAP[channelTag] || 'TB';
  const prefix4 = `${memberTypePrefix}${channelCode}`.toUpperCase();
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude ambiguous 0,1,I,O

  let rand1 = '';
  let rand2 = '';
  let rand3 = '';
  for (let i = 0; i < 4; i++) {
    rand1 += chars.charAt(Math.floor(Math.random() * chars.length));
    rand2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  for (let i = 0; i < 2; i++) {
    rand3 += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const payload = `${prefix4}${rand1}${rand2}${rand3}`;
  const checksum2 = compute2CharChecksum(payload);
  const seg4 = `${rand3}${checksum2}`;

  return `${prefix4}-${rand1}-${rand2}-${seg4}`;
}

/**
 * Fast client-side checksum validation against code tampering/bruteforce.
 * Supports both new 4-segment format and legacy 3-segment format.
 */
export function verifyCardChecksum(code: string): boolean {
  const clean = code.trim().toUpperCase();
  const parts = clean.split('-');

  if (parts.length === 4) {
    const [seg1, seg2, seg3, seg4] = parts;
    if (seg1.length !== 4 || seg2.length !== 4 || seg3.length !== 4 || seg4.length !== 4) {
      return false;
    }
    const rand3 = seg4.slice(0, 2);
    const checksum2 = seg4.slice(2);
    const payload = `${seg1}${seg2}${seg3}${rand3}`;
    const expectedChecksum = compute2CharChecksum(payload);
    return checksum2 === expectedChecksum;
  }

  if (parts.length === 3) {
    const [prefix, random10, checksum] = parts;
    if (prefix.length < 2 || random10.length !== 10 || checksum.length !== 2) return false;
    const expectedChecksum = compute2CharChecksum(`${prefix}${random10}`);
    return checksum === expectedChecksum;
  }

  return false;
}

/**
 * Mask code for privacy protection in Admin UI lists:
 * PVTB-7D29-FK8S-7G4A -> PVTB-****-****-7G4A
 */
export function maskCardCode(code: string): string {
  if (!code) return '';
  const parts = code.trim().toUpperCase().split('-');
  if (parts.length === 4) {
    return `${parts[0]}-****-****-${parts[3]}`;
  }
  if (parts.length === 3) {
    return `${parts[0]}-********-${parts[2]}`;
  }
  if (code.length > 8) {
    return `${code.slice(0, 4)}****${code.slice(-4)}`;
  }
  return `${code.slice(0, 2)}****`;
}
