import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Film,
  FolderGit2,
  Globe,
  Grid2x2,
  Loader2,
  MessageSquare,
  Mic,
  Music,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';
import { api } from '../lib/api';
import { drawCinemaFrame, exportMasterVideo } from '../lib/cinemaRenderer';
import { renderTrendingTrackBuffer, TRENDING_TRACKS } from '../lib/musicSynth';
import type {
  AdProject,
  AdScene,
  BrandTemplate,
  ClientAccount,
  GitHubRepoSummary,
  ProjectStatus,
  ReviewComment,
  RoleDefinition,
} from '../types';

interface StudioViewProps {
  client: ClientAccount;
  projects: AdProject[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onProjectsChange: (projects: AdProject[]) => void;
  templates: BrandTemplate[];
  role: RoleDefinition;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'error') => void;
  onJumpToScheduler: (projectId: string) => void;
  openIngestSignal: number;
}

const VOICE_OPTIONS = [
  { id: 'Kore', label: 'Kore', tone: 'Warm & authoritative' },
  { id: 'Charon', label: 'Charon', tone: 'Deep cinema narrator' },
  { id: 'Puck', label: 'Puck', tone: 'Bright & conversational' },
  { id: 'Fenrir', label: 'Fenrir', tone: 'Crisp keynote energy' },
  { id: 'Zephyr', label: 'Zephyr', tone: 'Calm lifestyle studio' },
];

function formatTimecode(sec: number): string {
  const clamped = Math.max(0, sec);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const hundredths = Math.floor((clamped % 1) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export function StudioView({
  client,
  projects,
  selectedProjectId,
  onSelectProject,
  onProjectsChange,
  templates,
  role,
  onNotify,
  onJumpToScheduler,
  openIngestSignal,
}: StudioViewProps) {
  const project = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || projects[0] || null,
    [projects, selectedProjectId]
  );

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === project?.template_id) || templates[0],
    [templates, project?.template_id]
  );

  const [inspectorTab, setInspectorTab] = useState<'source' | 'scenes' | 'audio' | 'review'>('source');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [muteVoice, setMuteVoice] = useState(false);
  const [muteMusic, setMuteMusic] = useState(false);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // AI loading states
  const [voLoading, setVoLoading] = useState(false);
  const [dualSpeaker, setDualSpeaker] = useState(false);
  const [secondaryVoice, setSecondaryVoice] = useState('Puck');
  const [scriptLoading, setScriptLoading] = useState(false);
  const [videoGenLoading, setVideoGenLoading] = useState(false);
  const [musicGenLoading, setMusicGenLoading] = useState(false);
  const [omniPrompt, setOmniPrompt] = useState('');
  const [lyriaPrompt, setLyriaPrompt] = useState('');

  // Ingest modal state
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [ingestMode, setIngestMode] = useState<'website' | 'github'>('website');
  const [ingestUrl, setIngestUrl] = useState(client.website || '');
  const [ingestAspect, setIngestAspect] = useState<'9:16' | '16:9'>('9:16');
  const [ingestGoal, setIngestGoal] = useState('Launch announcement focused on product differentiation and conversion');
  const [ingestLoading, setIngestLoading] = useState(false);

  // GitHub browser state
  const [ghUser, setGhUser] = useState(client.github_org || 'vercel');
  const [ghToken, setGhToken] = useState('');
  const [ghRepos, setGhRepos] = useState<GitHubRepoSummary[]>([]);
  const [ghLoading, setGhLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState('');

  // Comments state
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [newComment, setNewComment] = useState('');

  // Media refs for cinema canvas + synced audio
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const imagesMapRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeAudioNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const rafRef = useRef<number | null>(null);
  const playStartWallRef = useRef<number>(0);
  const playStartOffsetRef = useRef<number>(0);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  // Open ingest modal when top bar CTA triggers
  useEffect(() => {
    if (openIngestSignal > 0) {
      setIngestUrl(client.website || '');
      setGhUser(client.github_org || 'vercel');
      setShowIngestModal(true);
    }
  }, [openIngestSignal, client.website, client.github_org]);

  // Load review comments when project changes
  useEffect(() => {
    if (!project) return;
    setCurrentTime(0);
    setIsPlaying(false);
    setOmniPrompt(project.scenes?.[0]?.visualPrompt || `Cinematic commercial film for ${project.title}`);
    setLyriaPrompt(`15-second commercial background soundtrack for ${client.industry}, clean modern mix`);
    api
      .getComments(project.id)
      .then(setComments)
      .catch(() => setComments([]));
  }, [project?.id, client.industry]);

  // Preload project images into cache for crisp canvas rendering
  useEffect(() => {
    if (!project) return;
    const urls = new Set<string>([project.hero_image_url]);
    for (const sc of project.scenes || []) {
      if (sc.imageUrl) urls.add(sc.imageUrl);
    }
    urls.forEach((url) => {
      if (!url || imagesMapRef.current.has(url)) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imagesMapRef.current.set(url, img);
        renderSingleFrame(currentTime);
      };
      img.src = url;
    });
  }, [project]);

  const stopAudioPlayback = () => {
    activeAudioNodesRef.current.forEach((node) => {
      try {
        node.stop();
      } catch {
        // already stopped
      }
    });
    activeAudioNodesRef.current = [];
  };

  const startSyncedAudio = async (offsetSec: number) => {
    if (!project) return;
    stopAudioPlayback();

    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const duration = project.duration_sec || 15;
    const remaining = Math.max(0.1, duration - offsetSec);

    // 1. Play Voiceover WAV if available & unmuted
    if (project.voiceover_url && !muteVoice && project.voice_volume > 0.01) {
      try {
        const res = await fetch(project.voiceover_url);
        if (res.ok) {
          const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
          if (offsetSec < decoded.duration) {
            const src = ctx.createBufferSource();
            src.buffer = decoded;
            const gain = ctx.createGain();
            gain.gain.value = project.voice_volume;
            src.connect(gain);
            gain.connect(ctx.destination);
            src.start(ctx.currentTime, offsetSec);
            activeAudioNodesRef.current.push(src);
          }
        }
      } catch {
        // ignore decode error
      }
    }

    // 2. Play Music (Custom/Lyria URL or Built-in Studio Synth)
    if (!muteMusic && project.music_volume > 0.01 && (project.music_url || project.music_track_id !== 'none')) {
      try {
        let musicBuf: AudioBuffer | null = null;
        if (project.music_url) {
          const res = await fetch(project.music_url);
          if (res.ok) {
            musicBuf = await ctx.decodeAudioData(await res.arrayBuffer());
          }
        }
        if (!musicBuf && project.music_track_id && project.music_track_id !== 'none') {
          musicBuf = await renderTrendingTrackBuffer(project.music_track_id, duration + 1);
        }
        if (musicBuf) {
          const src = ctx.createBufferSource();
          src.buffer = musicBuf;
          src.loop = true;
          const gain = ctx.createGain();
          const duckFactor = project.voiceover_url && !muteVoice ? 0.62 : 1.0;
          gain.gain.value = project.music_volume * duckFactor;
          src.connect(gain);
          gain.connect(ctx.destination);
          src.start(ctx.currentTime, offsetSec % musicBuf.duration, remaining);
          activeAudioNodesRef.current.push(src);
        }
      } catch {
        // ignore music error
      }
    }
  };

  const renderSingleFrame = (t: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !project || !activeTemplate) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawCinemaFrame({
      ctx,
      width: canvas.width,
      height: canvas.height,
      timeSec: t,
      project,
      template: activeTemplate,
      brandName: client.name,
      images: imagesMapRef.current,
      videoEl: project.video_clip_url ? videoElRef.current : null,
      showSafeZones,
    });
  };

  // Re-render frame whenever project properties or playhead change while paused
  useEffect(() => {
    if (!isPlaying) {
      renderSingleFrame(currentTime);
    }
  }, [project, activeTemplate, currentTime, showSafeZones, isPlaying, client.name]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying || !project) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopAudioPlayback();
      if (videoElRef.current) videoElRef.current.pause();
      return;
    }

    const duration = project.duration_sec || 15;
    playStartWallRef.current = performance.now();
    playStartOffsetRef.current = currentTime >= duration - 0.1 ? 0 : currentTime;

    if (videoElRef.current && project.video_clip_url) {
      videoElRef.current.currentTime = playStartOffsetRef.current % Math.max(1, videoElRef.current.duration || duration);
      videoElRef.current.play().catch(() => {});
    }

    startSyncedAudio(playStartOffsetRef.current);

    const loop = () => {
      const elapsed = (performance.now() - playStartWallRef.current) / 1000;
      const nextT = playStartOffsetRef.current + elapsed;
      if (nextT >= duration) {
        setCurrentTime(duration);
        renderSingleFrame(duration);
        setIsPlaying(false);
        stopAudioPlayback();
        return;
      }
      setCurrentTime(nextT);
      renderSingleFrame(nextT);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopAudioPlayback();
    };
  }, [isPlaying, project?.id]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      stopAudioPlayback();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const updateProjectField = async (patch: Partial<AdProject>, silent = false) => {
    if (!project) return;
    try {
      const updated = await api.updateProject(project.id, patch);
      onProjectsChange(projects.map((p) => (p.id === updated.id ? updated : p)));
      if (!silent) onNotify('Saved timeline changes.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save project.', 'error');
    }
  };

  const handleSceneChange = (sceneIdx: number, field: keyof AdScene, value: string) => {
    if (!project) return;
    const nextScenes = project.scenes.map((sc, idx) =>
      idx === sceneIdx ? { ...sc, [field]: value } : sc
    );
    // Optimistically update UI immediately, persist cleanly
    onProjectsChange(projects.map((p) => (p.id === project.id ? { ...p, scenes: nextScenes } : p)));
  };

  const persistScenes = () => {
    if (!project) return;
    updateProjectField({ scenes: project.scenes }, true);
  };

  const handleGenerateVoiceover = async () => {
    if (!project) return;
    setVoLoading(true);
    try {
      const res = await api.generateVoiceover({
        projectId: project.id,
        script: project.voiceover_script,
        voiceName: project.voiceover_voice,
        style: project.voiceover_style,
        dualSpeaker,
        secondaryVoiceName: secondaryVoice,
      });
      onProjectsChange(
        projects.map((p) => (p.id === project.id ? { ...p, voiceover_url: res.audioUrl } : p))
      );
      onNotify(`AI voiceover rendered with ${project.voiceover_voice} (${res.modelUsed}).`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Voiceover generation failed.', 'error');
    } finally {
      setVoLoading(false);
    }
  };

  const handleRegenerateScript = async () => {
    if (!project) return;
    setScriptLoading(true);
    try {
      const updated = await api.regenerateScript({
        projectId: project.id,
        brief: `${project.title}. ${project.voiceover_script}`,
        aspectRatio: project.aspect_ratio,
      });
      onProjectsChange(projects.map((p) => (p.id === updated.id ? updated : p)));
      onNotify('Generated fresh 3-scene storyboard and commercial script.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Script generation failed.', 'error');
    } finally {
      setScriptLoading(false);
    }
  };

  const handleGenerateOmniVideo = async (extendExisting = false) => {
    if (!project) return;
    setVideoGenLoading(true);
    try {
      const res = await api.generateOmniVideo({
        projectId: project.id,
        prompt: omniPrompt || project.scenes[0]?.visualPrompt || project.title,
        aspectRatio: project.aspect_ratio,
        durationSec: 6,
        previousInteractionId: extendExisting ? project.video_interaction_id : null,
      });
      onProjectsChange(
        projects.map((p) =>
          p.id === project.id
            ? { ...p, video_clip_url: res.videoUrl, video_interaction_id: res.interactionId }
            : p
        )
      );
      onNotify(extendExisting ? 'Extended AI video scene via Omni Flash.' : 'Generated AI video clip via Omni Flash.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'AI video generation failed.', 'error');
    } finally {
      setVideoGenLoading(false);
    }
  };

  const handleGenerateLyriaMusic = async () => {
    if (!project) return;
    setMusicGenLoading(true);
    try {
      const res = await api.generateLyriaMusic({
        projectId: project.id,
        prompt: lyriaPrompt,
      });
      onProjectsChange(
        projects.map((p) => (p.id === project.id ? { ...p, music_url: res.audioUrl } : p))
      );
      onNotify('Generated custom Lyria background soundtrack.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lyria music generation failed.', 'error');
    } finally {
      setMusicGenLoading(false);
    }
  };

  const handleMediaFileUpload = (kind: 'image' | 'video' | 'audio', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result);
        const { mediaUrl } = await api.uploadProjectMedia(project.id, kind, dataUrl);
        if (kind === 'video') {
          onProjectsChange(projects.map((p) => (p.id === project.id ? { ...p, video_clip_url: mediaUrl } : p)));
        } else if (kind === 'audio') {
          onProjectsChange(projects.map((p) => (p.id === project.id ? { ...p, music_url: mediaUrl } : p)));
        } else {
          const updatedScenes = project.scenes.map((sc) => ({ ...sc, imageUrl: mediaUrl }));
          await updateProjectField({ hero_image_url: mediaUrl, scenes: updatedScenes }, true);
        }
        onNotify(`Uploaded custom ${kind} asset to timeline.`, 'success');
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Media upload failed.', 'error');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleExportMaster = async () => {
    if (!project || !activeTemplate) return;
    setIsPlaying(false);
    setIsExporting(true);
    setExportProgress(2);
    try {
      const blob = await exportMasterVideo({
        project,
        template: activeTemplate,
        brandName: client.name,
        images: imagesMapRef.current,
        videoEl: project.video_clip_url ? videoElRef.current : null,
        onProgress: setExportProgress,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      a.href = url;
      a.download = `${safeName}-${project.aspect_ratio.replace(':', 'x')}-master.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      onNotify(`Exported HD master video (${(blob.size / (1024 * 1024)).toFixed(1)} MB WebM).`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Master video export failed.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleLoadGitHubRepos = async () => {
    if (!ghUser.trim()) return;
    setGhLoading(true);
    try {
      const repos = await api.fetchGitHubRepos(ghUser.trim(), ghToken || undefined);
      setGhRepos(repos);
      if (repos[0]) setSelectedRepo(repos[0].full_name);
      onNotify(`Loaded ${repos.length} repositories from github.com/${ghUser.trim()}.`, 'info');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to fetch GitHub repositories.', 'error');
    } finally {
      setGhLoading(false);
    }
  };

  const handleIngestSubmit = async () => {
    setIngestLoading(true);
    try {
      if (ingestMode === 'website') {
        const res = await api.ingestWebsite({
          url: ingestUrl,
          clientId: client.id,
          aspectRatio: ingestAspect,
          goal: ingestGoal,
        });
        onProjectsChange([res.project, ...projects]);
        onSelectProject(res.project.id);
        setShowIngestModal(false);
        onNotify(`Scraped "${res.scrapedSummary.title}" and generated a 3-scene video ad.`, 'success');
      } else {
        const targetRepo = selectedRepo.trim() || `${ghUser.trim()}`;
        const res = await api.ingestGitHubRepo(
          {
            ownerRepo: targetRepo,
            clientId: client.id,
            aspectRatio: ingestAspect,
            goal: ingestGoal,
          },
          ghToken || undefined
        );
        onProjectsChange([res.project, ...projects]);
        onSelectProject(res.project.id);
        setShowIngestModal(false);
        onNotify(`Ingested ${res.repoSummary.full_name} and built a launch video ad.`, 'success');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Source ingestion failed.', 'error');
    } finally {
      setIngestLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!project || !newComment.trim()) return;
    try {
      const created = await api.addComment(project.id, newComment.trim(), Number(currentTime.toFixed(1)));
      setComments([...comments, created].sort((a, b) => a.timecode_sec - b.timecode_sec));
      setNewComment('');
      onNotify(`Added review note at ${formatTimecode(created.timecode_sec)}.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to post comment.', 'error');
    }
  };

  const handleTimelineScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !project) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const nextSec = ratio * (project.duration_sec || 15);
    setCurrentTime(nextSec);
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      renderSingleFrame(nextSec);
    }
  };

  const canvasDims = project?.aspect_ratio === '9:16' ? { w: 450, h: 800 } : { w: 960, h: 540 };
  const duration = project?.duration_sec || 15;
  const playheadPct = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Hidden video decoder element for AI/uploaded video clips */}
      {project?.video_clip_url && (
        <video
          ref={videoElRef}
          src={project.video_clip_url}
          crossOrigin="anonymous"
          muted
          loop
          playsInline
          className="hidden"
          onLoadedData={() => renderSingleFrame(currentTime)}
        />
      )}

      {/* Project Reel Strip */}
      <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-white/[0.08] bg-[#12161F]">
        <div className="flex items-center gap-2 overflow-x-auto min-w-0">
          {projects.map((p) => {
            const active = p.id === project?.id;
            return (
              <button
                key={p.id}
                onClick={() => onSelectProject(p.id)}
                className={`px-3.5 py-2 rounded-lg text-left transition-colors whitespace-nowrap shrink-0 border ${
                  active
                    ? 'bg-[#181D29] border-amber-500/50 text-slate-100'
                    : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                }`}
              >
                <div className="text-xs font-medium">{p.title}</div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                  {p.aspect_ratio} · {p.duration_sec}s · {p.status}
                </div>
              </button>
            );
          })}
          {projects.length === 0 && (
            <span className="text-sm text-slate-400">No video campaigns yet for {client.name}.</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowIngestModal(true)}
            disabled={!role.permissions.generateMedia}
            title={!role.permissions.generateMedia ? `Locked for ${role.label}` : 'Scrape website or GitHub repository'}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium bg-[#181D29] border border-white/[0.1] text-slate-200 hover:border-amber-500/40 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <Globe className="w-3.5 h-3.5 text-amber-400" />
            Import URL / GitHub
          </button>
          {project && (
            <button
              onClick={handleExportMaster}
              disabled={isExporting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {isExporting ? `Exporting ${exportProgress}%` : 'Export Master Video'}
            </button>
          )}
        </div>
      </div>

      {/* Main Split Workspace: Left 65% Cinema Monitor + Timeline, Right 35% Inspector */}
      {!project ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
          <Film className="w-10 h-10 text-slate-500 mb-4" />
          <h2 className="text-xl font-semibold text-slate-100 mb-2">Start your first automated video ad</h2>
          <p className="text-sm text-slate-400 max-w-md mb-6">
            Paste any product website URL or connect a GitHub repository to extract messaging, generate a storyboard, synthesize an AI voiceover, and export ready-to-post video masters.
          </p>
          <button
            onClick={() => setShowIngestModal(true)}
            disabled={!role.permissions.generateMedia}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40 transition-colors"
          >
            Import Website or GitHub Repo
          </button>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 min-h-0 overflow-hidden">
          {/* LEFT: Cinema Monitor + 4-Track Timeline */}
          <div className="xl:col-span-8 flex flex-col min-h-0 border-r border-white/[0.08] bg-[#0B0D12]">
            {/* Cinema Monitor Stage */}
            <div className="flex-1 flex flex-col items-center justify-center p-5 min-h-[340px] relative overflow-hidden">
              <div className="w-full flex items-center justify-between text-xs text-slate-400 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-slate-200 truncate">{project.title}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{project.aspect_ratio}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activeTemplate?.name || 'Custom Template'}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setShowSafeZones((s) => !s)}
                    className={`flex items-center gap-1.5 text-xs transition-colors whitespace-nowrap shrink-0 ${
                      showSafeZones ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Grid2x2 className="w-3.5 h-3.5" />
                    Safe Zones
                  </button>
                  <button
                    onClick={() => onJumpToScheduler(project.id)}
                    className="text-xs text-slate-300 hover:text-amber-400 transition-colors whitespace-nowrap shrink-0"
                  >
                    Queue to Scheduler
                  </button>
                </div>
              </div>

              <div className="flex-1 flex items-center justify-center w-full min-h-0">
                <div
                  className="relative rounded-lg overflow-hidden border border-white/[0.1] bg-black shadow-2xl flex items-center justify-center"
                  style={{
                    maxHeight: '100%',
                    maxWidth: '100%',
                    aspectRatio: project.aspect_ratio === '9:16' ? '9 / 16' : '16 / 9',
                    height: project.aspect_ratio === '9:16' ? '380px' : 'auto',
                    width: project.aspect_ratio === '9:16' ? 'auto' : '100%',
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    width={canvasDims.w}
                    height={canvasDims.h}
                    className="w-full h-full object-contain block"
                  />
                  {isExporting && (
                    <div className="absolute inset-0 bg-[#0B0D12]/85 flex flex-col items-center justify-center p-6 text-center">
                      <Loader2 className="w-8 h-8 text-amber-400 animate-spin mb-3" />
                      <div className="text-sm font-semibold text-white">Rendering HD Master Video</div>
                      <div className="text-xs text-slate-400 mt-1 font-mono tabular-nums">
                        Compositing 30fps Canvas + Voiceover + Ducked Audio · {exportProgress}%
                      </div>
                      <div className="w-56 h-1.5 bg-white/10 rounded-full overflow-hidden mt-3">
                        <div className="h-full bg-amber-500 transition-all duration-150" style={{ width: `${exportProgress}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Transport Controls */}
              <div className="w-full flex items-center justify-between pt-3 mt-2 border-t border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsPlaying((p) => !p)}
                    className="flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {isPlaying ? 'Pause' : 'Play Cut'}
                  </button>
                  <button
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentTime(0);
                      renderSingleFrame(0);
                    }}
                    className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                    title="Return to 00:00.00"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <span className="ml-2 font-mono text-xs tabular-nums text-slate-200">
                    {formatTimecode(currentTime)}{' '}
                    <span className="text-slate-500">/ {formatTimecode(duration)}</span>
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <button
                    onClick={() => setMuteVoice((m) => !m)}
                    className="flex items-center gap-1.5 hover:text-slate-200 transition-colors whitespace-nowrap shrink-0"
                  >
                    {muteVoice ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Mic className="w-3.5 h-3.5 text-emerald-400" />}
                    VO {project.voiceover_url ? 'WAV' : 'Script'}
                  </button>
                  <button
                    onClick={() => setMuteMusic((m) => !m)}
                    className="flex items-center gap-1.5 hover:text-slate-200 transition-colors whitespace-nowrap shrink-0"
                  >
                    {muteMusic ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-amber-400" />}
                    Music {Math.round(project.music_volume * 100)}%
                  </button>
                  {project.video_clip_url && (
                    <a
                      href={project.video_clip_url}
                      download={`${project.id}-raw.mp4`}
                      className="text-amber-400 hover:text-amber-300 transition-colors whitespace-nowrap shrink-0"
                    >
                      Download Raw MP4
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* 4-Track Cinema Timeline */}
            <div className="border-t border-white/[0.08] bg-[#12161F] px-5 py-4 shrink-0">
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2 font-mono tabular-nums">
                <span>TIMELINE · 30 FPS</span>
                <div className="flex items-center gap-6">
                  <span>00:00</span>
                  <span>00:05</span>
                  <span>00:10</span>
                  <span>00:{String(duration).padStart(2, '0')}</span>
                </div>
              </div>

              <div
                ref={timelineRef}
                onClick={handleTimelineScrub}
                className="relative space-y-1.5 cursor-pointer select-none"
              >
                {/* Playhead line */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-20 pointer-events-none"
                  style={{ left: `${playheadPct}%` }}
                >
                  <div className="w-2.5 h-2.5 bg-amber-400 rotate-45 -translate-x-1 -translate-y-1" />
                </div>

                {/* Track 1: Video / Visual Scenes */}
                <div className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-2 text-[11px] font-medium text-slate-400 truncate">V1 · Visuals</div>
                  <div className="col-span-10 h-9 bg-[#0B0D12] border border-white/[0.06] rounded flex overflow-hidden">
                    {project.scenes.map((sc, i) => (
                      <div
                        key={sc.id}
                        className={`flex-1 h-full px-2.5 flex items-center justify-between border-r border-white/[0.08] last:border-r-0 ${
                          i === 0
                            ? 'bg-slate-800/80'
                            : i === 1
                            ? 'bg-slate-800/60'
                            : 'bg-slate-800/45'
                        }`}
                      >
                        <span className="text-[11px] font-medium text-slate-200 truncate">
                          0{i + 1}. {sc.headline}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 ml-2 shrink-0">{sc.durationSec}s</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Track 2: Brand Overlays & Captions */}
                <div className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-2 text-[11px] font-medium text-slate-400 truncate">T1 · Brand Kit</div>
                  <div className="col-span-10 h-7 bg-[#0B0D12] border border-white/[0.06] rounded flex items-center px-2.5 gap-2">
                    <div
                      className="h-4 flex-1 rounded-sm flex items-center px-2 text-[10px] font-medium text-slate-200 truncate"
                      style={{ backgroundColor: `${activeTemplate?.accent_color || '#F59E0B'}28`, border: `1px solid ${activeTemplate?.accent_color || '#F59E0B'}55` }}
                    >
                      {activeTemplate?.name} · Captions: {project.caption_style}
                    </div>
                    <div className="h-4 w-28 rounded-sm bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-[10px] font-medium text-amber-300 shrink-0">
                      CTA End-Card
                    </div>
                  </div>
                </div>

                {/* Track 3: AI Voiceover */}
                <div className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-2 text-[11px] font-medium text-slate-400 truncate">A1 · Voiceover</div>
                  <div className="col-span-10 h-7 bg-[#0B0D12] border border-white/[0.06] rounded flex items-center px-2.5">
                    <div
                      className={`h-4 w-full rounded-sm flex items-center justify-between px-2 text-[10px] ${
                        project.voiceover_url
                          ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                          : 'bg-white/[0.04] border border-dashed border-white/[0.12] text-slate-400'
                      }`}
                    >
                      <span className="truncate">
                        {project.voiceover_url
                          ? `Gemini TTS Master (${project.voiceover_voice}) · Ready`
                          : 'Script drafted — click Generate AI Voiceover in Audio tab'}
                      </span>
                      <span className="font-mono tabular-nums ml-2 shrink-0">{Math.round(project.voice_volume * 100)}%</span>
                    </div>
                  </div>
                </div>

                {/* Track 4: Background Music + Comment Markers */}
                <div className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-2 text-[11px] font-medium text-slate-400 truncate">A2 · Music</div>
                  <div className="col-span-10 h-7 bg-[#0B0D12] border border-white/[0.06] rounded flex items-center px-2.5 relative">
                    <div className="h-4 w-full rounded-sm bg-sky-500/15 border border-sky-500/35 flex items-center justify-between px-2 text-[10px] text-sky-200">
                      <span className="truncate">
                        {project.music_url
                          ? 'Custom / Lyria AI Soundtrack'
                          : TRENDING_TRACKS.find((t) => t.id === project.music_track_id)?.title || 'No Music'}
                      </span>
                      <span className="font-mono tabular-nums ml-2 shrink-0">
                        Ducking {Math.round(project.music_volume * 100)}%
                      </span>
                    </div>
                    {/* Timestamped Review Comment Markers */}
                    {comments.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setCurrentTime(c.timecode_sec);
                          setInspectorTab('review');
                        }}
                        title={`${c.author_name} (${formatTimecode(c.timecode_sec)}): ${c.body}`}
                        className="absolute -top-1 w-2.5 h-2.5 rounded-full bg-amber-400 border border-[#0B0D12] z-10 hover:scale-125 transition-transform"
                        style={{ left: `${Math.min(97, (c.timecode_sec / duration) * 100)}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Contextual Inspector Panel */}
          <div className="xl:col-span-4 flex flex-col min-h-0 bg-[#12161F]">
            {/* Inspector Segmented Tabs */}
            <div className="grid grid-cols-4 border-b border-white/[0.08] px-2 pt-2 bg-[#0E121A]">
              {(
                [
                  { id: 'source', label: 'Script' },
                  { id: 'scenes', label: 'Visuals' },
                  { id: 'audio', label: 'Audio' },
                  { id: 'review', label: `Review (${comments.filter((c) => !c.resolved).length})` },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setInspectorTab(t.id)}
                  className={`py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    inspectorTab === t.id
                      ? 'border-amber-500 text-slate-100'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* TAB 1: SOURCE & SCRIPT */}
              {inspectorTab === 'source' && (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100">Campaign Metadata</h3>
                      <span className="text-xs text-slate-400">Source: {project.source_type}</span>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Ad Title</label>
                      <input
                        type="text"
                        value={project.title}
                        disabled={!role.permissions.editProjects}
                        onChange={(e) =>
                          onProjectsChange(projects.map((p) => (p.id === project.id ? { ...p, title: e.target.value } : p)))
                        }
                        onBlur={() => updateProjectField({ title: project.title }, true)}
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm text-slate-100 focus:outline-none focus:border-amber-500/60 disabled:opacity-50"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Aspect Ratio</label>
                        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#0B0D12] border border-white/[0.08]">
                          {(['9:16', '16:9'] as const).map((ar) => (
                            <button
                              key={ar}
                              disabled={!role.permissions.editProjects}
                              onClick={() => updateProjectField({ aspect_ratio: ar })}
                              className={`py-1.5 rounded text-xs font-mono transition-colors ${
                                project.aspect_ratio === ar
                                  ? 'bg-[#181D29] text-amber-400 font-semibold'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {ar}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Caption Style</label>
                        <select
                          value={project.caption_style}
                          disabled={!role.permissions.editProjects}
                          onChange={(e) =>
                            updateProjectField({ caption_style: e.target.value as AdProject['caption_style'] })
                          }
                          className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-200 focus:outline-none focus:border-amber-500/60"
                        >
                          <option value="kinetic">Kinetic Sync</option>
                          <option value="minimal">Minimal Strip</option>
                          <option value="broadcast">Broadcast Bar</option>
                          <option value="none">No Captions</option>
                        </select>
                      </div>
                    </div>

                    {project.source_url && (
                      <div className="text-xs text-slate-400 truncate">
                        Ingested from <span className="text-slate-300 font-mono">{project.source_url}</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-white/[0.08] pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100">3-Scene Storyboard</h3>
                      <button
                        onClick={handleRegenerateScript}
                        disabled={scriptLoading || !role.permissions.generateMedia}
                        className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 disabled:opacity-40 whitespace-nowrap shrink-0"
                      >
                        {scriptLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        Rewrite with AI
                      </button>
                    </div>

                    {project.scenes.map((sc, idx) => (
                      <div key={sc.id} className="p-3 rounded-lg bg-[#0B0D12] border border-white/[0.07] space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                          <span>Scene 0{idx + 1} · {sc.startSec}s–{sc.startSec + sc.durationSec}s</span>
                          <select
                            value={sc.motion}
                            disabled={!role.permissions.editProjects}
                            onChange={(e) => {
                              handleSceneChange(idx, 'motion', e.target.value);
                              setTimeout(persistScenes, 50);
                            }}
                            className="bg-transparent text-slate-300 focus:outline-none text-[11px]"
                          >
                            <option value="zoom-in">Camera Push-In</option>
                            <option value="pan-right">Pan Right</option>
                            <option value="zoom-out">Pull Back</option>
                            <option value="pan-left">Pan Left</option>
                          </select>
                        </div>
                        <input
                          type="text"
                          value={sc.headline}
                          disabled={!role.permissions.editProjects}
                          onChange={(e) => handleSceneChange(idx, 'headline', e.target.value)}
                          onBlur={persistScenes}
                          placeholder="Scene headline"
                          className="w-full px-2.5 py-1.5 rounded bg-[#12161F] border border-white/[0.08] text-xs font-medium text-slate-100 focus:outline-none focus:border-amber-500/50"
                        />
                        <input
                          type="text"
                          value={sc.subtitle}
                          disabled={!role.permissions.editProjects}
                          onChange={(e) => handleSceneChange(idx, 'subtitle', e.target.value)}
                          onBlur={persistScenes}
                          placeholder="Supporting copy"
                          className="w-full px-2.5 py-1.5 rounded bg-[#12161F] border border-white/[0.08] text-xs text-slate-300 focus:outline-none focus:border-amber-500/50"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-white/[0.08] pt-4 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-100">End-Card Call to Action</h3>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">CTA Button</label>
                        <input
                          type="text"
                          value={project.cta_text}
                          disabled={!role.permissions.editProjects}
                          onChange={(e) =>
                            onProjectsChange(projects.map((p) => (p.id === project.id ? { ...p, cta_text: e.target.value } : p)))
                          }
                          onBlur={() => updateProjectField({ cta_text: project.cta_text }, true)}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Display URL</label>
                        <input
                          type="text"
                          value={project.cta_url}
                          disabled={!role.permissions.editProjects}
                          onChange={(e) =>
                            onProjectsChange(projects.map((p) => (p.id === project.id ? { ...p, cta_url: e.target.value } : p)))
                          }
                          onBlur={() => updateProjectField({ cta_url: project.cta_url }, true)}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs font-mono text-slate-200"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* TAB 2: BRAND TEMPLATE & VISUAL SCENES */}
              {inspectorTab === 'scenes' && (
                <>
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-100">Brand Aesthetic Template</h3>
                    <div className="space-y-2">
                      {templates.map((tpl) => {
                        const isSelected = tpl.id === project.template_id;
                        return (
                          <button
                            key={tpl.id}
                            disabled={!role.permissions.editProjects}
                            onClick={() => updateProjectField({ template_id: tpl.id })}
                            className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                              isSelected
                                ? 'bg-[#181D29] border-amber-500/60'
                                : 'bg-[#0B0D12] border-white/[0.07] hover:border-white/[0.16]'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span
                                className="w-4 h-4 rounded-sm shrink-0 border border-white/20"
                                style={{ backgroundColor: tpl.accent_color }}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-slate-100 truncate">{tpl.name}</div>
                                <div className="text-[11px] text-slate-400 truncate">
                                  {tpl.category} · {tpl.overlay_style}
                                </div>
                              </div>
                            </div>
                            {isSelected && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border-t border-white/[0.08] pt-4 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-100">Custom Visual Assets</h3>
                    <p className="text-xs text-slate-400">
                      Upload brand photography or raw MP4/WebM product footage to composite inside the Cinema Monitor.
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#0B0D12] border border-white/[0.1] hover:border-amber-500/50 text-xs font-medium text-slate-200 cursor-pointer transition-colors">
                        <Upload className="w-3.5 h-3.5 text-amber-400" />
                        Upload Scene Photo
                        <input
                          type="file"
                          accept="image/*"
                          disabled={!role.permissions.editProjects}
                          onChange={(e) => handleMediaFileUpload('image', e)}
                          className="hidden"
                        />
                      </label>
                      <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#0B0D12] border border-white/[0.1] hover:border-amber-500/50 text-xs font-medium text-slate-200 cursor-pointer transition-colors">
                        <Film className="w-3.5 h-3.5 text-amber-400" />
                        Upload Video Clip
                        <input
                          type="file"
                          accept="video/*"
                          disabled={!role.permissions.editProjects}
                          onChange={(e) => handleMediaFileUpload('video', e)}
                          className="hidden"
                        />
                      </label>
                    </div>
                    {project.video_clip_url && (
                      <div className="flex items-center justify-between text-xs text-slate-300 bg-[#0B0D12] px-3 py-2 rounded-lg border border-white/[0.08]">
                        <span className="truncate">Active video clip attached</span>
                        <button
                          disabled={!role.permissions.editProjects}
                          onClick={() => updateProjectField({ video_clip_url: null, video_interaction_id: null })}
                          className="text-rose-400 hover:text-rose-300 ml-2 shrink-0"
                        >
                          Clear
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-white/[0.08] pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100">Generative AI Video Clip</h3>
                      <span className="text-[11px] text-slate-400">Omni Flash · Paid Key</span>
                    </div>
                    <textarea
                      rows={3}
                      value={omniPrompt}
                      onChange={(e) => setOmniPrompt(e.target.value)}
                      disabled={!role.permissions.generateMedia}
                      placeholder="Describe the 6-second commercial camera shot..."
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-200 focus:outline-none focus:border-amber-500/60"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleGenerateOmniVideo(false)}
                        disabled={videoGenLoading || !role.permissions.generateMedia}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#181D29] border border-white/[0.12] hover:border-amber-500/50 text-xs font-medium text-slate-100 disabled:opacity-40 transition-colors"
                      >
                        {videoGenLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 text-amber-400" />}
                        {videoGenLoading ? 'Rendering Clip...' : 'Generate AI Clip'}
                      </button>
                      {project.video_interaction_id && (
                        <button
                          onClick={() => handleGenerateOmniVideo(true)}
                          disabled={videoGenLoading || !role.permissions.generateMedia}
                          className="px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-200 hover:border-amber-500/50 disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          Edit / Extend
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* TAB 3: AI VOICEOVER & TRENDING MUSIC */}
              {inspectorTab === 'audio' && (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100">AI Voiceover Studio</h3>
                      <span className="text-[11px] text-emerald-400">Gemini 3.8 TTS</span>
                    </div>

                    <textarea
                      rows={4}
                      value={project.voiceover_script}
                      disabled={!role.permissions.editProjects}
                      onChange={(e) =>
                        onProjectsChange(
                          projects.map((p) => (p.id === project.id ? { ...p, voiceover_script: e.target.value } : p))
                        )
                      }
                      onBlur={() => updateProjectField({ voiceover_script: project.voiceover_script }, true)}
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-amber-500/60"
                    />

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Voice Persona</label>
                        <select
                          value={project.voiceover_voice}
                          disabled={!role.permissions.editProjects}
                          onChange={(e) => updateProjectField({ voiceover_voice: e.target.value }, true)}
                          className="w-full px-2.5 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100"
                        >
                          {VOICE_OPTIONS.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label} — {v.tone}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Delivery Direction</label>
                        <input
                          type="text"
                          value={project.voiceover_style}
                          disabled={!role.permissions.editProjects}
                          onChange={(e) =>
                            onProjectsChange(
                              projects.map((p) => (p.id === project.id ? { ...p, voiceover_style: e.target.value } : p))
                            )
                          }
                          onBlur={() => updateProjectField({ voiceover_style: project.voiceover_style }, true)}
                          className="w-full px-2.5 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-200"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={dualSpeaker}
                          onChange={(e) => setDualSpeaker(e.target.checked)}
                          className="rounded bg-[#0B0D12] border-white/20 accent-amber-500"
                        />
                        Dual-speaker ad dialogue
                      </label>
                      {dualSpeaker && (
                        <select
                          value={secondaryVoice}
                          onChange={(e) => setSecondaryVoice(e.target.value)}
                          className="px-2 py-1 rounded bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-200"
                        >
                          {VOICE_OPTIONS.map((v) => (
                            <option key={v.id} value={v.id}>
                              Co-host: {v.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <button
                      onClick={handleGenerateVoiceover}
                      disabled={voLoading || !role.permissions.generateMedia}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-40 transition-colors"
                    >
                      {voLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
                      {voLoading ? 'Synthesizing Studio WAV...' : 'Generate AI Voiceover'}
                    </button>

                    {project.voiceover_url && (
                      <div className="p-2.5 rounded-lg bg-[#0B0D12] border border-emerald-500/30 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-emerald-300">
                          <span>Voiceover WAV Ready</span>
                          <a href={project.voiceover_url} download className="underline">
                            Download WAV
                          </a>
                        </div>
                        <audio controls src={project.voiceover_url} className="w-full h-8" />
                      </div>
                    )}
                  </div>

                  {/* Trending Background Music */}
                  <div className="border-t border-white/[0.08] pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100">Trending Background Music</h3>
                      <span className="text-[11px] text-slate-400">Auto-ducked under VO</span>
                    </div>

                    <div className="space-y-1.5">
                      {TRENDING_TRACKS.map((tr) => {
                        const selected = !project.music_url && project.music_track_id === tr.id;
                        return (
                          <button
                            key={tr.id}
                            disabled={!role.permissions.editProjects}
                            onClick={() => updateProjectField({ music_track_id: tr.id, music_url: null }, true)}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-colors ${
                              selected
                                ? 'bg-[#181D29] border-amber-500/60'
                                : 'bg-[#0B0D12] border-white/[0.06] hover:border-white/[0.15]'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-slate-100 truncate">{tr.title}</div>
                              <div className="text-[11px] text-slate-400 truncate">
                                {tr.mood} · <span className="font-mono tabular-nums">{tr.bpm} BPM</span>
                              </div>
                            </div>
                            {selected && <Music className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>

                    {/* Mix Levels */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <div className="flex justify-between text-[11px] text-slate-400 mb-1 font-mono tabular-nums">
                          <span>Voice Gain</span>
                          <span>{Math.round(project.voice_volume * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={project.voice_volume}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            onProjectsChange(projects.map((p) => (p.id === project.id ? { ...p, voice_volume: val } : p)));
                          }}
                          onMouseUp={() => updateProjectField({ voice_volume: project.voice_volume }, true)}
                          className="w-full accent-amber-500"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] text-slate-400 mb-1 font-mono tabular-nums">
                          <span>Music Bed</span>
                          <span>{Math.round(project.music_volume * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.02}
                          value={project.music_volume}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            onProjectsChange(projects.map((p) => (p.id === project.id ? { ...p, music_volume: val } : p)));
                          }}
                          onMouseUp={() => updateProjectField({ music_volume: project.music_volume }, true)}
                          className="w-full accent-amber-500"
                        />
                      </div>
                    </div>

                    {/* Custom Audio Upload + Optional Lyria AI Music */}
                    <div className="pt-2 space-y-2">
                      <label className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] hover:border-amber-500/40 text-xs text-slate-200 cursor-pointer transition-colors">
                        <Upload className="w-3.5 h-3.5 text-amber-400" />
                        Upload Custom MP3 / WAV Track
                        <input
                          type="file"
                          accept="audio/*"
                          disabled={!role.permissions.editProjects}
                          onChange={(e) => handleMediaFileUpload('audio', e)}
                          className="hidden"
                        />
                      </label>

                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={lyriaPrompt}
                          onChange={(e) => setLyriaPrompt(e.target.value)}
                          placeholder="Lyria AI music prompt..."
                          className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#0B0D12] border border-white/[0.08] text-xs text-slate-200"
                        />
                        <button
                          onClick={handleGenerateLyriaMusic}
                          disabled={musicGenLoading || !role.permissions.generateMedia}
                          className="px-3 py-1.5 rounded-lg bg-[#181D29] border border-white/[0.12] hover:border-amber-500/50 text-xs text-slate-200 disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          {musicGenLoading ? 'Generating...' : 'Lyria AI'}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* TAB 4: TEAM COLLABORATION & APPROVAL WORKFLOW */}
              {inspectorTab === 'review' && (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100">Approval Workflow</h3>
                      <span className="text-xs text-amber-400 font-medium">{project.status}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      {(['Draft', 'In Review', 'Approved'] as ProjectStatus[]).map((st) => {
                        const active = project.status === st;
                        const disabled =
                          st === 'Approved' ? !role.permissions.approveProjects : !role.permissions.editProjects && !role.permissions.approveProjects;
                        return (
                          <button
                            key={st}
                            disabled={disabled}
                            onClick={() => updateProjectField({ status: st })}
                            className={`py-2 px-2 rounded-lg text-xs font-medium border transition-colors ${
                              active
                                ? 'bg-amber-500 text-slate-950 border-amber-500 font-semibold'
                                : 'bg-[#0B0D12] border-white/[0.08] text-slate-300 hover:border-white/[0.2] disabled:opacity-40'
                            }`}
                          >
                            {st}
                          </button>
                        );
                      })}
                    </div>

                    {!role.permissions.approveProjects && (
                      <p className="text-[11px] text-slate-400">
                        Tip: Switch to <span className="text-slate-200">Client Reviewer</span> or <span className="text-slate-200">Agency Admin</span> in the sidebar to test final approval sign-off.
                      </p>
                    )}
                  </div>

                  <div className="border-t border-white/[0.08] pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100">Timestamped Notes</h3>
                      <span className="text-[11px] font-mono tabular-nums text-slate-400">
                        At {formatTimecode(currentTime)}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newComment}
                        disabled={!role.permissions.comment}
                        onChange={(e) => setNewComment(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                        placeholder={
                          role.permissions.comment
                            ? `Leave note at ${formatTimecode(currentTime)}...`
                            : `Commenting disabled for ${role.label}`
                        }
                        className="flex-1 px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100 focus:outline-none focus:border-amber-500/60 disabled:opacity-40"
                      />
                      <button
                        onClick={handleAddComment}
                        disabled={!role.permissions.comment || !newComment.trim()}
                        className="px-3 py-2 rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40 transition-colors"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-2">
                      {comments.map((c) => (
                        <div
                          key={c.id}
                          className={`p-3 rounded-lg border transition-colors ${
                            c.resolved
                              ? 'bg-[#0B0D12]/60 border-white/[0.05] opacity-65'
                              : 'bg-[#0B0D12] border-white/[0.09]'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] mb-1.5">
                            <div className="text-slate-300 font-medium">
                              {c.author_name} <span className="text-slate-500 font-normal">· {c.author_role}</span>
                            </div>
                            <button
                              onClick={() => {
                                setCurrentTime(c.timecode_sec);
                                renderSingleFrame(c.timecode_sec);
                              }}
                              className="font-mono tabular-nums text-amber-400 hover:underline"
                            >
                              {formatTimecode(c.timecode_sec)}
                            </button>
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed">{c.body}</p>
                          <div className="mt-2 flex justify-end">
                            <button
                              disabled={!role.permissions.comment}
                              onClick={async () => {
                                const updated = await api.toggleCommentResolved(c.id, !c.resolved);
                                setComments(comments.map((item) => (item.id === c.id ? updated : item)));
                              }}
                              className="text-[11px] text-slate-400 hover:text-emerald-400 disabled:opacity-40"
                            >
                              {c.resolved ? 'Reopen note' : 'Mark resolved'}
                            </button>
                          </div>
                        </div>
                      ))}
                      {comments.length === 0 && (
                        <div className="text-xs text-slate-500 py-4 text-center">
                          <MessageSquare className="w-5 h-5 mx-auto mb-1.5 opacity-50" />
                          No review notes yet. Scrub the timeline and drop a frame note.
                        </div>
                      )}
                    </div>
                  </div>

                  {role.permissions.editProjects && (
                    <div className="border-t border-white/[0.08] pt-4 flex justify-end">
                      <button
                        onClick={async () => {
                          await api.deleteProject(project.id);
                          const next = projects.filter((p) => p.id !== project.id);
                          onProjectsChange(next);
                          if (next[0]) onSelectProject(next[0].id);
                          onNotify('Deleted ad project.', 'info');
                        }}
                        className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete Ad Project
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* LIVE WEBSITE & GITHUB REPO INGESTION MODAL */}
      {showIngestModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl bg-[#12161F] border border-white/[0.12] overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08]">
              <div>
                <h2 className="text-base font-semibold text-slate-100">Auto-Generate Ad from Live Source</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Scrape any public product website or connect a GitHub repository to generate a 3-scene video ad for {client.name}.
                </p>
              </div>
              <button
                onClick={() => setShowIngestModal(false)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1"
              >
                Close
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Source Switch */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-[#0B0D12] border border-white/[0.08]">
                <button
                  onClick={() => setIngestMode('website')}
                  className={`flex items-center justify-center gap-2 py-2 rounded-md text-xs font-medium transition-colors ${
                    ingestMode === 'website' ? 'bg-[#181D29] text-amber-400' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  Scrape Product Website
                </button>
                <button
                  onClick={() => setIngestMode('github')}
                  className={`flex items-center justify-center gap-2 py-2 rounded-md text-xs font-medium transition-colors ${
                    ingestMode === 'github' ? 'bg-[#181D29] text-amber-400' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FolderGit2 className="w-3.5 h-3.5" />
                  Connect GitHub Repository
                </button>
              </div>

              {ingestMode === 'website' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1.5">Product or Landing Page URL</label>
                    <input
                      type="url"
                      value={ingestUrl}
                      onChange={(e) => setIngestUrl(e.target.value)}
                      placeholder="https://linear.app or https://stripe.com"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm text-slate-100 focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-5">
                      <label className="block text-xs text-slate-300 mb-1">GitHub Username / Org</label>
                      <input
                        type="text"
                        value={ghUser}
                        onChange={(e) => setGhUser(e.target.value)}
                        placeholder="vercel"
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100"
                      />
                    </div>
                    <div className="col-span-4">
                      <label className="block text-xs text-slate-300 mb-1">Optional Token (Private Repos)</label>
                      <input
                        type="password"
                        value={ghToken}
                        onChange={(e) => setGhToken(e.target.value)}
                        placeholder="ghp_..."
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100"
                      />
                    </div>
                    <div className="col-span-3 flex items-end">
                      <button
                        onClick={handleLoadGitHubRepos}
                        disabled={ghLoading}
                        className="w-full py-2 px-3 rounded-lg bg-[#181D29] border border-white/[0.12] hover:border-amber-500/50 text-xs font-medium text-slate-100"
                      >
                        {ghLoading ? 'Loading...' : 'Fetch Repos'}
                      </button>
                    </div>
                  </div>

                  {ghRepos.length > 0 ? (
                    <div className="max-h-40 overflow-y-auto divide-y divide-white/[0.06] rounded-lg border border-white/[0.08] bg-[#0B0D12]">
                      {ghRepos.map((repo) => (
                        <button
                          key={repo.id}
                          onClick={() => setSelectedRepo(repo.full_name)}
                          className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between transition-colors ${
                            selectedRepo === repo.full_name ? 'bg-amber-500/10 text-amber-200' : 'hover:bg-white/[0.03] text-slate-300'
                          }`}
                        >
                          <div className="min-w-0 pr-3">
                            <div className="text-xs font-medium truncate">{repo.full_name}</div>
                            <div className="text-[11px] text-slate-500 truncate">{repo.description || 'No description'}</div>
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                            {repo.language || 'Code'} · {repo.stargazers_count.toLocaleString()} ★
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs text-slate-300 mb-1">Or Enter Direct Repository (owner/repo)</label>
                      <input
                        type="text"
                        value={selectedRepo}
                        onChange={(e) => setSelectedRepo(e.target.value)}
                        placeholder="vercel/next.js"
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs font-mono text-slate-100"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">
                  <label className="block text-xs text-slate-300 mb-1.5">Target Format</label>
                  <select
                    value={ingestAspect}
                    onChange={(e) => setIngestAspect(e.target.value as '9:16' | '16:9')}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100"
                  >
                    <option value="9:16">9:16 Vertical (TikTok / Reels / Shorts)</option>
                    <option value="16:9">16:9 Widescreen (YouTube / LinkedIn)</option>
                  </select>
                </div>
                <div className="col-span-8">
                  <label className="block text-xs text-slate-300 mb-1.5">Campaign Objective</label>
                  <input
                    type="text"
                    value={ingestGoal}
                    onChange={(e) => setIngestGoal(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/[0.08] bg-[#0E121A]">
              <button
                onClick={() => setShowIngestModal(false)}
                className="px-4 py-2 rounded-lg text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleIngestSubmit}
                disabled={ingestLoading || (ingestMode === 'website' ? !ingestUrl.trim() : !selectedRepo.trim())}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-40 transition-colors"
              >
                {ingestLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {ingestLoading ? 'Extracting & Directing Ad...' : 'Generate Video Ad'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
