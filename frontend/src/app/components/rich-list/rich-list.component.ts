import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
  NgZone,
  HostBinding,
  ChangeDetectorRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EChartsOption } from '@app/graphs/echarts';
import { Observable, of, forkJoin } from 'rxjs';
import { map, shareReplay, catchError } from 'rxjs/operators';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';
import { ApiService } from '@app/services/api.service';
import { download } from '@app/shared/graphs.utils';
import { isMobile } from '@app/shared/common.utils';
import { FormBuilder, FormGroup } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { dmdChartColors } from '@app/shared/dmd-chart-colors';

@Component({
  selector: 'app-rich-list',
  templateUrl: './rich-list.component.html',
  styleUrls: ['./rich-list.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RichListComponent implements OnInit {
  viewMode: 'wealth' | 'wallets' = 'wealth'; // ✅ Add this line
  @Input() widget = false;
  @HostBinding('attr.dir') dir = 'ltr';

  chartInitOptions = { renderer: 'svg' };
  chartInstance: any = undefined;
  chartOptions: EChartsOption = {};
  wealthChartOptions: EChartsOption = {} as EChartsOption;

  isLoading = true;
  richListObservable$: Observable<any[]> = of([]);
  summary: any;
  radioGroupForm!: FormGroup;
  currentLimit = 10;
  addressOwnerMap: { [address: string]: string } = {};

  constructor(
    public stateService: StateService,
    private seoService: SeoService,
    private apiService: ApiService,
    private zone: NgZone,
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}

  // ────────────────────────────────────────────────
  //   INITIALIZATION
  // ────────────────────────────────────────────────
  ngOnInit(): void {
    if (!this.widget) {
      this.seoService.setTitle($localize`:@@richlist.title:Rich List`);
      this.seoService.setDescription(
        $localize`:@@meta.description.bitcoin.graphs.richlist:See the top DebitMyData addresses ranked by balance.`
      );
    }

    this.radioGroupForm = this.fb.group({
      limit: [this.currentLimit.toString()],
    });

    this.radioGroupForm.get('limit')!.valueChanges.subscribe((val) => {
      this.changeLimit(Number(val));
    });

    this.zone.run(() => {
      this.loadRichList(this.currentLimit);
    });

    this.richListObservable$.subscribe(() => {
      this.loadAddressOwners();
    });

    this.updateWealthChartOptions();
  }

  // ────────────────────────────────────────────────
  //   WEALTH DISTRIBUTION CHART
  // ────────────────────────────────────────────────
  updateWealthChartOptions(): void {
    const isSmallScreen = window.innerWidth < 992;
    this.isLoading = true;

    this.http.get<any>('/api/v1/richlist/summary').subscribe({
      next: (res) => {
        const {
          top10Percent = 0,
          top25Percent = 0,
          top50Percent = 0,
          top100Percent = 0,
          top250Percent = 0,
          top500Percent = 0,
        } = res;

        const top500plus = Math.max(0, 100 - top500Percent);
        const top50plus = top100Percent - top50Percent;
        const top25plus = top50Percent - top25Percent;
        const pieData = [
          { name: 'Top 10', value: top10Percent },
          { name: 'Top 11–25', value: top25Percent - top10Percent },
          //{ name: 'Top 26–50', value: top50Percent - top25Percent },
          //{ name: 'Top 51–100', value: top100Percent - top50Percent },
          //{ name: 'Top 101–250', value: top250Percent - top100Percent },
          //{ name: 'Top 251–500', value: top500Percent - top250Percent },
          //{ name: '500+', value: Math.max(0, 100 - top500Percent) },
/******
          {
            name: '500+',
            value: top500plus,
            labelLine: {
              length: 50,
              length2: 100,
              smooth: true,
              lineStyle: {
                color: dmdChartColors().text
              }
            },
            label: {
              position: 'outside',
              align: 'left', // forces label to right side of pie
              lineHeight: 24,
              formatter: '{b}\n{d}%',
              distanceToLabelLine: 5, // ⬅️ Push label slightly off the line
            },
            labelLayout: {
              //x: '80', // nudges the label to the right
              moveOverlap: 'shiftY'
            },
          },
******/
          {
            name: 'Top 26–50',
            value: top25plus,
            labelLine: {
              length: 30,
              length2: 20,
              smooth: false,
              lineStyle: {
                color: dmdChartColors().text
              }
            },
            label: {
              position: 'outside',
              align: 'left',
              lineHeight: 24,
              formatter: '{b}\n{d}%',
              distanceToLabelLine: 5,
            },
            labelLayout: {
              moveOverlap: 'shiftY'
            },
          },
          {
            name: 'Top 51–100',
            value: top50plus,
            labelLine: {
              length: 5,
              length2: 80,
              smooth: false,
              lineStyle: {
                color: dmdChartColors().text
              }
            },
            label: {
              position: 'outside',
              align: 'left',
              lineHeight: 24,
              formatter: '{b}\n{d}%',
              distanceToLabelLine: 5,
            },
            labelLayout: {
              moveOverlap: 'shiftY'
            },
          } as any,
        ];

        this.wealthChartOptions = {
          tooltip: {
            trigger: 'item',
            formatter: '{b}: {d}%',
          },
          //graphic: [
          //  {
          //    type: 'text',
          //    left: 'center',
          //    top: 'middle',
          //    silent: true,
          //    z: 100,
          //    style: {
          //      text: `${top500Percent.toFixed(2)}% of supply`,
          //      fill: '#fff',
          //      fontSize: 13,
          //      align: 'center',
          //      verticalAlign: 'middle',
          //   },
          //  },
          //],
          series: [
            {
              name: 'Wealth',
              type: 'pie',
              radius: '60%',
              startAngle: 50,
              avoidLabelOverlap: false,
              labelLayout: { hideOverlap: false },
              label: {
                show: true,
                color: dmdChartColors().text,
                fontSize: isSmallScreen ? 10 : 13,
                distanceToLabelLine: 4,
                formatter: '{b}\n\n{d}%',
                align: 'center',
              },
              labelLine: {
                show: true,
                length: 25,
                length2: 16,
              },
              itemStyle: {
                borderRadius: 3,
                borderWidth: 1,
                borderColor: dmdChartColors().border,
                shadowBlur: 6,
                shadowColor: 'rgba(17,17,26,0.15)',
              },
              emphasis: {
                label: {
                  show: true,
                  fontSize: 15,
                  fontWeight: 'bold',
                },
              },
              data: pieData,
            },
          ],
        };

        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('❌ Failed to load richlist summary:', err);
        this.isLoading = false;
      },
    });
  }

  // ────────────────────────────────────────────────
  //   EXISTING RICHLIST LOGIC
  // ────────────────────────────────────────────────
  changeLimit(limit: number) {
    if (this.currentLimit === limit) return;
    this.currentLimit = limit;
    this.loadRichList(limit);
  }

  private loadRichList(limit: number) {
    this.isLoading = true;

    this.richListObservable$ = this.apiService.getRichList(limit).pipe(
      map((data: any) => {
        this.isLoading = false;
        const list = Array.isArray(data) ? data : data.richlist || [];

        // Fix reduce error safeguard
        if (!Array.isArray(list)) {
          console.warn('⚠️ Richlist response is not an array:', list);
          return [];
        }

        this.prepareChartOptions(list, this.currentLimit);
        return list;
      }),
      catchError((err) => {
        console.error('Rich list fetch failed:', err);
        this.isLoading = false;
        return of([]);
      }),
      shareReplay(1)
    );

    this.apiService.getRichListSummary().subscribe((s) => {
      this.summary = s;
      this.isLoading = false;
    });
  }

  generateChartSerieData(richList: any[], limit: number) {
    if (!Array.isArray(richList)) return [];

    if (limit <= 10) {
      return richList.map((e: any) => ({
        value: e.balance,
        balance: e.balance,
        rank: e.rank,
        address: e.address,
        globalPercent: e.percent,
        name: `#${e.rank} ${e.address.slice(0, 10)}…`,
      }));
    }

    if (limit <= 50) {
      return richList.map((e: any) => ({
        value: e.balance,
        balance: e.balance,
        rank: e.rank,
        globalPercent: e.percent,
        name: `#${e.rank}`,
      }));
    }

    const mkGroup = (label: string, from: number, to: number) => {
      const subset = Array.isArray(richList)
        ? richList.filter((x: any) => x.rank >= from && x.rank <= to)
        : [];
      const totalBalance = subset.reduce((s: number, x: any) => s + (x.balance || 0), 0);
      const totalPercent = subset.reduce((s: number, x: any) => s + (x.percent || 0), 0);
      return {
        value: totalBalance,
        balance: totalBalance,
        name: label,
        range: [from, to],
        globalPercent: totalPercent,
      };
    };

    return [
      mkGroup('Top 1–10', 1, 10),
      mkGroup('Top 11–25', 11, 25),
      mkGroup('Top 26–50', 26, 50),
      mkGroup(`Top 51–${limit}`, 51, limit),
    ];
  }

  prepareChartOptions(richList: any[], limit: number) {
    const isSmallScreen = window.innerWidth < 992;
    const pieSize = ['40%', '75%'];
    const data = this.generateChartSerieData(richList, limit);

    const centerPct = Array.isArray(data)
      ? data.reduce((s: number, d: any) => s + (d.globalPercent ?? 0), 0)
      : 0;

    this.chartOptions = {
      animation: true,
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        borderColor: '#333',
        textStyle: { color: dmdChartColors().text, fontSize: 12 },
        formatter: (p: any) => {
          const d = p.data || {};
          const pct = (d.globalPercent ?? 0).toFixed(2);
          const bal = (d.balance ?? d.value ?? 0).toLocaleString(undefined, {
            minimumFractionDigits: 8,
            maximumFractionDigits: 8,
          });
          const title = d.address ? `#${d.rank} ${d.address}` : d.name || '';
          return `
            <div style="text-align:left">
              <b style="color:#fff;">${title}</b><br>
              ${bal} coins<br>
              <span style="color:#0f0;">${pct}% of supply</span>
            </div>
          `;
        },
      },
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: 'middle',
          silent: true,
          z: 100,
          style: {
            text: `${centerPct.toFixed(2)}% of supply`,
            fill: dmdChartColors().strong,
            fontSize: 13,
            align: 'center',
            verticalAlign: 'middle',
          },
        },
      ],
      series: [
        {
          name: 'Rich List',
          type: 'pie',
          radius: pieSize,
          center: ['50%', '55%'],
          avoidLabelOverlap: false,
          label: {
            show: true,
            position: 'outside',
            formatter: (p: any) => p.data?.name || '',
            color: '#ffffff',
            fontSize: limit > 50 ? 9 : 11,
            textBorderColor: 'transparent',
            textShadowColor: 'transparent',
          },
          labelLine: {
            show: limit <= 100,
            length: 8,
            length2: 6,
          },
          itemStyle: {
            borderRadius: 3,
            borderWidth: limit <= 50 ? 1 : 0,
            borderColor: dmdChartColors().border,
            shadowBlur: 6,
            shadowColor: 'rgba(17,17,26,0.15)',
          },
          emphasis: {
            scale: true,
            scaleSize: 10,
            itemStyle: {
              shadowBlur: 22,
              shadowColor: 'rgba(255,255,255,0.5)',
            },
          },
          data,
        },
      ],
    };
  }

  // ────────────────────────────────────────────────
  //   UTILITIES
  // ────────────────────────────────────────────────
  onChartInit(ec: any) {
    if (!this.chartInstance) this.chartInstance = ec;
  }

  onSaveChart() {
    if (!this.chartInstance) return;
    const now = new Date();
    this.chartInstance.setOption(this.chartOptions);
    download(
      this.chartInstance.getDataURL({
        pixelRatio: 2,
        excludeComponents: ['dataZoom'],
      }),
      `richlist-${Math.round(now.getTime() / 1000)}.svg`
    );
    this.chartOptions.backgroundColor = 'none';
    this.chartInstance.setOption(this.chartOptions);
  }

  onSaveList(richList: any[]) {
    if (!richList || !Array.isArray(richList) || richList.length === 0) return;

    let csvContent = 'Rank,Address,Balance\n';
    richList.forEach((entry) => {
      csvContent += `${entry.rank},${entry.address},${entry.balance}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `richlist-top${this.currentLimit}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  isMobileView(): boolean {
    return window.innerWidth <= 768;
  }

  shortAddress(address: string): string {
    if (!address) return '';
    return this.isMobileView()
      ? `${address.slice(0, 4)}...${address.slice(-4)}`
      : address;
  }

  getAddressOwner(address: string): string {
    if (!address) return '—';
    const normalized = address.trim().toLowerCase();
    return this.addressOwnerMap[normalized] || '—';
  }

  getFormattedPercent(percent: number): string {
    return this.isMobileView() ? percent.toFixed(2) : percent.toFixed(4);
  }

  // ────────────────────────────────────────────────
  //   LOAD OWNER DATA
  // ────────────────────────────────────────────────
  loadAddressOwners() {
    console.log('▶ Starting loadAddressOwners');

    // --- EXCHANGES ---
    this.http.get<any[]>('/api/v1/exchanges').subscribe({
      next: (exchanges) => {
        for (const exchange of exchanges) {
          const addresses: string[] = exchange.addresses || [];
          for (const addr of addresses) {
            this.addressOwnerMap[addr] = exchange.name;
          }
        }
        this.cdr.detectChanges();
        console.log('✅ Exchanges loaded:', this.addressOwnerMap);
      },
      error: (err) =>
        console.error('Failed to load exchange address ownership info:', err),
    });

    // --- MINING POOLS ---
    this.http.get<any[]>('/api/v1/mining/pools').subscribe({
      next: (pools) => {
        console.log(`▶ Fetched ${pools.length} mining pools`);
        const validPools = pools.filter(
          (p) => p.slug && typeof p.slug === 'string'
        );

        const poolCalls = validPools.map((pool) =>
          this.http.get<any>(`/api/v1/mining/pool/${pool.slug}`)
        );

        if (poolCalls.length === 0) {
          console.warn('⚠ No valid pool slugs found');
          return;
        }

        forkJoin(poolCalls).subscribe({
          next: (poolDetails) => {
            for (const detail of poolDetails) {
              const poolData = detail.pool || detail;
              const name = poolData.name || '(unknown)';
              const addresses: string[] = poolData.addresses || [];

              for (const addr of addresses) {
                const normalized = addr.trim().toLowerCase();
                this.addressOwnerMap[normalized] = name;
              }
            }
            console.log(
              '✅ Final addressOwnerMap total:',
              Object.keys(this.addressOwnerMap).length
            );
          },
          error: (err) => console.error('❌ Pool details fetch error:', err),
        });
      },
      error: (err) => console.error('❌ Pool list fetch error:', err),
    });
  }
}
