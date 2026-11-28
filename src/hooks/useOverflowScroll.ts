import { useCallback, useEffect, useRef, useState } from 'react';

/** 横向滚动容器的两端溢出状态。 */
export interface OverflowScrollFlags {
  /** 左侧仍有被裁掉的内容（还能向左滚）。 */
  start: boolean;
  /** 右侧仍有被裁掉的内容（还能向右滚）。 */
  end: boolean;
}

/**
 * 监听横向滚动容器的两端溢出状态，用于「仅在真的滚得动时」渲染两端渐隐遮罩。
 *
 * 常驻遮罩会把不滚动的最后/第一个 chip 压暗（390px 下规格行本来一行放得下），
 * 所以遮罩必须由真实测量驱动：`scrollWidth > clientWidth` 才认为可滚。
 * 尺寸变化（旋转、字体加载、抽屉开合）通过 `ResizeObserver` 重新测量。
 *
 * @returns `ref` 挂到滚动容器上，`flags` 表示左右是否还有被裁掉的内容。
 */
export function useOverflowScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [flags, setFlags] = useState<OverflowScrollFlags>({ start: false, end: false });

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    // 1px 容差：亚像素布局下 scrollLeft/clientWidth 会有小数抖动。
    const start = node.scrollLeft > 1;
    const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
    setFlags(previous => (previous.start === start && previous.end === end ? previous : { start, end }));
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    measure();
    node.addEventListener('scroll', measure, { passive: true });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(node);
    }
    window.addEventListener('resize', measure);
    return () => {
      node.removeEventListener('scroll', measure);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return { ref, flags };
}
