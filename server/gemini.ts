import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { MEDIA_DIR } from './db.ts';

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured. Please check Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface GeneratedAdBlueprint {
  title: string;
  aspectRatio: '9:16' | '16:9';
  recommendedMusicTrackId: string;
  recommendedVoice: string;
  recommendedVoiceStyle: string;
  voiceoverScript: string;
  ctaText: string;
  ctaUrl: string;
  socialCaption: string;
  hashtags: string;
  scenes: Array<{
    headline: string;
    subtitle: string;
    visualPrompt: string;
    motion: 'zoom-in' | 'pan-right' | 'zoom-out' | 'pan-left';
  }>;
}

export async function generateAdBlueprintFromSource(params: {
  sourceType: 'website' | 'github' | 'manual';
  sourceLabel: string;
  sourceContent: string;
  brandName: string;
  industry: string;
  aspectRatio: '9:16' | '16:9';
  goal?: string;
}): Promise<GeneratedAdBlueprint> {
  const ai = getAiClient();

  const prompt = `Create a high-converting 15-second social media video advertisement blueprint for "${params.brandName}" (${params.industry}).
Source Type: ${params.sourceType}
Source Reference: ${params.sourceLabel}
Campaign Goal: ${params.goal || 'Product launch awareness and high click-through conversions'}
Target Aspect Ratio: ${params.aspectRatio}

Extracted Product / Repository Information:
${params.sourceContent.slice(0, 6000)}

Produce exactly 3 punchy 5-second scenes (Hook, Value Proof, Call to Action), a cohesive 35-48 word spoken commercial voiceover script timed for 15 seconds, a concise CTA button label, a short display URL, and a platform-ready social caption + hashtags.
Choose recommendedMusicTrackId strictly from: "midnight-synth", "lofi-creator", "minimal-tech", "velvet-groove", "kinetic-pop".
Choose recommendedVoice strictly from: "Kore", "Puck", "Charon", "Fenrir", "Zephyr".
Choose scene motion strictly from: "zoom-in", "pan-right", "zoom-out", "pan-left".`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are an award-winning commercial film director and performance marketing copywriter. Write sharp, concrete, authentic product advertising copy with zero clichés or buzzword fluff.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          aspectRatio: { type: Type.STRING },
          recommendedMusicTrackId: { type: Type.STRING },
          recommendedVoice: { type: Type.STRING },
          recommendedVoiceStyle: { type: Type.STRING },
          voiceoverScript: { type: Type.STRING },
          ctaText: { type: Type.STRING },
          ctaUrl: { type: Type.STRING },
          socialCaption: { type: Type.STRING },
          hashtags: { type: Type.STRING },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                headline: { type: Type.STRING },
                subtitle: { type: Type.STRING },
                visualPrompt: { type: Type.STRING },
                motion: { type: Type.STRING },
              },
              required: ['headline', 'subtitle', 'visualPrompt', 'motion'],
            },
          },
        },
        required: [
          'title',
          'recommendedMusicTrackId',
          'recommendedVoice',
          'recommendedVoiceStyle',
          'voiceoverScript',
          'ctaText',
          'ctaUrl',
          'socialCaption',
          'hashtags',
          'scenes',
        ],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  const parsed = JSON.parse(rawText) as GeneratedAdBlueprint;

  const validTracks = new Set(['midnight-synth', 'lofi-creator', 'minimal-tech', 'velvet-groove', 'kinetic-pop']);
  const validVoices = new Set(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr']);
  const validMotions = new Set(['zoom-in', 'pan-right', 'zoom-out', 'pan-left']);

  return {
    ...parsed,
    aspectRatio: params.aspectRatio,
    recommendedMusicTrackId: validTracks.has(parsed.recommendedMusicTrackId) ? parsed.recommendedMusicTrackId : 'midnight-synth',
    recommendedVoice: validVoices.has(parsed.recommendedVoice) ? parsed.recommendedVoice : 'Kore',
    scenes: (parsed.scenes || []).slice(0, 3).map((s) => ({
      headline: s.headline || params.brandName,
      subtitle: s.subtitle || '',
      visualPrompt: s.visualPrompt || '',
      motion: validMotions.has(s.motion) ? s.motion : 'zoom-in',
    })),
  };
}

export async function generateVoiceoverWav(params: {
  script: string;
  voiceName: string;
  style: string;
  dualSpeaker?: boolean;
  secondaryVoiceName?: string;
}): Promise<{ audioUrl: string; filename: string; modelUsed: string }> {
  const ai = getAiClient();
  const allowedVoices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
  const primaryVoice = allowedVoices.includes(params.voiceName) ? params.voiceName : 'Kore';
  const secondaryVoice = allowedVoices.includes(params.secondaryVoiceName || '') ? params.secondaryVoiceName! : 'Puck';

  let base64Audio: string | undefined;
  let modelUsed = 'gemini-3.8-flash-lite-tts';

  if (params.dualSpeaker) {
    modelUsed = 'gemini-3.8-flash-tts';
    const lines = params.script
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    const firstHalf = lines.length > 1 ? lines.slice(0, Math.ceil(lines.length / 2)).join(' ') : params.script;
    const secondHalf = lines.length > 1 ? lines.slice(Math.ceil(lines.length / 2)).join(' ') : 'Try it today and see the difference.';

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `HostA: ${firstHalf}`,
              speechMetadata: {
                speaker: 'HostA',
                style: params.style || 'Confident, engaging brand narrator',
              },
            },
            {
              text: `HostB: ${secondHalf}`,
              speechMetadata: {
                speaker: 'HostB',
                style: 'Warm, enthusiastic co-presenter',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speaker: 'HostA', voiceConfig: { prebuiltVoiceConfig: { voiceName: primaryVoice } } },
              { speaker: 'HostB', voiceConfig: { prebuiltVoiceConfig: { voiceName: secondaryVoice } } },
            ],
          },
        },
      },
    });
    base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } else {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: params.script,
              speechMetadata: {
                style: params.style || 'Clear, modern commercial voiceover',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: primaryVoice },
          },
        },
      },
    });
    base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  }

  if (!base64Audio) {
    throw new Error('Gemini TTS did not return audio data. Please try again with a shorter commercial script.');
  }

  // Unary Gemini 3.8 TTS returns a complete RIFF WAV buffer (audio/wav, 24kHz mono 16-bit)
  const wavBuffer = Buffer.from(base64Audio, 'base64');
  const filename = `vo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`;
  fs.writeFileSync(path.join(MEDIA_DIR, filename), wavBuffer);

  return {
    audioUrl: `/media/${filename}`,
    filename,
    modelUsed,
  };
}

export async function generateOmniVideoClip(params: {
  prompt: string;
  aspectRatio: '16:9' | '9:16';
  durationSec?: number;
  previousInteractionId?: string | null;
}): Promise<{ videoUrl: string; interactionId: string }> {
  const ai = getAiClient();
  const clampedDuration = Math.min(10, Math.max(4, Math.round(params.durationSec || 6)));

  const interactionParams: Record<string, unknown> = {
    model: 'gemini-omni-1.2-flash',
    input: params.prompt,
    background: false,
    store: true,
    stream: false,
    response_format: {
      type: 'video',
      aspect_ratio: params.aspectRatio,
      duration: `${clampedDuration}s`,
      resolution: '720p',
    },
  };

  if (params.previousInteractionId) {
    interactionParams.previous_interaction_id = params.previousInteractionId;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const interaction = await (ai.interactions.create as any)(interactionParams, { timeout: 300000 });
  const videoPart = interaction?.output_video;
  if (!videoPart?.data) {
    throw new Error('Video generation completed without returning video bytes.');
  }

  const videoBuffer = Buffer.from(videoPart.data, 'base64');
  const filename = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`;
  fs.writeFileSync(path.join(MEDIA_DIR, filename), videoBuffer);

  return {
    videoUrl: `/media/${filename}`,
    interactionId: interaction.id || '',
  };
}

export async function generateLyriaMusicClip(prompt: string): Promise<{ audioUrl: string; lyrics: string }> {
  const ai = getAiClient();

  const response = await ai.models.generateContentStream({
    model: 'lyria-3-clip-preview',
    contents: prompt,
  });

  const audioChunks: Buffer[] = [];
  let lyrics = '';
  let mimeType = 'audio/mpeg';

  for await (const chunk of response) {
    const parts = chunk.candidates?.[0]?.content?.parts;
    if (!parts) continue;
    for (const part of parts) {
      if (part.inlineData?.data) {
        if (audioChunks.length === 0 && part.inlineData.mimeType) {
          mimeType = part.inlineData.mimeType;
        }
        audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
      }
      if (part.text) {
        lyrics += part.text;
      }
    }
  }

  if (audioChunks.length === 0) {
    throw new Error('Lyria did not return audio chunks.');
  }

  const ext = mimeType.includes('wav') ? 'wav' : 'mp3';
  const filename = `music_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, filename), Buffer.concat(audioChunks));

  return {
    audioUrl: `/media/${filename}`,
    lyrics: lyrics.trim(),
  };
}

export async function generateMonthlyReportNarrative(params: {
  clientName: string;
  industry: string;
  periodLabel: string;
  metricsSummary: Record<string, unknown>;
}): Promise<{ summaryMarkdown: string; highlights: string[]; recommendations: string[] }> {
  const ai = getAiClient();

  const prompt = `Write an executive monthly client performance review for "${params.clientName}" (${params.industry}) covering ${params.periodLabel}.
Grounded Campaign Telemetry:
${JSON.stringify(params.metricsSummary, null, 2)}

Return:
1. summaryMarkdown: A crisp, board-ready 2-3 sentence executive summary citing the actual numbers.
2. highlights: Exactly 3 concise bullet highlights citing specific platforms and metrics.
3. recommendations: Exactly 3 actionable creative & channel optimization steps for next month.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are a VP of Performance Marketing writing monthly agency client reviews. Be quantitative, concise, and strictly grounded in the provided data.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summaryMarkdown: { type: Type.STRING },
          highlights: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          recommendations: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['summaryMarkdown', 'highlights', 'recommendations'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    summaryMarkdown: string;
    highlights: string[];
    recommendations: string[];
  };

  return {
    summaryMarkdown: parsed.summaryMarkdown || 'Performance summary generated from active channels.',
    highlights: parsed.highlights || [],
    recommendations: parsed.recommendations || [],
  };
}

export function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return {
      status: 429,
      message:
        'Gemini quota exceeded or model requires a billing-enabled API key. Check Settings > Secrets to attach a paid key, or continue using the Cinema Motion Engine & Studio Music Library.',
    };
  }
  if (lower.includes('permission_denied') || lower.includes('403') || lower.includes('api_key_invalid')) {
    return {
      status: 403,
      message:
        'API key lacks access to this model. Verify your GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  return { status: 500, message: raw };
}
