import { smartReduceGrid, type ReductionOptions } from './smartReduceUtils';
import type { BeadColor } from '../types';

export interface SmartReduceRequest {
  id: number;
  grid: (string | null)[][];
  palette: BeadColor[];
  options: ReductionOptions;
}

self.onmessage = (event: MessageEvent<SmartReduceRequest>) => {
  const { id, grid, palette, options } = event.data;
  try {
    self.postMessage({ id, report: smartReduceGrid(grid, palette, options) });
  } catch (error) {
    self.postMessage({ id, error: 'calculation-failed' });
  }
};
