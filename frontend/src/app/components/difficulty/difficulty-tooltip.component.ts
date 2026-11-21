import { Component, ElementRef, ViewChild, Input, OnChanges, HostListener } from '@angular/core';

interface EpochProgress {
  base: string;
  change: number;
  progress: number;
  minedBlocks: number;
  remainingBlocks: number;
  expectedBlocks: number;
  newDifficultyHeight: number;
  colorAdjustments: string;
  colorPreviousAdjustments: string;
  estimatedRetargetDate: number;
  previousRetarget: number;
  blocksUntilHalving: number;
  timeUntilHalving: number;
  difficulty_adjustment?: string;
}

const EPOCH_BLOCK_LENGTH = 2016; // Bitcoin mainnet

@Component({
  selector: 'app-difficulty-tooltip',
  templateUrl: './difficulty-tooltip.component.html',
  styleUrls: ['./difficulty-tooltip.component.scss'],
  standalone: false,
})
export class DifficultyTooltipComponent implements OnChanges {
  @Input() status: string | void;
  @Input() progress: EpochProgress | void = null;
  @Input() cursorPosition: { x: number, y: number };

  mined: number;
  ahead: number;
  behind: number;
  expected: number;
  remaining: number;
  isAhead: boolean;
  isBehind: boolean;
  isMobile: boolean;
  isLWMA = false;

  tooltipPosition = { x: 0, y: 0 };

  @ViewChild('tooltip') tooltipElement: ElementRef<HTMLCanvasElement>;

  constructor() {
    this.onResize();
  }

  ngOnChanges(changes): void {
    //console.log('expected:', this.expected, 'mined:', this.mined, 'behind:', this.behind);
    if (changes.cursorPosition && changes.cursorPosition.currentValue) {
      let x = changes.cursorPosition.currentValue.x;
      const y = changes.cursorPosition.currentValue.y - 50;
      if (this.tooltipElement) {
        const elementBounds = this.tooltipElement.nativeElement.getBoundingClientRect();
        x -= elementBounds.width / 2;
        x = Math.min(Math.max(x, 20), (window.innerWidth - 20 - elementBounds.width));
      }
      this.tooltipPosition = { x, y };
    }

    if ((changes.progress || changes.status) && this.progress && this.status) {

      // ✅ Detect LWMA safely
      this.isLWMA =
        (this.progress as any).difficulty_adjustment === 'lwma';

      if (this.isLWMA) {
        // 🔷 LWMA mode: no epoch / no retarget math
        this.mined = this.progress.minedBlocks ?? 0;
        this.remaining = 0;
        this.expected = 0;
        this.ahead = 0;
        this.behind = 0;
        this.isAhead = false;
        this.isBehind = false;
        return;
      }

      // Directly use the API's remainingBlocks for tooltip display
      this.remaining = this.progress.remainingBlocks ?? 0;
      // Keep mined and expected just for internal display or future use
      this.expected = this.progress.expectedBlocks ?? 0;
      this.mined = this.progress.minedBlocks ?? 0;
      // The "behind" value now reflects the API instead of recalculation
      this.behind = Math.round(this.remaining);
      this.ahead = Math.max(0, this.mined - this.expected);
      this.isAhead = this.ahead > 0;
      this.isBehind = this.behind > 0;
      //console.log('Tooltip using API remainingBlocks =', this.remaining);
    }

  }

  @HostListener('window:resize', ['$event'])
  onResize(): void {
    this.isMobile = window.innerWidth <= 767.98;
  }
}
