/**
 * Input astratto: sorgenti intercambiabili (tastiera, touch, in futuro
 * gamepad/joystick arcade) che alimentano un asse laterale e l'evento salto.
 */
export interface InputSource {
  attach(sys: InputSystem): void;
  detach(): void;
}

export class InputSystem {
  /** Asse laterale -1..1 (negativo = sinistra). */
  axis = 0;
  private jumpHandlers: (() => void)[] = [];
  private anyHandlers: (() => void)[] = [];
  private sources: InputSource[] = [];

  addSource(src: InputSource): void {
    this.sources.push(src);
    src.attach(this);
  }

  onJump(fn: () => void): () => void {
    this.jumpHandlers.push(fn);
    return () => { this.jumpHandlers = this.jumpHandlers.filter((f) => f !== fn); };
  }

  /** Qualsiasi interazione (per sbloccare l'audio e avanzare le schermate). */
  onAny(fn: () => void): () => void {
    this.anyHandlers.push(fn);
    return () => { this.anyHandlers = this.anyHandlers.filter((f) => f !== fn); };
  }

  fireJump(): void { this.anyHandlers.forEach((f) => f()); this.jumpHandlers.forEach((f) => f()); }
  fireAny(): void { this.anyHandlers.forEach((f) => f()); }

  dispose(): void {
    this.sources.forEach((s) => s.detach());
    this.sources = [];
    this.jumpHandlers = [];
    this.anyHandlers = [];
  }
}

/** Tastiera: frecce/A-D per il movimento, Spazio/W/Su per saltare. */
export class KeyboardSource implements InputSource {
  private sys!: InputSystem;
  private left = false;
  private right = false;
  private down = (e: KeyboardEvent) => {
    if (e.repeat) return;
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': this.left = true; break;
      case 'ArrowRight': case 'KeyD': this.right = true; break;
      case 'Space': case 'ArrowUp': case 'KeyW':
        e.preventDefault();
        this.sys.fireJump();
        break;
      default: this.sys.fireAny(); return;
    }
    this.update();
  };
  private up = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': this.left = false; break;
      case 'ArrowRight': case 'KeyD': this.right = false; break;
    }
    this.update();
  };

  attach(sys: InputSystem): void {
    this.sys = sys;
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
  }
  detach(): void {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
  }
  private update(): void {
    this.sys.axis = (this.right ? 1 : 0) - (this.left ? 1 : 0);
  }
}

/**
 * Touch: trascinamento orizzontale = asse continuo, tap o swipe verso
 * l'alto = salto.
 */
export class TouchSource implements InputSource {
  private sys!: InputSystem;
  private startX = 0;
  private startY = 0;
  private startT = 0;
  private dragging = false;
  private el: HTMLElement;

  constructor(el: HTMLElement) { this.el = el; }

  private onStart = (e: TouchEvent) => {
    const t = e.touches[0];
    this.startX = t.clientX; this.startY = t.clientY; this.startT = performance.now();
    this.dragging = true;
    this.sys.fireAny();
  };
  private onMove = (e: TouchEvent) => {
    if (!this.dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - this.startX;
    const dy = t.clientY - this.startY;
    if (dy < -60 && Math.abs(dy) > Math.abs(dx)) {
      this.sys.fireJump();
      this.startY = t.clientY;
      return;
    }
    // Drag orizzontale proporzionale (60 px = asse pieno).
    this.sys.axis = Math.max(-1, Math.min(1, dx / 60));
  };
  private onEnd = (e: TouchEvent) => {
    const dt = performance.now() - this.startT;
    const wasTap = dt < 220 && Math.abs(this.sys.axis) < 0.25;
    this.dragging = false;
    this.sys.axis = 0;
    if (wasTap) this.sys.fireJump();
    void e;
  };

  attach(sys: InputSystem): void {
    this.sys = sys;
    this.el.addEventListener('touchstart', this.onStart, { passive: true });
    this.el.addEventListener('touchmove', this.onMove, { passive: true });
    this.el.addEventListener('touchend', this.onEnd, { passive: true });
  }
  detach(): void {
    this.el.removeEventListener('touchstart', this.onStart);
    this.el.removeEventListener('touchmove', this.onMove);
    this.el.removeEventListener('touchend', this.onEnd);
  }
}
