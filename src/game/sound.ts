class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  private engineOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private boostNoiseGain: GainNode | null = null;
  private boostFilter: BiquadFilterNode | null = null;
  private boostToneOsc: OscillatorNode | null = null;
  private boostToneGain: GainNode | null = null;

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  private started = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : 0.88, now, 0.03);
    }
    if (mute) {
      this.engineGain?.gain.setTargetAtTime(0, now, 0.04);
      this.boostNoiseGain?.gain.setTargetAtTime(0, now, 0.04);
      this.boostToneGain?.gain.setTargetAtTime(0, now, 0.04);
      this.windGain?.gain.setTargetAtTime(0, now, 0.04);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 4.5;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;

      const master = this.ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.88;

      comp.connect(master);
      master.connect(this.ctx.destination);
      this.compressor = comp;
      this.masterGain = master;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.started) {
      this.setupContinuousLoops();
      this.started = true;
    }
  }

  private getNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (this.noiseBuffer) return this.noiseBuffer;
    const bufferSize = Math.floor(this.ctx.sampleRate * 1.5);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private setupContinuousLoops(): void {
    if (!this.ctx || !this.compressor) return;
    const now = this.ctx.currentTime;

    // Dual-layer Rocket Car Engine (sawtooth mid-growl + triangle sub-octave)
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(64, now);

    const subOsc = this.ctx.createOscillator();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(32, now);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, now);
    filter.Q.setValueAtTime(1.6, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);

    osc.connect(filter);
    subOsc.connect(filter);
    filter.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    subOsc.start(now);

    this.engineOsc = osc;
    this.engineSubOsc = subOsc;
    this.engineFilter = filter;
    this.engineGain = gain;

    const buffer = this.getNoiseBuffer();
    if (!buffer) return;

    // Rocket Boost Thruster (filtered plasma jet noise + harmonic turbine whine)
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const bFilter = this.ctx.createBiquadFilter();
    bFilter.type = 'bandpass';
    bFilter.frequency.setValueAtTime(520, now);
    bFilter.Q.setValueAtTime(1.1, now);

    const bGain = this.ctx.createGain();
    bGain.gain.setValueAtTime(0, now);

    noise.connect(bFilter);
    bFilter.connect(bGain);
    bGain.connect(this.compressor);
    noise.start(now);

    const toneOsc = this.ctx.createOscillator();
    toneOsc.type = 'triangle';
    toneOsc.frequency.setValueAtTime(145, now);
    const toneGain = this.ctx.createGain();
    toneGain.gain.setValueAtTime(0, now);
    toneOsc.connect(toneGain);
    toneGain.connect(this.compressor);
    toneOsc.start(now);

    this.boostFilter = bFilter;
    this.boostNoiseGain = bGain;
    this.boostToneOsc = toneOsc;
    this.boostToneGain = toneGain;

    // High-speed aerodynamic wind rush loop
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = buffer;
    windSrc.loop = true;

    const wFilter = this.ctx.createBiquadFilter();
    wFilter.type = 'highpass';
    wFilter.frequency.setValueAtTime(950, now);

    const wGain = this.ctx.createGain();
    wGain.gain.setValueAtTime(0, now);

    windSrc.connect(wFilter);
    wFilter.connect(wGain);
    wGain.connect(this.compressor);
    windSrc.start(now);

    this.windFilter = wFilter;
    this.windGain = wGain;
  }

  public updateContinuous(active: boolean, speed: number, isBoosting: boolean): void {
    if (
      !this.ctx ||
      !this.engineOsc ||
      !this.engineSubOsc ||
      !this.engineFilter ||
      !this.engineGain ||
      !this.boostNoiseGain ||
      !this.boostFilter ||
      !this.boostToneOsc ||
      !this.boostToneGain ||
      !this.windGain ||
      !this.windFilter
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    if (this.muted || !active) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.05);
      this.boostNoiseGain.gain.setTargetAtTime(0, now, 0.04);
      this.boostToneGain.gain.setTargetAtTime(0, now, 0.04);
      this.windGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const normSpeed = Math.min(1, speed / 34);
    const rpm = 54 + normSpeed * 126 + (isBoosting ? 28 : 0);
    this.engineOsc.frequency.setTargetAtTime(rpm, now, 0.05);
    this.engineSubOsc.frequency.setTargetAtTime(rpm * 0.502, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(190 + normSpeed * 540 + (isBoosting ? 260 : 0), now, 0.06);
    this.engineGain.gain.setTargetAtTime(0.028 + normSpeed * 0.042, now, 0.06);

    // Thruster flame jet
    this.boostFilter.frequency.setTargetAtTime(isBoosting ? 980 + normSpeed * 320 : 420, now, 0.04);
    this.boostNoiseGain.gain.setTargetAtTime(isBoosting ? 0.14 : 0, now, 0.035);
    this.boostToneOsc.frequency.setTargetAtTime(155 + normSpeed * 95, now, 0.04);
    this.boostToneGain.gain.setTargetAtTime(isBoosting ? 0.04 : 0, now, 0.04);

    // Speed wind rush above 16 m/s
    const windFactor = Math.max(0, (speed - 15) / 18);
    this.windFilter.frequency.setTargetAtTime(850 + windFactor * 800, now, 0.08);
    this.windGain.gain.setTargetAtTime(Math.min(0.055, windFactor * 0.045), now, 0.08);
  }

  public playJump(isFlip = false): void {
    if (this.muted || !this.ctx || !this.compressor) return;
    const now = this.ctx.currentTime;

    // Hydraulic piston spring pop
    const thump = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(isFlip ? 180 : 145, now);
    thump.frequency.exponentialRampToValueAtTime(52, now + 0.09);
    thumpGain.gain.setValueAtTime(isFlip ? 0.18 : 0.14, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    thump.connect(thumpGain);
    thumpGain.connect(this.compressor);
    thump.start(now);
    thump.stop(now + 0.12);

    // Upward pneumatic lift chirp
    const lift = this.ctx.createOscillator();
    const liftGain = this.ctx.createGain();
    lift.type = isFlip ? 'sawtooth' : 'triangle';
    const startFreq = isFlip ? 280 : 210;
    const endFreq = isFlip ? 740 : 460;
    lift.frequency.setValueAtTime(startFreq * (0.95 + Math.random() * 0.1), now);
    lift.frequency.exponentialRampToValueAtTime(endFreq, now + 0.13);
    const lFilter = this.ctx.createBiquadFilter();
    lFilter.type = 'lowpass';
    lFilter.frequency.setValueAtTime(1400, now);
    liftGain.gain.setValueAtTime(isFlip ? 0.085 : 0.075, now);
    liftGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    lift.connect(lFilter);
    lFilter.connect(liftGain);
    liftGain.connect(this.compressor);
    lift.start(now);
    lift.stop(now + 0.15);

    // Flip whoosh noise burst
    const buf = this.getNoiseBuffer();
    if (isFlip && buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const nf = this.ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.setValueAtTime(420, now);
      nf.frequency.exponentialRampToValueAtTime(1700, now + 0.14);
      nf.Q.value = 1.4;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.14, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      src.connect(nf);
      nf.connect(ng);
      ng.connect(this.compressor);
      src.start(now);
      src.stop(now + 0.17);
    }
  }

  public playLanding(impactSpeed: number): void {
    if (this.muted || !this.ctx || !this.compressor) return;
    const weight = Math.min(1, Math.max(0.15, impactSpeed / 18));
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95 + weight * 35, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.08);
    gain.gain.setValueAtTime(0.11 * weight, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playSupersonic(): void {
    if (this.muted || !this.ctx || !this.compressor) return;
    const now = this.ctx.currentTime;
    const buf = this.getNoiseBuffer();
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(320, now);
      filter.frequency.exponentialRampToValueAtTime(2200, now + 0.16);
      filter.Q.value = 1.8;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.compressor);
      src.start(now);
      src.stop(now + 0.25);
    }
  }

  public playBallHit(speed: number): void {
    if (this.muted || !this.ctx || !this.compressor) return;
    const now = this.ctx.currentTime;
    const weight = Math.min(1, Math.max(0.22, speed / 34));

    // Punchy leather ball sub-thump
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(145 + weight * 85, now);
    sub.frequency.exponentialRampToValueAtTime(42, now + 0.13);
    subGain.gain.setValueAtTime(0.24 * weight, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    sub.connect(subGain);
    subGain.connect(this.compressor);
    sub.start(now);
    sub.stop(now + 0.16);

    // Surface snap crack for solid strikes
    const buf = this.getNoiseBuffer();
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(750 + weight * 850, now);
      filter.Q.value = 1.6;
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.12 * weight, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      src.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.compressor);
      src.start(now);
      src.stop(now + 0.07);
    }
  }

  public playBoostPickup(isBig: boolean): void {
    if (this.muted || !this.ctx || !this.compressor) return;
    const now = this.ctx.currentTime;
    const notes = isBig ? [523.25, 659.25, 1046.5] : [659.25, 987.77];
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.compressor) return;
      const t = now + idx * 0.04;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(isBig ? 0.095 : 0.055, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (isBig ? 0.22 : 0.12));
      osc.connect(gain);
      gain.connect(this.compressor);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  }

  public playCountdown(secondsLeft: number): void {
    if (this.muted || !this.ctx || !this.compressor) return;
    const now = this.ctx.currentTime;
    const isGo = secondsLeft <= 0;
    const freqs = isGo ? [587.33, 880, 1174.66] : [440, 880];
    freqs.forEach((freq, i) => {
      if (!this.ctx || !this.compressor) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(isGo ? 0.085 : 0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.42 : 0.16));
      osc.connect(gain);
      gain.connect(this.compressor);
      osc.start(now);
      osc.stop(now + (isGo ? 0.44 : 0.18));
    });
  }

  public playSave(): void {
    if (this.muted || !this.ctx || !this.compressor) return;
    const now = this.ctx.currentTime;
    [523.25, 783.99].forEach((freq, idx) => {
      if (!this.ctx || !this.compressor) return;
      const t = now + idx * 0.07;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain);
      gain.connect(this.compressor);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  public playGoalExplosion(): void {
    if (this.muted || !this.ctx || !this.compressor) return;
    const now = this.ctx.currentTime;

    // 1. Seismic sub-bass shockwave boom
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(135, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 1.0);
    subGain.gain.setValueAtTime(0.42, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    sub.connect(subGain);
    subGain.connect(this.compressor);
    sub.start(now);
    sub.stop(now + 1.12);

    // 2. Explosion rumble + stadium crowd roar swell
    const buf = this.getNoiseBuffer();
    if (buf) {
      const blast = this.ctx.createBufferSource();
      blast.buffer = buf;
      const bFilter = this.ctx.createBiquadFilter();
      bFilter.type = 'lowpass';
      bFilter.frequency.setValueAtTime(1600, now);
      bFilter.frequency.exponentialRampToValueAtTime(180, now + 0.9);
      const bGain = this.ctx.createGain();
      bGain.gain.setValueAtTime(0.32, now);
      bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
      blast.connect(bFilter);
      bFilter.connect(bGain);
      bGain.connect(this.compressor);
      blast.start(now);
      blast.stop(now + 0.96);

      const crowd = this.ctx.createBufferSource();
      crowd.buffer = buf;
      crowd.loop = true;
      const cFilter = this.ctx.createBiquadFilter();
      cFilter.type = 'bandpass';
      cFilter.frequency.setValueAtTime(750, now + 0.1);
      cFilter.Q.value = 0.7;
      const cGain = this.ctx.createGain();
      cGain.gain.setValueAtTime(0.001, now + 0.08);
      cGain.gain.linearRampToValueAtTime(0.11, now + 0.45);
      cGain.gain.exponentialRampToValueAtTime(0.001, now + 1.75);
      crowd.connect(cFilter);
      cFilter.connect(cGain);
      cGain.connect(this.compressor);
      crowd.start(now + 0.08);
      crowd.stop(now + 1.78);
    }

    // 3. Triumphant Stadium Brass Goal Horn Chord
    for (const freq of [130.81, 261.63, 329.63, 392.0]) {
      const horn = this.ctx.createOscillator();
      const hFilter = this.ctx.createBiquadFilter();
      const hGain = this.ctx.createGain();
      horn.type = 'sawtooth';
      horn.frequency.setValueAtTime(freq, now + 0.05);
      hFilter.type = 'lowpass';
      hFilter.frequency.setValueAtTime(1150, now + 0.05);
      hGain.gain.setValueAtTime(0.055, now + 0.05);
      hGain.gain.exponentialRampToValueAtTime(0.001, now + 1.35);
      horn.connect(hFilter);
      hFilter.connect(hGain);
      hGain.connect(this.compressor);
      horn.start(now + 0.05);
      horn.stop(now + 1.38);
    }
  }

  public playDemoExplosion(): void {
    if (this.muted || !this.ctx || !this.compressor) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(175, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.48);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    osc.stop(now + 0.52);

    const buf = this.getNoiseBuffer();
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.frequency.exponentialRampToValueAtTime(160, now + 0.35);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.24, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      src.connect(filter);
      filter.connect(ng);
      ng.connect(this.compressor);
      src.start(now);
      src.stop(now + 0.4);
    }
  }

  public playReplayTransition(): void {
    if (this.muted || !this.ctx || !this.compressor) return;
    const now = this.ctx.currentTime;
    const buf = this.getNoiseBuffer();
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(240, now);
      filter.frequency.exponentialRampToValueAtTime(2100, now + 0.18);
      filter.frequency.exponentialRampToValueAtTime(420, now + 0.36);
      filter.Q.value = 1.6;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.16, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      src.connect(filter);
      filter.connect(ng);
      ng.connect(this.compressor);
      src.start(now);
      src.stop(now + 0.4);
    }
    const chime = this.ctx.createOscillator();
    const cGain = this.ctx.createGain();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(659.25, now + 0.04);
    chime.frequency.exponentialRampToValueAtTime(987.77, now + 0.2);
    cGain.gain.setValueAtTime(0.08, now + 0.04);
    cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    chime.connect(cGain);
    cGain.connect(this.compressor);
    chime.start(now + 0.04);
    chime.stop(now + 0.34);
  }
}

export const soundEngine = new SoundEngine();
