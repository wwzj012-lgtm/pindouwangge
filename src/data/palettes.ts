import { BeadColor, BrandKey } from '../types';

// Helper to calculate RGB from hex
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Generate distinct printable symbols for grid printouts
export const SYMBOL_LIST = [
  '●', '■', '▲', '★', '♦', '♥', '♠', '♣', '✦', '✖',
  '◆', '▼', '◄', '►', '⬢', '⬟', '⬣', '⊕', '⊗', '⊙',
  '⊛', '⊜', '⊝', '1', '2', '3', '4', '5', '6', '7',
  '8', '9', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
  'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z', 'α', 'β', 'γ', 'δ'
];

// Helper to attach hex and symbol
function makePalette(brand: BrandKey, rawList: Array<{ code: string; name: string; hex: string }>): BeadColor[] {
  return rawList.map((item, idx) => ({
    id: `${brand}_${item.code}`,
    code: item.code,
    name: item.name,
    hex: item.hex,
    rgb: hexToRgb(item.hex),
    brand,
    symbol: SYMBOL_LIST[idx % SYMBOL_LIST.length],
    enabled: true,
  }));
}

// 1. MARD (马尔德 常用拼豆色卡全集 - 涵盖常用60+经典色)
export const MARD_PALETTE: BeadColor[] = makePalette('MARD', [
  { code: 'M01', name: '纯白', hex: '#FFFFFF' },
  { code: 'M02', name: '纯黑', hex: '#121212' },
  { code: 'M03', name: '奶白', hex: '#FFFBE6' },
  { code: 'M04', name: '米黄', hex: '#FDF1CD' },
  { code: 'M05', name: '浅黄', hex: '#FFF275' },
  { code: 'M06', name: '柠檬黄', hex: '#FFE600' },
  { code: 'M07', name: '中黄', hex: '#FFC800' },
  { code: 'M08', name: '橘黄', hex: '#FFA200' },
  { code: 'M09', name: '浅桔', hex: '#FF8400' },
  { code: 'M10', name: '鲜桔', hex: '#FF5500' },
  { code: 'M11', name: '浅粉', hex: '#FFD3E2' },
  { code: 'M12', name: '樱花粉', hex: '#FFB2CD' },
  { code: 'M13', name: '芭比粉', hex: '#FF69B4' },
  { code: 'M14', name: '玫红', hex: '#E0115F' },
  { code: 'M15', name: '大红', hex: '#E60012' },
  { code: 'M16', name: '暗红', hex: '#990000' },
  { code: 'M17', name: '浅紫', hex: '#E1BEE7' },
  { code: 'M18', name: '熏衣草紫', hex: '#CE93D8' },
  { code: 'M19', name: '深紫', hex: '#7B1FA2' },
  { code: 'M20', name: '葡萄紫', hex: '#4A148C' },
  { code: 'M21', name: '天蓝', hex: '#81D4FA' },
  { code: 'M22', name: '浅蓝', hex: '#29B6F6' },
  { code: 'M23', name: '湖蓝', hex: '#0288D1' },
  { code: 'M24', name: '宝蓝', hex: '#0D47A1' },
  { code: 'M25', name: '藏青', hex: '#1A237E' },
  { code: 'M26', name: '薄荷绿', hex: '#A7FFEB' },
  { code: 'M27', name: '浅绿', hex: '#69F0AE' },
  { code: 'M28', name: '果绿', hex: '#00E676' },
  { code: 'M29', name: '草绿', hex: '#4CAF50' },
  { code: 'M30', name: '深绿', hex: '#1B5E20' },
  { code: 'M31', name: '橄榄绿', hex: '#558B2F' },
  { code: 'M32', name: '肉色/肤色', hex: '#FFD8B8' },
  { code: 'M33', name: '粉肤色', hex: '#FFC8B0' },
  { code: 'M34', name: '卡其', hex: '#C8A2C8' },
  { code: 'M35', name: '浅棕', hex: '#A1887F' },
  { code: 'M36', name: '棕色', hex: '#6D4C41' },
  { code: 'M37', name: '深咖啡', hex: '#3E2723' },
  { code: 'M38', name: '浅灰', hex: '#E0E0E0' },
  { code: 'M39', name: '中灰', hex: '#9E9E9E' },
  { code: 'M40', name: '深灰', hex: '#616161' },
  { code: 'M41', name: '暗灰', hex: '#424242' },
  { code: 'M42', name: '浅绿松石', hex: '#80CBC4' },
  { code: 'M43', name: '水鸭蓝', hex: '#00897B' },
  { code: 'M44', name: '芥末黄', hex: '#C0CA33' },
  { code: 'M45', name: '陶土红', hex: '#D84315' },
  { code: 'M46', name: '珊瑚粉', hex: '#FF8A80' },
  { code: 'M47', name: '马卡龙蓝', hex: '#B3E5FC' },
  { code: 'M48', name: '马卡龙绿', hex: '#C8E6C9' },
  { code: 'M49', name: '马卡龙黄', hex: '#FFF9C4' },
  { code: 'M50', name: '马卡龙紫', hex: '#F3E5F5' },
  { code: 'M51', name: '金黄', hex: '#FFB300' },
  { code: 'M52', name: '焦糖', hex: '#8D6E63' },
  { code: 'M53', name: '灰蓝', hex: '#78909C' },
  { code: 'M54', name: '青灰', hex: '#546E7A' },
]);

// 2. ARTKAL (S系列 软豆 经典色卡)
export const ARTKAL_S_PALETTE: BeadColor[] = makePalette('ARTKAL_S', [
  { code: 'S01', name: 'Pure White', hex: '#FFFFFF' },
  { code: 'S02', name: 'Pure Black', hex: '#1A1A1A' },
  { code: 'S03', name: 'Bright Yellow', hex: '#FFEC00' },
  { code: 'S04', name: 'Orange', hex: '#FF7F00' },
  { code: 'S05', name: 'Red', hex: '#E30613' },
  { code: 'S06', name: 'Dark Red', hex: '#8B0000' },
  { code: 'S07', name: 'Pink', hex: '#FFB6C1' },
  { code: 'S08', name: 'Hot Pink', hex: '#FF1493' },
  { code: 'S09', name: 'Purple', hex: '#8A2BE2' },
  { code: 'S10', name: 'Deep Purple', hex: '#4B0082' },
  { code: 'S11', name: 'Sky Blue', hex: '#87CEEB' },
  { code: 'S12', name: 'Cobalt Blue', hex: '#0047AB' },
  { code: 'S13', name: 'Dark Blue', hex: '#00008B' },
  { code: 'S14', name: 'Light Green', hex: '#90EE90' },
  { code: 'S15', name: 'Green', hex: '#008000' },
  { code: 'S16', name: 'Dark Green', hex: '#006400' },
  { code: 'S17', name: 'Skin/Peach', hex: '#FFDAB9' },
  { code: 'S18', name: 'Light Brown', hex: '#CD853F' },
  { code: 'S19', name: 'Brown', hex: '#8B4513' },
  { code: 'S20', name: 'Grey', hex: '#808080' },
  { code: 'S21', name: 'Dark Grey', hex: '#A9A9A9' },
  { code: 'S22', name: 'Turquoise', hex: '#40E0D0' },
  { code: 'S23', name: 'Lime Green', hex: '#32CD32' },
  { code: 'S24', name: 'Coral', hex: '#FF7F50' },
  { code: 'S25', name: 'Beige', hex: '#F5F5DC' },
  { code: 'S26', name: 'Lavender', hex: '#E6E6FA' },
  { code: 'S27', name: 'Magenta', hex: '#FF00FF' },
  { code: 'S28', name: 'Mint Green', hex: '#98FF98' },
  { code: 'S29', name: 'Navy Blue', hex: '#000080' },
  { code: 'S30', name: 'Pastel Yellow', hex: '#FFFF99' },
]);

// 3. PERLER (美版 拼拼豆豆 经典色卡)
export const PERLER_PALETTE: BeadColor[] = makePalette('PERLER', [
  { code: 'P01', name: 'White 白色', hex: '#FFFFFF' },
  { code: 'P02', name: 'Black 黑色', hex: '#212121' },
  { code: 'P03', name: 'Red 红色', hex: '#D32F2F' },
  { code: 'P04', name: 'Dark Blue 深蓝', hex: '#1565C0' },
  { code: 'P05', name: 'Dark Green 深绿', hex: '#2E7D32' },
  { code: 'P06', name: 'Yellow 黄色', hex: '#FBC02D' },
  { code: 'P07', name: 'Brown 棕色', hex: '#5D4037' },
  { code: 'P08', name: 'Clear/Translucent 透明', hex: '#E0F7FA' },
  { code: 'P09', name: 'Light Green 浅绿', hex: '#81C784' },
  { code: 'P10', name: 'Magenta 洋红', hex: '#C2185B' },
  { code: 'P11', name: 'Light Blue 浅蓝', hex: '#64B5F6' },
  { code: 'P12', name: 'Cheddar 芝士黄', hex: '#FFA000' },
  { code: 'P13', name: 'Toothpaste 齿膏蓝', hex: '#4DD0E1' },
  { code: 'P14', name: 'Plum 梅紫', hex: '#7B1FA2' },
  { code: 'P15', name: 'Peach 桃肉色', hex: '#FFCC80' },
  { code: 'P16', name: 'Tan 浅褐', hex: '#D7CCC8' },
  { code: 'P17', name: 'Magenta 粉紫', hex: '#E91E63' },
  { code: 'P18', name: 'Pastel Yellow 柔黄', hex: '#FFF59D' },
  { code: 'P19', name: 'Pastel Green 柔绿', hex: '#A5D6A7' },
  { code: 'P20', name: 'Pastel Lavender 柔紫', hex: '#CE93D8' },
  { code: 'P21', name: 'Cranberry 蔓越莓红', hex: '#B71C1C' },
  { code: 'P22', name: 'Grey 灰色', hex: '#9E9E9E' },
  { code: 'P23', name: 'Dark Grey 深灰', hex: '#616161' },
  { code: 'P24', name: 'Rust 锈红', hex: '#BF360C' },
]);

// 4. HAMA (丹麦 Hama 经典色卡)
export const HAMA_PALETTE: BeadColor[] = makePalette('HAMA', [
  { code: 'H01', name: 'White', hex: '#FFFFFF' },
  { code: 'H02', name: 'Yellow', hex: '#FEDB00' },
  { code: 'H03', name: 'Orange', hex: '#FF6F00' },
  { code: 'H04', name: 'Red', hex: '#E52421' },
  { code: 'H05', name: 'Pink', hex: '#F06292' },
  { code: 'H06', name: 'Purple', hex: '#8E24AA' },
  { code: 'H07', name: 'Blue', hex: '#1976D2' },
  { code: 'H08', name: 'Light Blue', hex: '#4FC3F7' },
  { code: 'H09', name: 'Green', hex: '#388E3C' },
  { code: 'H10', name: 'Light Green', hex: '#81C784' },
  { code: 'H11', name: 'Light Brown', hex: '#A1887F' },
  { code: 'H12', name: 'Brown', hex: '#5D4037' },
  { code: 'H18', name: 'Black', hex: '#1C1C1C' },
  { code: 'H20', name: 'Reddish Brown', hex: '#8D6E63' },
  { code: 'H21', name: 'Light Red', hex: '#FF5252' },
  { code: 'H22', name: 'Dark Red', hex: '#B71C1C' },
  { code: 'H26', name: 'Flesh', hex: '#FFE0B2' },
  { code: 'H27', name: 'Beige', hex: '#F5F5DC' },
  { code: 'H43', name: 'Pastel Yellow', hex: '#FFF9C4' },
  { code: 'H44', name: 'Pastel Red', hex: '#FFCDD2' },
  { code: 'H45', name: 'Pastel Purple', hex: '#E1BEE7' },
  { code: 'H46', name: 'Pastel Blue', hex: '#B3E5FC' },
  { code: 'H47', name: 'Pastel Green', hex: '#C8E6C9' },
]);

export const BRAND_PALETTES: Record<BrandKey, BeadColor[]> = {
  MARD: MARD_PALETTE,
  ARTKAL_S: ARTKAL_S_PALETTE,
  PERLER: PERLER_PALETTE,
  HAMA: HAMA_PALETTE,
  CUSTOM: MARD_PALETTE, // Default starting template for custom
};

export const BRAND_NAMES: Record<BrandKey, string> = {
  MARD: '马尔德 MARD (2.6/5.0mm常用色)',
  ARTKAL_S: 'ARTKAL S系列 (软豆全色卡)',
  PERLER: 'PERLER (美版 拼拼豆豆)',
  HAMA: 'HAMA (丹麦 Hama 色卡)',
  CUSTOM: '自定义专属色板',
};

// Preset Pegboard Sizes
export const BOARD_PRESETS = [
  { name: '14x14 (小正方形板)', width: 14, height: 14, boardSize: 14 },
  { name: '29x29 (标准1板 经典大方板)', width: 29, height: 29, boardSize: 29 },
  { name: '58x29 (横向2板 58x29)', width: 58, height: 29, boardSize: 29 },
  { name: '58x58 (田字4板 2x2大图)', width: 58, height: 58, boardSize: 29 },
  { name: '87x87 (超大号 3x3板 87x87)', width: 87, height: 87, boardSize: 29 },
  { name: '50x50 (50x50高清板)', width: 50, height: 50, boardSize: 25 },
  { name: '100x100 (100x100 极高精图)', width: 100, height: 100, boardSize: 50 },
];
