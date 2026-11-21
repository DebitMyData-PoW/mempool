import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { defaultMempoolFeeColors, contrastMempoolFeeColors, dmdDarkMempoolFeeColors } from '@app/app.constants';
import { StorageService } from '@app/services/storage.service';
import { StateService } from '@app/services/state.service';
import { swapDmdChartColors } from '@app/shared/dmd-chart-colors';

// DebitMyData: the explorer has a light look ('default') and a dark look ('dark'). The visitor's
// choice is kept in the explorer's own "dmd-theme-explorer" cookie (for this site only: the pool,
// the website and id.debitmydata.io each remember their own choice). Without a choice the
// explorer opens dark. The small script in index.html applies the choice before the page is
// drawn, so there is no flash of the wrong colours.
export const DMD_THEME_COOKIE = 'dmd-theme-explorer';
export const DMD_DEFAULT_THEME = 'dark';

function readDmdTheme(): string {
  try {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light') {
      return 'default';
    }
    if (attr === 'dark') {
      return 'dark';
    }
  } catch (e) {}
  return DMD_DEFAULT_THEME;
}

function saveDmdTheme(value: 'light' | 'dark'): void {
  try {
    localStorage.setItem(DMD_THEME_COOKIE, value);
  } catch (e) {}
  try {
    const secure = location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${DMD_THEME_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax${secure}`;
  } catch (e) {}
}

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  style: HTMLLinkElement | null = null;
  theme: string = '';
  themeState$: BehaviorSubject<{ theme: string; loading: boolean; }>;
  mempoolFeeColors: string[] = defaultMempoolFeeColors;
  initialLoad: boolean = true;

  constructor(
    private storageService: StorageService,
    private stateService: StateService,
  ) {
    const theme = this.stateService.env.customize?.theme || readDmdTheme();
    this.themeState$ = new BehaviorSubject({ theme, loading: false });
    this.apply(theme, false);
  }

  get isDark(): boolean {
    return this.theme === 'dark';
  }

  toggleDark(): void {
    this.apply(this.isDark ? 'default' : 'dark');
  }

  apply(theme: string, save = true): void {
    if (this.theme === theme) {
      return;
    }
    const previous = this.theme;
    this.theme = theme;

    const dmdTheme = theme === 'default' || theme === 'dark';
    const look = theme === 'dark' ? 'dark' : 'light';
    try {
      document.documentElement.setAttribute('data-theme', look);
      document.documentElement.style.colorScheme = look;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', look === 'dark' ? '#18181d' : '#ffffff');
    } catch (e) {}
    if (previous && previous !== theme) {
      this.recolorCharts(look === 'dark');
    }

    if (dmdTheme) {
      if (this.style) {
        this.style.remove();
        this.style = null;
      }
      if (save && !this.stateService.env.customize?.theme) {
        saveDmdTheme(look);
      }
      this.mempoolFeeColors = theme === 'dark' ? dmdDarkMempoolFeeColors : defaultMempoolFeeColors;
      this.themeState$.next({ theme, loading: false });
      return;
    }

    // Other themes (contrast, softsimon, bukele): load their stylesheet
    this.themeState$.next({ theme, loading: true });
    try {
      if (!this.style) {
        this.style = document.createElement('link');
        this.style.rel = 'stylesheet';
        if (this.initialLoad) {
          this.style.media = 'print'; // Prevent white flash and other CSS issues when using custom theme on initial app load in Safari
        }
        document.head.appendChild(this.style); // load the css now
      }

      this.style.onload = () => {
        if (this.initialLoad) {
          this.style.media = 'all';
          this.initialLoad = false;
        }
        this.mempoolFeeColors = theme === 'contrast' || theme === 'bukele' ? contrastMempoolFeeColors : defaultMempoolFeeColors;
        this.themeState$.next({ theme, loading: false });
      };
      this.style.onerror = () => this.apply('default');
      this.style.href = this.getThemeFile(theme);
    } catch (err) {
      console.log('failed to apply theme stylesheet: ', err);
      this.apply('default');
    }
  }

  private getThemeFile(theme: string): string {
    const themeFiles = (window as any).__env?.THEME_FILES;
    if (themeFiles?.[theme]) {
      return themeFiles[theme];
    }
    return `${theme}.css`;
  }

  // Charts already on screen keep the colours they were drawn with, so swap their text and line
  // colours for the new theme. Charts drawn later pick the right ones themselves.
  private recolorCharts(dark: boolean): void {
    let boxes: HTMLElement[] = [];
    try {
      boxes = Array.from(document.querySelectorAll('[_echarts_instance_]')) as HTMLElement[];
    } catch (e) {}
    if (!boxes.length) {
      return;
    }
    import('@app/graphs/echarts').then(({ echarts }) => {
      for (const box of boxes) {
        const chart = echarts.getInstanceByDom(box);
        if (chart && !chart.isDisposed()) {
          chart.setOption(swapDmdChartColors(chart.getOption(), dark));
        }
      }
    }).catch(() => {});
  }
}
