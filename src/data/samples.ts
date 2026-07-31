import { SampleImage } from '../types';

// Helper to create a colorful SVG pixel art sample as data URL
function createSampleSvgUrl(type: 'strawberry' | 'mario' | 'cat' | 'heart' | 'star'): string {
  let innerSvg = '';
  if (type === 'heart') {
    innerSvg = `
      <rect width="16" height="16" fill="#f8fafc"/>
      <path d="M 4 3 h 3 v 1 h -3 z M 9 3 h 3 v 1 h -3 z M 3 4 h 5 v 1 h -5 z M 8 4 h 5 v 1 h -5 z M 2 5 h 12 v 4 h -12 z M 3 9 h 10 v 1 h -10 z M 4 10 h 8 v 1 h -8 z M 5 11 h 6 v 1 h -6 z M 6 12 h 4 v 1 h -4 z M 7 13 h 2 v 1 h -2 z" fill="#ef4444"/>
      <rect x="4" y="5" width="2" height="2" fill="#ffffff"/>
    `;
  } else if (type === 'strawberry') {
    innerSvg = `
      <rect width="16" height="16" fill="#f8fafc"/>
      <path d="M 6 2 h 4 v 2 h -4 z M 5 4 h 6 v 1 h -6 z" fill="#22c55e"/>
      <path d="M 4 5 h 8 v 2 h -8 z M 3 7 h 10 v 5 h -10 z M 4 12 h 8 v 1 h -8 z M 5 13 h 6 v 1 h -6 z M 7 14 h 2 v 1 h -2 z" fill="#f43f5e"/>
      <circle cx="5" cy="8" r="0.6" fill="#fef08a"/>
      <circle cx="9" cy="8" r="0.6" fill="#fef08a"/>
      <circle cx="11" cy="9" r="0.6" fill="#fef08a"/>
      <circle cx="7" cy="10" r="0.6" fill="#fef08a"/>
      <circle cx="5" cy="11" r="0.6" fill="#fef08a"/>
      <circle cx="9" cy="11" r="0.6" fill="#fef08a"/>
    `;
  } else if (type === 'star') {
    innerSvg = `
      <rect width="16" height="16" fill="#f1f5f9"/>
      <path d="M 7 2 h 2 v 3 h -2 z M 6 5 h 4 v 2 h -4 z M 2 7 h 12 v 2 h -12 z M 4 9 h 8 v 2 h -8 z M 5 11 h 2 v 2 h -2 z M 9 11 h 2 v 2 h -2 z M 4 13 h 2 v 2 h -2 z M 10 13 h 2 v 2 h -2 z" fill="#eab308"/>
      <rect x="5" y="8" width="1" height="2" fill="#000000"/>
      <rect x="10" y="8" width="1" height="2" fill="#000000"/>
    `;
  } else if (type === 'cat') {
    innerSvg = `
      <rect width="16" height="16" fill="#ffffff"/>
      <path d="M 3 3 h 3 v 3 h -3 z M 10 3 h 3 v 3 h -3 z M 3 6 h 10 v 7 h -10 z M 4 13 h 8 v 1 h -8 z" fill="#f97316"/>
      <rect x="5" y="8" width="2" height="2" fill="#000000"/>
      <rect x="9" y="8" width="2" height="2" fill="#000000"/>
      <rect x="7" y="10" width="2" height="1" fill="#f43f5e"/>
      <rect x="4" y="5" width="1" height="1" fill="#fbcfe8"/>
      <rect x="11" y="5" width="1" height="1" fill="#fbcfe8"/>
    `;
  } else {
    // Mario style
    innerSvg = `
      <rect width="16" height="16" fill="#ffffff"/>
      <rect x="5" y="1" width="6" height="1" fill="#ef4444"/>
      <rect x="4" y="2" width="10" height="1" fill="#ef4444"/>
      <rect x="4" y="3" width="3" height="1" fill="#78350f"/>
      <rect x="7" y="3" width="2" height="1" fill="#fde047"/>
      <rect x="9" y="3" width="1" height="1" fill="#78350f"/>
      <rect x="3" y="4" width="1" height="3" fill="#78350f"/>
      <rect x="4" y="4" width="1" height="1" fill="#fde047"/>
      <rect x="5" y="4" width="1" height="2" fill="#78350f"/>
      <rect x="6" y="4" width="3" height="1" fill="#fde047"/>
      <rect x="9" y="4" width="4" height="1" fill="#78350f"/>
      <rect x="4" y="5" width="1" height="1" fill="#fde047"/>
      <rect x="6" y="5" width="7" height="1" fill="#fde047"/>
      <rect x="5" y="6" width="7" height="1" fill="#fde047"/>
      <rect x="4" y="7" width="8" height="1" fill="#ef4444"/>
      <rect x="3" y="8" width="3" height="3" fill="#ef4444"/>
      <rect x="6" y="8" width="1" height="3" fill="#3b82f6"/>
      <rect x="7" y="8" width="2" height="3" fill="#ef4444"/>
      <rect x="9" y="8" width="1" height="3" fill="#3b82f6"/>
      <rect x="10" y="8" width="3" height="3" fill="#ef4444"/>
      <rect x="2" y="11" width="12" height="2" fill="#3b82f6"/>
      <rect x="3" y="13" width="3" height="2" fill="#78350f"/>
      <rect x="10" y="13" width="3" height="2" fill="#78350f"/>
    `;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 16 16">${innerSvg}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const SAMPLE_IMAGES: SampleImage[] = [
  { id: 'strawberry', name: '草莓小拼豆', category: '可爱萌物', url: createSampleSvgUrl('strawberry') },
  { id: 'heart', name: '爱心像素', category: '经典像素', url: createSampleSvgUrl('heart') },
  { id: 'mario', name: '马里奥经典', category: '游戏动漫', url: createSampleSvgUrl('mario') },
  { id: 'star', name: '无敌星', category: '游戏动漫', url: createSampleSvgUrl('star') },
  { id: 'cat', name: '橘猫头像', category: '可爱萌物', url: createSampleSvgUrl('cat') },
];
