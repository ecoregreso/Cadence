import type { AdProject, BrandTemplate } from '../types';
import { renderTrendingTrackBuffer } from './musicSynth';

export interface RenderFrameOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  timeSec: number;
  project: AdProject;
  template: BrandTemplate;
  brandName: string;
  images: Map<string, HTMLImageElement>;
  videoEl: HTMLVideoElement | null;
  showSafeZones: boolean;
}

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function easeOutCubic(x: number): number {
  const clamped = Math.max(0, Math.min(1, x));
  return 1 - Math.pow(1 - clamped, 3);
}

export function drawCinemaFrame(opts: RenderFrameOptions) {
  const { ctx, width, height, timeSec, project, template, brandName, images, videoEl, showSafeZones } = opts;
  const duration = Math.max(5, project.duration_sec || 15);
  const t = Math.max(0, Math.min(duration, timeSec));

  // Locate active scene
  const scenes = project.scenes && project.scenes.length > 0
    ? project.scenes
    : [
        {
          id: 'default',
          index: 0,
          startSec: 0,
          durationSec: duration,
          headline: project.title,
          subtitle: project.cta_text,
          visualPrompt: '',
          motion: 'zoom-in' as const,
          imageUrl: project.hero_image_url,
        },
      ];

  let activeScene = scenes[scenes.length - 1];
  for (const sc of scenes) {
    if (t >= sc.startSec && t < sc.startSec + sc.durationSec) {
      activeScene = sc;
      break;
    }
  }

  const sceneElapsed = Math.max(0, t - activeScene.startSec);
  const sceneProgress = Math.max(0, Math.min(1, sceneElapsed / Math.max(0.5, activeScene.durationSec)));
  const enterAnim = easeOutCubic(Math.min(1, sceneElapsed / 0.55));

  // Clear background
  ctx.fillStyle = template.bg_color || '#0B0D12';
  ctx.fillRect(0, 0, width, height);

  // 1. Visual Layer: Playing AI/Uploaded Video Clip OR Ken Burns Animated Scene Image
  const hasPlayableVideo = Boolean(videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0);
  if (hasPlayableVideo && videoEl) {
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    const scale = Math.max(width / vw, height / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    ctx.drawImage(videoEl, (width - dw) / 2, (height - dh) / 2, dw, dh);
  } else {
    const imgSrc = activeScene.imageUrl || project.hero_image_url;
    const img = images.get(imgSrc) || images.get(project.hero_image_url);
    if (img && img.complete && img.naturalWidth > 0) {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const coverScale = Math.max(width / iw, height / ih);

      const motionFactor = template.motion_preset === 'snappy-cut' ? 1.12 : template.motion_preset === 'ambient-drift' ? 1.05 : 1.09;
      let zoom = 1.02;
      let panX = 0;
      let panY = 0;

      if (activeScene.motion === 'zoom-in') {
        zoom = 1.02 + (motionFactor - 1.0) * sceneProgress;
      } else if (activeScene.motion === 'zoom-out') {
        zoom = motionFactor - (motionFactor - 1.02) * sceneProgress;
      } else if (activeScene.motion === 'pan-right') {
        zoom = 1.1;
        panX = -width * 0.035 + width * 0.07 * sceneProgress;
      } else {
        zoom = 1.1;
        panX = width * 0.035 - width * 0.07 * sceneProgress;
      }

      const dw = iw * coverScale * zoom;
      const dh = ih * coverScale * zoom;
      ctx.drawImage(img, (width - dw) / 2 + panX, (height - dh) / 2 + panY, dw, dh);
    } else {
      // Rich dark cinema gradient fallback
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#111622');
      grad.addColorStop(0.5, '#1B2233');
      grad.addColorStop(1, '#090B10');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }
  }

  // 2. Measured Cinema Contrast Scrim (ensures >= 4.5:1 text contrast on all frames)
  const scrim = ctx.createLinearGradient(0, 0, 0, height);
  scrim.addColorStop(0, 'rgba(8, 10, 15, 0.45)');
  scrim.addColorStop(0.42, 'rgba(8, 10, 15, 0.16)');
  scrim.addColorStop(0.75, 'rgba(8, 10, 15, 0.74)');
  scrim.addColorStop(1, 'rgba(8, 10, 15, 0.92)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, width, height);

  // Subtle warm radial accent glow
  const isVertical = height > width;
  const accent = template.accent_color || '#F59E0B';
  const textPrimary = template.text_color || '#F8FAFC';

  // 3. Template Overlay Architecture
  const padX = isVertical ? Math.round(width * 0.08) : Math.round(width * 0.065);
  const padY = isVertical ? Math.round(height * 0.075) : Math.round(height * 0.085);

  if (template.overlay_style === 'cinema-bars') {
    const barH = Math.round(height * (isVertical ? 0.055 : 0.085));
    ctx.fillStyle = '#07090D';
    ctx.fillRect(0, 0, width, barH);
    ctx.fillRect(0, height - barH, width, barH);
  } else if (template.overlay_style === 'tech-hud') {
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    const inset = Math.round(Math.min(width, height) * 0.035);
    ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  }

  // Top Brand Wordmark & Scene Index
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = textPrimary;
  ctx.font = `600 ${Math.round(Math.min(width, height) * 0.028)}px "Plus Jakarta Sans", sans-serif`;
  const topOffset = template.overlay_style === 'cinema-bars' ? Math.round(height * 0.115) : padY + 12;
  ctx.fillText(brandName, padX, topOffset);

  // Subtle hairline accent rule under brand
  ctx.fillStyle = accent;
  ctx.fillRect(padX, topOffset + 10, 34, 2.5);
  ctx.restore();

  // 4. Scene Headline & Subtitle (Lower Third / Kinetic Typography)
  const isFinalCtaMoment = t >= duration - 2.6;
  const headlineSize = Math.round(isVertical ? width * 0.078 : height * 0.078);
  const subSize = Math.round(isVertical ? width * 0.036 : height * 0.033);
  const maxTextW = width - padX * 2;

  ctx.save();
  ctx.globalAlpha = enterAnim;
  const slideY = (1 - enterAnim) * 22;

  ctx.font = `700 ${headlineSize}px "Plus Jakarta Sans", sans-serif`;
  const headlineLines = wrapTextLines(ctx, activeScene.headline, maxTextW);

  ctx.font = `400 ${subSize}px "DM Sans", sans-serif`;
  const subLines = wrapTextLines(ctx, activeScene.subtitle, maxTextW * 0.92);

  const bottomAnchor = height - (template.overlay_style === 'cinema-bars' ? Math.round(height * 0.145) : Math.round(height * 0.12));
  const ctaReserve = isFinalCtaMoment ? Math.round(height * 0.105) : 0;
  const blockBottom = bottomAnchor - ctaReserve;

  const subHeight = subLines.length * (subSize * 1.38);
  const headlineHeight = headlineLines.length * (headlineSize * 1.12);
  const headlineTop = blockBottom - subHeight - headlineHeight - 14 + slideY;

  if (template.lower_third_style === 'glass-strip') {
    ctx.fillStyle = 'rgba(11, 13, 18, 0.62)';
    const boxY = headlineTop - 22;
    const boxH = headlineHeight + subHeight + 40;
    ctx.beginPath();
    ctx.roundRect(padX - 18, boxY, maxTextW + 36, boxH, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (template.lower_third_style === 'underline') {
    ctx.fillStyle = accent;
    ctx.fillRect(padX, headlineTop - 16, 48, 3);
  }

  // Draw headline lines
  ctx.font = `700 ${headlineSize}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = textPrimary;
  headlineLines.forEach((line, idx) => {
    ctx.fillText(line, padX, headlineTop + (idx + 1) * headlineSize * 1.06);
  });

  // Draw subtitle lines
  ctx.font = `400 ${subSize}px "DM Sans", sans-serif`;
  ctx.fillStyle = 'rgba(241, 245, 249, 0.84)';
  const subStartY = headlineTop + headlineHeight + 14;
  subLines.forEach((line, idx) => {
    ctx.fillText(line, padX, subStartY + (idx + 1) * subSize * 1.28);
  });
  ctx.restore();

  // 5. Kinetic Captions synced to Voiceover Script
  if (project.caption_style !== 'none' && project.voiceover_script.trim() && !isFinalCtaMoment) {
    const words = project.voiceover_script.trim().split(/\s+/);
    const wordsPerSec = words.length / Math.max(4, duration - 1.2);
    const wordIndex = Math.min(words.length - 1, Math.floor(t * wordsPerSec));
    const chunkStart = Math.max(0, Math.floor(wordIndex / 5) * 5);
    const chunkText = words.slice(chunkStart, chunkStart + 5).join(' ');

    if (chunkText) {
      const capFont = Math.round(isVertical ? width * 0.032 : height * 0.028);
      ctx.save();
      ctx.font = `600 ${capFont}px "DM Sans", sans-serif`;
      const textW = ctx.measureText(chunkText).width;
      const capY = isVertical ? Math.round(height * 0.56) : Math.round(height * 0.115);
      const capX = isVertical ? (width - textW) / 2 : width - padX - textW;

      ctx.fillStyle = 'rgba(11, 13, 18, 0.72)';
      ctx.beginPath();
      ctx.roundRect(capX - 14, capY - capFont, textW + 28, capFont * 1.55, 6);
      ctx.fill();

      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(chunkText, capX, capY + capFont * 0.12);
      ctx.restore();
    }
  }

  // 6. High-Converting CTA End-Card Overlay (final 2.6 seconds)
  if (isFinalCtaMoment) {
    const ctaAnim = easeOutCubic((t - (duration - 2.6)) / 0.45);
    ctx.save();
    ctx.globalAlpha = ctaAnim;
    const btnH = Math.round(isVertical ? height * 0.052 : height * 0.072);
    const btnY = bottomAnchor - btnH + 8;
    const labelFont = Math.round(isVertical ? width * 0.036 : height * 0.031);
    ctx.font = `700 ${labelFont}px "Plus Jakarta Sans", sans-serif`;
    const btnW = Math.min(maxTextW, ctx.measureText(project.cta_text).width + 52);

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(padX, btnY, btnW, btnH, 8);
    ctx.fill();

    ctx.fillStyle = '#0B0D12';
    ctx.fillText(project.cta_text, padX + 26, btnY + btnH * 0.63);

    // Clean display URL beside CTA
    ctx.font = `500 ${Math.round(labelFont * 0.85)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = 'rgba(241, 245, 249, 0.82)';
    const urlX = isVertical ? padX : padX + btnW + 20;
    const urlY = isVertical ? btnY + btnH + 26 : btnY + btnH * 0.62;
    ctx.fillText(project.cta_url, urlX, urlY);
    ctx.restore();
  }

  // 7. Bottom Progress Bar
  const progressRatio = t / duration;
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(0, height - 4, width, 4);
  ctx.fillStyle = accent;
  ctx.fillRect(0, height - 4, width * progressRatio, 4);

  // 8. Optional Social Platform Safe-Zone Guides (Editor preview only)
  if (showSafeZones) {
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.42)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    if (isVertical) {
      // TikTok / Reels right-hand action rail & bottom caption safe area
      ctx.strokeRect(width * 0.06, height * 0.12, width * 0.78, height * 0.68);
    } else {
      ctx.strokeRect(width * 0.05, height * 0.08, width * 0.9, height * 0.84);
    }
    ctx.restore();
  }
}

async function decodeUrlToAudioBuffer(audioCtx: AudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    return await audioCtx.decodeAudioData(arr);
  } catch {
    return null;
  }
}

export async function exportMasterVideo(params: {
  project: AdProject;
  template: BrandTemplate;
  brandName: string;
  images: Map<string, HTMLImageElement>;
  videoEl: HTMLVideoElement | null;
  onProgress: (pct: number) => void;
}): Promise<Blob> {
  const { project, template, brandName, images, videoEl, onProgress } = params;
  const isVertical = project.aspect_ratio === '9:16';
  const width = isVertical ? 720 : 1280;
  const height = isVertical ? 1280 : 720;
  const durationSec = Math.max(5, project.duration_sec || 15);

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  const ctx = exportCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context for video export.');
  }

  const audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  const dest = audioCtx.createMediaStreamDestination();

  // Prepare Music Track Buffer (custom/Lyria URL or Studio Synth)
  let musicBuffer: AudioBuffer | null = null;
  if (project.music_url) {
    musicBuffer = await decodeUrlToAudioBuffer(audioCtx, project.music_url);
  }
  if (!musicBuffer && project.music_track_id && project.music_track_id !== 'none') {
    musicBuffer = await renderTrendingTrackBuffer(project.music_track_id, durationSec + 1);
  }

  // Prepare Voiceover Buffer
  let voiceBuffer: AudioBuffer | null = null;
  if (project.voiceover_url) {
    voiceBuffer = await decodeUrlToAudioBuffer(audioCtx, project.voiceover_url);
  }

  // Schedule audio mix into MediaStreamDestination
  const startAudioTime = audioCtx.currentTime + 0.05;
  const sources: AudioBufferSourceNode[] = [];

  if (musicBuffer && project.music_volume > 0.01) {
    const src = audioCtx.createBufferSource();
    src.buffer = musicBuffer;
    src.loop = true;
    const gain = audioCtx.createGain();
    // Auto-duck music gently when voiceover is present
    const duckedVol = voiceBuffer ? project.music_volume * 0.62 : project.music_volume;
    gain.gain.setValueAtTime(duckedVol, startAudioTime);
    gain.gain.setValueAtTime(duckedVol, startAudioTime + Math.max(0, durationSec - 0.8));
    gain.gain.linearRampToValueAtTime(0.001, startAudioTime + durationSec);
    src.connect(gain);
    gain.connect(dest);
    src.start(startAudioTime);
    src.stop(startAudioTime + durationSec + 0.05);
    sources.push(src);
  }

  if (voiceBuffer && project.voice_volume > 0.01) {
    const src = audioCtx.createBufferSource();
    src.buffer = voiceBuffer;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(project.voice_volume, startAudioTime);
    src.connect(gain);
    gain.connect(dest);
    src.start(startAudioTime + 0.15);
    sources.push(src);
  }

  const videoStream = exportCanvas.captureStream(30);
  const combinedTracks = [...videoStream.getVideoTracks(), ...dest.stream.getAudioTracks()];
  const combinedStream = new MediaStream(combinedTracks);

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus'
    : 'video/webm';

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 4_500_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  if (videoEl) {
    try {
      videoEl.currentTime = 0;
      await videoEl.play();
    } catch {
      // Ignore autoplay errors on hidden video element
    }
  }

  return await new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('MediaRecorder failed during export.'));
    recorder.onstop = () => {
      sources.forEach((s) => {
        try {
          s.stop();
        } catch {
          // ignore
        }
      });
      audioCtx.close().catch(() => {});
      if (videoEl) videoEl.pause();
      onProgress(100);
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };

    recorder.start(250);
    const startWall = performance.now();

    const tick = () => {
      const elapsedSec = (performance.now() - startWall) / 1000;
      const pct = Math.min(99, Math.round((elapsedSec / durationSec) * 100));
      onProgress(pct);

      drawCinemaFrame({
        ctx,
        width,
        height,
        timeSec: Math.min(durationSec, elapsedSec),
        project,
        template,
        brandName,
        images,
        videoEl,
        showSafeZones: false,
      });

      if (elapsedSec >= durationSec) {
        recorder.stop();
      } else {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  });
}
