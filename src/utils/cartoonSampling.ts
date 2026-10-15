interface InkRun { line: number; start: number; end: number; track: InkRun[]; links: number }

/** Follow narrow, source-connected runs; broad dark fills stay with area sampling. */
export function projectCartoonInk(
  data: Uint8ClampedArray, width: number, height: number,
  columns: number, rows: number, alphaCutoff: number, background: Uint8Array,
  representedInk = new Uint8Array(columns * rows),
): Array<[number, number, number] | null> {
  const scaleX = width / columns;
  const scaleY = height / rows;
  const result: Array<[number, number, number] | null> = Array(columns * rows).fill(null);
  const occupied = new Uint8Array(representedInk);
  const isInk = (index: number) => {
    const offset = index * 4;
    const high = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    const low = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    return !background[index] && data[offset + 3] >= alphaCutoff && high <= 64 && high - low <= 32;
  };
  for (const axis of [0, 1]) {
    const length = axis === 0 ? width : height;
    const lines = axis === 0 ? height : width;
    const acrossScale = axis === 0 ? scaleX : scaleY;
    const alongScale = axis === 0 ? scaleY : scaleX;
    const maxRun = Math.max(2, acrossScale * 0.65);
    const minimumSupport = Math.max(2, alongScale * 0.6);
    const cellIndex = (band: number, across: number) => axis === 0 ? band * columns + across : across * columns + band;
    const finish = (track: InkRun[]) => {
      if (track.length < minimumSupport) return;
      let begin = 0;
      while (begin < track.length) {
        const band = Math.floor((track[begin].line + 0.5) / alongScale);
        let end = begin + 1;
        while (end < track.length && Math.floor((track[end].line + 0.5) / alongScale) === band) end++;
        const n = end - begin;
        if (n >= minimumSupport) {
          let l = 0, c = 0, ll = 0, lc = 0;
          const rgb: [number, number, number] = [0, 0, 0];
          const footprint = new Set<number>();
          for (let i = begin; i < end; i++) {
            const run = track[i], middle = (run.start + run.end) / 2;
            const localLine = run.line - track[begin].line;
            l += localLine; c += middle; ll += localLine * localLine; lc += localLine * middle;
            const offset = (axis === 0 ? run.line * width + Math.floor(middle) : Math.floor(middle) * width + run.line) * 4;
            for (let channel = 0; channel < 3; channel++) rgb[channel] += data[offset + channel] / n;
            for (let across = Math.floor(run.start / acrossScale); across <= Math.floor((run.end - 0.001) / acrossScale); across++) {
              footprint.add(cellIndex(band, across));
            }
          }
          let slope = Math.abs((n * lc - l * c) / Math.max(1, n * ll - l * l)) * alongScale / acrossScale;
          if (n < alongScale * 0.9) {
            // A clipped stroke endpoint biases a short local fit. Use at most
            // one adjacent strip of the SAME connected track for direction only.
            let dl = 0, dc = 0, dll = 0, dlc = 0, dn = 0;
            for (let i = Math.max(0, begin - Math.ceil(alongScale)); i < Math.min(track.length, end + Math.ceil(alongScale)); i++) {
              const line = track[i].line - track[begin].line, middle = (track[i].start + track[i].end) / 2;
              dl += line; dc += middle; dll += line * line; dlc += line * middle; dn++;
            }
            slope = Math.abs((dn * dlc - dl * dc) / Math.max(1, dn * dll - dl * dl)) * alongScale / acrossScale;
          }
          // Near-diagonals belong to the row pass only. The column pass handles
          // predominantly horizontal strokes, not a duplicate of the same diagonal.
          const followsAxis = axis === 0 ? slope <= 1.05 : slope < 1 / 1.05;
          const index = cellIndex(band, Math.floor(c / n / acrossScale));
          // Only this connected stroke's actual source footprint counts, not a
          // bounding box or unrelated dark neighbours. Never widen represented ink.
          if (followsAxis && footprint.has(index) && !Array.from(footprint).some(cell => occupied[cell])) {
            result[index] = rgb;
            occupied[index] = 1;
          }
        }
        begin = end;
      }
    };
    let previous: InkRun[] = [];
    for (let line = 0; line <= lines; line++) {
      const current: InkRun[] = [];
      let start = -1;
      for (let position = 0; line < lines && position <= length; position++) {
        const index = axis === 0 ? line * width + position : position * width + line;
        if (position < length && isInk(index)) {
          if (start < 0) start = position;
          continue;
        }
        if (start < 0) continue;
        if (position - start <= maxRun) {
          current.push({ line, start, end: position, track: [], links: 0 });
        }
        start = -1;
      }
      // Adjacent scanlines must contain an actual 8-connected, one-to-one run.
      // Branches end a track rather than averaging several parallel arms together.
      for (const run of previous) run.links = 0;
      const parents = new Map<InkRun, InkRun>();
      let first = 0;
      for (const run of current) {
        while (first < previous.length && previous[first].end < run.start) first++;
        for (let i = first; i < previous.length && previous[i].start <= run.end; i++) {
          run.links++; previous[i].links++; parents.set(run, previous[i]);
        }
      }
      const continued = new Set<InkRun[]>();
      for (const run of current) {
        const parent = parents.get(run);
        if (run.links === 1 && parent?.links === 1) { run.track = parent.track; continued.add(run.track); }
        run.track.push(run);
      }
      for (const run of previous) if (!continued.has(run.track)) finish(run.track);
      previous = current;
    }
  }
  return result;
}
