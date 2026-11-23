export interface TrendingTrack {
  id: string;
  title: string;
  mood: string;
  bpm: number;
  tag: string;
  rootMidi: number;
  chords: number[][];
  bassPattern: number[];
  style: 'synth' | 'lofi' | 'tech' | 'acoustic' | 'pop';
}

export const TRENDING_TRACKS: TrendingTrack[] = [
  {
    id: 'midnight-synth',
    title: 'Midnight Analog Drive',
    mood: 'Cinematic Hardware Reveal',
    bpm: 112,
    tag: 'Trending · Hardware & Auto',
    rootMidi: 45, // A2
    chords: [
      [57, 60, 64, 67],
      [53, 57, 60, 64],
      [55, 59, 62, 67],
      [52, 55, 59, 64],
    ],
    bassPattern: [45, 45, 48, 45, 41, 41, 43, 40],
    style: 'synth',
  },
  {
    id: 'minimal-tech',
    title: 'Pulse Architecture',
    mood: 'Modern SaaS & Dev Launch',
    bpm: 122,
    tag: 'Trending · SaaS & AI',
    rootMidi: 48, // C3
    chords: [
      [60, 63, 67, 70],
      [56, 60, 63, 67],
      [58, 62, 65, 70],
      [55, 58, 62, 67],
    ],
    bassPattern: [48, 48, 51, 48, 44, 44, 46, 43],
    style: 'tech',
  },
  {
    id: 'velvet-groove',
    title: 'Velvet Espresso Groove',
    mood: 'Warm Lifestyle & Culinary',
    bpm: 98,
    tag: 'Trending · Reels & DTC',
    rootMidi: 50, // D3
    chords: [
      [62, 65, 69, 72],
      [57, 60, 64, 67],
      [58, 62, 65, 69],
      [57, 61, 64, 69],
    ],
    bassPattern: [50, 50, 45, 45, 46, 46, 45, 45],
    style: 'acoustic',
  },
  {
    id: 'lofi-creator',
    title: 'Studio Tape Drift',
    mood: 'Founder Story & Creator Hook',
    bpm: 88,
    tag: 'Trending · TikTok Organic',
    rootMidi: 48,
    chords: [
      [60, 64, 67, 71],
      [57, 60, 64, 67],
      [53, 57, 60, 64],
      [55, 59, 62, 65],
    ],
    bassPattern: [48, 48, 45, 45, 41, 41, 43, 43],
    style: 'lofi',
  },
  {
    id: 'kinetic-pop',
    title: 'Kinetic Launch Hook',
    mood: 'High-Energy Performance Social',
    bpm: 126,
    tag: 'Trending · Viral Shorts',
    rootMidi: 52, // E3
    chords: [
      [64, 67, 71, 74],
      [60, 64, 67, 71],
      [62, 66, 69, 74],
      [59, 62, 66, 71],
    ],
    bassPattern: [52, 52, 55, 52, 48, 50, 47, 50],
    style: 'pop',
  },
];

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const bufferCache = new Map<string, AudioBuffer>();

/**
 * Renders a genuine musical multi-instrument stereo AudioBuffer (pad + pluck + bass + kick/hat groove)
 * via OfflineAudioContext so it can be scrubbed cleanly on the timeline and mixed directly into WebM exports.
 */
export async function renderTrendingTrackBuffer(trackId: string, durationSec = 16): Promise<AudioBuffer> {
  const cacheKey = `${trackId}_${durationSec}`;
  const cached = bufferCache.get(cacheKey);
  if (cached) return cached;

  const track = TRENDING_TRACKS.find((t) => t.id === trackId) || TRENDING_TRACKS[0];
  const sampleRate = 44100;
  const offline = new OfflineAudioContext(2, Math.ceil(sampleRate * durationSec), sampleRate);

  const master = offline.createGain();
  master.gain.value = 0.72;

  // Warm low-pass polish filter
  const masterFilter = offline.createBiquadFilter();
  masterFilter.type = 'lowpass';
  masterFilter.frequency.value = track.style === 'lofi' ? 2800 : track.style === 'acoustic' ? 4200 : 7500;
  master.connect(masterFilter);
  masterFilter.connect(offline.destination);

  const beatDur = 60 / track.bpm;
  const totalBeats = Math.ceil(durationSec / beatDur);

  // Create reusable noise buffer for hi-hats / snare brush
  const noiseBuf = offline.createBuffer(1, sampleRate * 0.2, sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = Math.random() * 2 - 1;
  }

  // 1. Warm harmonic pad chords (every 4 beats)
  for (let bar = 0; bar * 4 < totalBeats; bar++) {
    const startTime = bar * 4 * beatDur;
    const chordDur = 4 * beatDur;
    const chord = track.chords[bar % track.chords.length];

    for (const midi of chord) {
      const osc = offline.createOscillator();
      const gain = offline.createGain();
      osc.type = track.style === 'tech' || track.style === 'synth' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(midiToFreq(midi), startTime);
      osc.detune.setValueAtTime((Math.random() - 0.5) * 9, startTime);

      const padFilter = offline.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.setValueAtTime(track.style === 'lofi' ? 900 : 1650, startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(0.065, startTime + 0.18);
      gain.gain.setValueAtTime(0.055, Math.max(startTime + 0.2, startTime + chordDur - 0.25));
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + chordDur);

      osc.connect(padFilter);
      padFilter.connect(gain);
      gain.connect(master);
      osc.start(startTime);
      osc.stop(startTime + chordDur + 0.05);
    }
  }

  // 2. Rhythmic bass + melodic arpeggio + subtle drums
  for (let step = 0; step < totalBeats * 2; step++) {
    const t = step * (beatDur / 2);
    if (t >= durationSec) break;
    const barIdx = Math.floor(step / 8);
    const chord = track.chords[barIdx % track.chords.length];

    // Sub-bass on downbeats & syncopation
    if (step % 2 === 0 || (track.style === 'pop' && step % 4 === 3)) {
      const bassMidi = track.bassPattern[step % track.bassPattern.length];
      const osc = offline.createOscillator();
      const gain = offline.createGain();
      osc.type = track.style === 'acoustic' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(midiToFreq(bassMidi), t);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + beatDur * 0.85);

      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + beatDur * 0.9);
    }

    // Melodic commercial pluck
    if (
      (track.style === 'tech' && step % 1 === 0) ||
      (track.style === 'synth' && (step % 2 === 0 || step % 8 === 5)) ||
      (track.style === 'pop' && step % 2 === 1) ||
      (track.style === 'acoustic' && (step % 4 === 0 || step % 4 === 2 || step % 8 === 7)) ||
      (track.style === 'lofi' && step % 4 === 1)
    ) {
      const noteMidi = chord[step % chord.length] + 12;
      const osc = offline.createOscillator();
      const gain = offline.createGain();
      osc.type = track.style === 'tech' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(midiToFreq(noteMidi), t);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + beatDur * 0.6);

      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + beatDur * 0.65);
    }

    // Kick drum
    const isKick =
      step % 8 === 0 ||
      step % 8 === 4 ||
      (track.style === 'pop' && step % 8 === 6) ||
      (track.style === 'tech' && step % 2 === 0);
    if (isKick) {
      const osc = offline.createOscillator();
      const gain = offline.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(135, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);

      gain.gain.setValueAtTime(0.32, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + 0.18);
    }

    // Crisp hi-hat on off-beats
    if (step % 2 === 1) {
      const src = offline.createBufferSource();
      src.buffer = noiseBuf;
      const hp = offline.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6500;
      const gain = offline.createGain();
      gain.gain.setValueAtTime(0.045, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);

      src.connect(hp);
      hp.connect(gain);
      gain.connect(master);
      src.start(t);
      src.stop(t + 0.06);
    }
  }

  // Smooth fade-out on final 0.8s
  master.gain.setValueAtTime(0.72, Math.max(0, durationSec - 0.8));
  master.gain.linearRampToValueAtTime(0.001, durationSec);

  const rendered = await offline.startRendering();
  bufferCache.set(cacheKey, rendered);
  return rendered;
}
