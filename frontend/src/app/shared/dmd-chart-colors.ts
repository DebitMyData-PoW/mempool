// Chart colours for the DebitMyData light and dark themes. Charts read them when they are drawn,
// and ThemeService swaps them on the charts already on screen when the visitor changes theme.
export interface DmdChartColors {
  text: string;    // legends and labels
  muted: string;   // zoom slider lines
  line: string;    // average and marker lines
  border: string;  // borders between pie and treemap slices (the card colour)
  strong: string;  // titles drawn inside charts
}

export const DMD_CHART_LIGHT: DmdChartColors = {
  text: '#55606e',
  muted: '#7d8797',
  line: '#b9bec8',
  border: '#ffffff',
  strong: '#211f1f',
};

export const DMD_CHART_DARK: DmdChartColors = {
  text: '#b9bac4',
  muted: '#9a9ba6',
  line: '#4a4a55',
  border: '#202027',
  strong: '#ececf1',
};

export function dmdIsDark(): boolean {
  try {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  } catch (e) {
    return false;
  }
}

export function dmdChartColors(): DmdChartColors {
  return dmdIsDark() ? DMD_CHART_DARK : DMD_CHART_LIGHT;
}

// Returns a copy of a chart's options with the colours of one theme replaced by the other's.
export function swapDmdChartColors(option: any, toDark: boolean): any {
  const from = toDark ? DMD_CHART_LIGHT : DMD_CHART_DARK;
  const to = toDark ? DMD_CHART_DARK : DMD_CHART_LIGHT;
  const map = new Map<string, string>();
  for (const key of Object.keys(from)) {
    map.set(from[key].toLowerCase(), to[key]);
  }
  const walk = (value: any, depth: number): any => {
    if (depth > 12 || value === null || value === undefined) {
      return value;
    }
    if (typeof value === 'string') {
      const swapped = map.get(value.toLowerCase());
      return swapped === undefined ? value : swapped;
    }
    if (Array.isArray(value)) {
      // Long arrays are chart data, not colours.
      return value.length > 64 ? value : value.map((v) => walk(v, depth + 1));
    }
    if (typeof value === 'object') {
      const out: any = {};
      for (const key of Object.keys(value)) {
        out[key] = walk(value[key], depth + 1);
      }
      return out;
    }
    return value;
  };
  return walk(option, 0);
}
