class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private boostNoiseGain: GainNode | null = null;
  private boostFilter: BiquadFilterNode | null = null;
  private started = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.muted && this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    }
    if (this.muted && this.boostNoiseGain && this.ctx) {
      this.boostNoiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.started) {
      this.setupContinuousLoops();
      this.started = true;
    }
  }

  private setupContinuousLoops(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Engine hum oscillator
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(65, now);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(240, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);

    this.engineOsc = osc;
    this.engineGain = gain;

    // White noise buffer for rocket boost thruster
    const bufferSize = this.ctx.sampleRate * 1.5;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const bFilter = this.ctx.createBiquadFilter();
    bFilter.type = 'bandpass';
    bFilter.frequency.setValueAtTime(520, now);
    bFilter.Q.setValueAtTime(0.9, now);

    const bGain = this.ctx.createGain();
    bGain.gain.setValueAtTime(0, now);

    noise.connect(bFilter);
    bFilter.connect(bGain);
    bGain.connect(this.ctx.destination);
    noise.start(now);

    this.boostFilter = bFilter;
    this.boostNoiseGain = bGain;
  }

  public updateContinuous(active: boolean, speed: number, isBoosting: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.boostNoiseGain || !this.boostFilter) {
      return;
    }
    const now = this.ctx.currentTime;
    if (this.muted || !active) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.06);
      this.boostNoiseGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const normSpeed = Math.min(1, speed / 38);
    const freq = 58 + normSpeed * 115 + (isBoosting ? 24 : 0);
    this.engineOsc.frequency.setTargetAtTime(freq, now, 0.06);
    this.engineGain.gain.setTargetAtTime(0.03 + normSpeed * 0.035, now, 0.08);

    this.boostFilter.frequency.setTargetAtTime(isBoosting ? 740 : 400, now, 0.05);
    this.boostNoiseGain.gain.setTargetAtTime(isBoosting ? 0.11 : 0, now, 0.04);
  }

  public playJump(isFlip = false): void {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isFlip ? 'triangle' : 'sine';
    const startFreq = isFlip ? 280 : 190;
    const endFreq = isFlip ? 560 : 390;
    osc.frequency.setValueAtTime(startFreq * (0.94 + Math.random() * 0.12), now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.12);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playBallHit(speed: number): void {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const weight = Math.min(1, Math.max(0.2, speed / 36));
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140 + weight * 90, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.16);
    gain.gain.setValueAtTime(0.16 * weight, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playBoostPickup(isBig: boolean): void {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isBig ? 520 : 660, now);
    osc.frequency.exponentialRampToValueAtTime(isBig ? 980 : 880, now + 0.14);
    gain.gain.setValueAtTime(isBig ? 0.12 : 0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playCountdown(secondsLeft: number): void {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    const isGo = secondsLeft <= 0;
    osc.frequency.setValueAtTime(isGo ? 880 : 440, now);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.35 : 0.16));
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + (isGo ? 0.36 : 0.18));
  }

  public playGoalExplosion(): void {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Deep sub-bass boom
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, now);
    sub.frequency.exponentialRampToValueAtTime(32, now + 0.85);
    subGain.gain.setValueAtTime(0.32, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    sub.connect(subGain);
    subGain.connect(this.ctx.destination);
    sub.start(now);
    sub.stop(now + 0.92);

    // Stadium horn chord
    for (const freq of [220, 277.18, 329.63]) {
      const horn = this.ctx.createOscillator();
      const hGain = this.ctx.createGain();
      horn.type = 'sawtooth';
      horn.frequency.setValueAtTime(freq, now + 0.05);
      hGain.gain.setValueAtTime(0.06, now + 0.05);
      hGain.gain.exponentialRampToValueAtTime(0.001, now + 1.15);
      horn.connect(hGain);
      hGain.connect(this.ctx.destination);
      horn.start(now + 0.05);
      horn.stop(now + 1.18);
    }
  }

  public playDemoExplosion(): void {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.45);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }
}

export const soundEngine = new SoundEngine();
