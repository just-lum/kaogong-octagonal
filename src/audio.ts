/**
 * 音效全部由 Web Audio 合成，不引入任何音频素材。
 *
 * 合成函数与具体上下文解耦：同一个函数既能挂在实时 AudioContext 上，
 * 也能在 OfflineAudioContext 里渲染出波形——无头环境无法试听，
 * 但峰值、时长、RMS 是可测的数字，交给 scripts 里的探针验证。
 */

export type SoundName = "jade" | "wood" | "silk" | "metal" | "paper";

export interface AudioPreferences {
  soundOn: boolean;
  musicOn: boolean;
  soundVolume: number;
  musicVolume: number;
}

export const DEFAULT_AUDIO_PREFS: AudioPreferences = {
  soundOn: true,
  musicOn: false,
  soundVolume: 0.55,
  musicVolume: 0.4,
};

type Synth = (ctx: BaseAudioContext, out: AudioNode, at: number, gain: number) => void;

/** 白噪声缓冲按上下文缓存，避免每次发声都重新生成 */
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const length = Math.floor(ctx.sampleRate * 1.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buffer);
  return buffer;
}

/** 玉石轻击：高频瞬态加一个极短的击点噪声 */
const jade: Synth = (ctx, out, at, gain) => {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(2380 + Math.random() * 420, at);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + 0.34);

  const tick = ctx.createBufferSource();
  tick.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 3200;
  const tickEnv = ctx.createGain();
  tickEnv.gain.setValueAtTime(gain * 0.45, at);
  tickEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
  tick.connect(hp).connect(tickEnv).connect(out);
  tick.start(at);
  tick.stop(at + 0.06);
};

/** 木质扣合：低频三角波配快速衰减，带一点摩擦头 */
const wood: Synth = (ctx, out, at, gain) => {
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(210, at);
  osc.frequency.exponentialRampToValueAtTime(92, at + 0.1);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + 0.2);

  const head = ctx.createBufferSource();
  head.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 900;
  bp.Q.value = 0.9;
  const headEnv = ctx.createGain();
  headEnv.gain.setValueAtTime(gain * 0.35, at);
  headEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  head.connect(bp).connect(headEnv).connect(out);
  head.start(at);
  head.stop(at + 0.07);
};

/** 金属铮鸣：非整数倍泛音列，衰减比木、石都长 */
const metal: Synth = (ctx, out, at, gain) => {
  const partials = [1, 2.76, 5.4, 8.93];
  const base = 680;
  partials.forEach((ratio, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = base * ratio;
    const env = ctx.createGain();
    const amp = gain * (1 / (i * 1.5 + 1.8));
    const life = 1.5 - i * 0.24;
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(amp, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + life);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + life + 0.05);
  });
};

/** 宣纸翻动：高通噪声的双脉冲 */
const paper: Synth = (ctx, out, at, gain) => {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1400;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.linearRampToValueAtTime(gain * 0.55, at + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
  env.gain.setValueAtTime(0.0001, at + 0.16);
  env.gain.linearRampToValueAtTime(gain * 0.3, at + 0.18);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
  src.connect(hp).connect(env).connect(out);
  src.start(at);
  src.stop(at + 0.34);
};

const SYNTHS: Record<Exclude<SoundName, "silk">, Synth> = { jade, wood, metal, paper };

export class TerminalAudio {
  private context?: AudioContext;
  private soundBus?: GainNode;
  private silkGain?: GainNode;
  private silkSource?: AudioBufferSourceNode;
  private prefs: AudioPreferences = { ...DEFAULT_AUDIO_PREFS };
  private unlocked = false;
  /** 同一帧里最多发三次声，避免快速输入时叠成噪声 */
  private recent = 0;

  configure(prefs: Partial<AudioPreferences>) {
    this.prefs = { ...this.prefs, ...prefs };
    if (this.soundBus && this.context) {
      this.soundBus.gain.setTargetAtTime(
        this.prefs.soundOn ? this.prefs.soundVolume : 0,
        this.context.currentTime,
        0.02,
      );
    }
  }

  get preferences(): AudioPreferences {
    return { ...this.prefs };
  }

  get isReady() {
    return this.unlocked && this.context?.state === "running";
  }

  /** 首次用户手势时解锁；未解锁前的播放请求直接丢弃，不排队补播 */
  async unlock(): Promise<boolean> {
    if (this.unlocked) return true;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.25; // 留出余量，避免叠加削波
      master.connect(ctx.destination);
      const soundBus = ctx.createGain();
      soundBus.gain.value = this.prefs.soundOn ? this.prefs.soundVolume : 0;
      soundBus.connect(master);
      this.context = ctx;
      this.soundBus = soundBus;
      await ctx.resume();
      this.unlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  play(name: SoundName, variant = 0) {
    if (!this.context || !this.soundBus || !this.prefs.soundOn) return;
    if (name === "silk") {
      this.startSilk();
      return;
    }
    const now = performance.now();
    if (now - this.recent < 24) return;
    this.recent = now;
    const at = this.context.currentTime;
    const gain = name === "metal" ? 0.5 : 0.42;
    SYNTHS[name](this.context, this.soundBus, at, gain * (1 - variant * 0.15));
  }

  /** 拭纹扫掠起止：由场景的 reveal 进度驱动 */
  setSilk(active: boolean, intensity = 0) {
    if (!active) {
      this.stopSilk();
      return;
    }
    this.startSilk();
    if (this.silkGain && this.context) {
      this.silkGain.gain.setTargetAtTime(
        Math.min(0.5, intensity) * 0.35,
        this.context.currentTime,
        0.06,
      );
    }
  }

  /** 拭纹扫掠：回路噪声持续发声，增益由 reveal 进度推动 */
  private startSilk() {
    if (!this.context || !this.soundBus || this.silkSource) return;
    const ctx = this.context;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1600;
    band.Q.value = 0.7;

    const env = ctx.createGain();
    env.gain.value = 0.0001;

    src.connect(band).connect(env).connect(this.soundBus);
    src.start();

    this.silkSource = src;
    this.silkGain = env;
  }

  private stopSilk() {
    if (!this.silkSource) return;
    try {
      this.silkSource.stop();
    } catch {
      /* 已停止 */
    }
    this.silkSource = undefined;
    this.silkGain = undefined;
  }

  dispose() {
    this.stopSilk();
    void this.context?.close();
    this.context = undefined;
    this.unlocked = false;
  }
}

/** 离线渲染一个音效并返回峰值、时长与 RMS —— 用于无人值守的波形验证 */
export async function renderProbe(
  name: Exclude<SoundName, "silk">,
  seconds = 2,
): Promise<{ peak: number; duration: number; rms: number }> {
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Ctor) return { peak: 0, duration: 0, rms: 0 };
  const ctx = new Ctor(1, Math.floor(44100 * seconds), 44100);
  SYNTHS[name](ctx, ctx.destination, 0, 0.8);
  const buffer = await ctx.startRendering();
  const data = buffer.getChannelData(0);
  let peak = 0;
  let sum = 0;
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    const value = Math.abs(data[i]);
    if (value > peak) peak = value;
    sum += data[i] * data[i];
    if (value > 0.001) last = i;
  }
  return {
    peak: Number(peak.toFixed(4)),
    duration: Number((last / 44100).toFixed(3)),
    rms: Number(Math.sqrt(sum / data.length).toFixed(4)),
  };
}
