import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { RoleDefinition, RoleKey } from '../src/types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

export const db = new Database(path.join(DATA_DIR, 'cadence.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const ROLE_DEFINITIONS: Record<RoleKey, RoleDefinition> = {
  admin: {
    key: 'admin',
    label: 'Agency Admin',
    shortLabel: 'Admin',
    description: 'Full access across client accounts, API integrations, AWS redundancy settings, billing telemetry, team roles, and publishing.',
    permissions: {
      editProjects: true,
      generateMedia: true,
      approveProjects: true,
      schedulePublish: true,
      manageIntegrations: true,
      manageClientsTeam: true,
      generateReports: true,
      viewAnalytics: true,
      comment: true,
    },
  },
  producer: {
    key: 'producer',
    label: 'Creative Producer',
    shortLabel: 'Producer',
    description: 'Creates video ads, scrapes websites and GitHub repos, generates AI voiceovers, customizes templates, and queues posts.',
    permissions: {
      editProjects: true,
      generateMedia: true,
      approveProjects: false,
      schedulePublish: true,
      manageIntegrations: false,
      manageClientsTeam: false,
      generateReports: true,
      viewAnalytics: true,
      comment: true,
    },
  },
  reviewer: {
    key: 'reviewer',
    label: 'Client Reviewer',
    shortLabel: 'Reviewer',
    description: 'Reviews video cuts on the timeline, leaves timestamped comments, approves creatives, and views monthly reports.',
    permissions: {
      editProjects: false,
      generateMedia: false,
      approveProjects: true,
      schedulePublish: false,
      manageIntegrations: false,
      manageClientsTeam: false,
      generateReports: false,
      viewAnalytics: true,
      comment: true,
    },
  },
  analyst: {
    key: 'analyst',
    label: 'Read-Only Analyst',
    shortLabel: 'Analyst',
    description: 'Monitors real-time cross-channel performance metrics and exports monthly client performance reports.',
    permissions: {
      editProjects: false,
      generateMedia: false,
      approveProjects: false,
      schedulePublish: false,
      manageIntegrations: false,
      manageClientsTeam: false,
      generateReports: true,
      viewAnalytics: true,
      comment: false,
    },
  },
};

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      industry TEXT NOT NULL,
      website TEXT DEFAULT '',
      github_org TEXT DEFAULT '',
      brand_primary TEXT DEFAULT '#0F172A',
      brand_accent TEXT DEFAULT '#F59E0B',
      font_style TEXT DEFAULT 'Plus Jakarta Sans',
      aws_region TEXT DEFAULT 'us-east-1',
      aws_s3_bucket TEXT DEFAULT '',
      aws_replication_mode TEXT DEFAULT 'Multi-AZ Active-Active',
      report_day_of_month INTEGER DEFAULT 1,
      report_recipients TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      bg_color TEXT NOT NULL,
      accent_color TEXT NOT NULL,
      text_color TEXT NOT NULL,
      font_display TEXT NOT NULL,
      overlay_style TEXT NOT NULL,
      motion_preset TEXT NOT NULL,
      lower_third_style TEXT NOT NULL,
      preview_image TEXT NOT NULL,
      is_system INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT DEFAULT '',
      aspect_ratio TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      status TEXT NOT NULL,
      template_id TEXT NOT NULL,
      scenes_json TEXT NOT NULL,
      voiceover_script TEXT NOT NULL,
      voiceover_voice TEXT DEFAULT 'Kore',
      voiceover_style TEXT DEFAULT 'Confident, modern commercial narrator',
      voiceover_url TEXT,
      music_track_id TEXT DEFAULT 'midnight-synth',
      music_url TEXT,
      music_volume REAL DEFAULT 0.28,
      voice_volume REAL DEFAULT 0.95,
      video_clip_url TEXT,
      video_interaction_id TEXT,
      hero_image_url TEXT NOT NULL,
      cta_text TEXT NOT NULL,
      cta_url TEXT NOT NULL,
      caption_style TEXT DEFAULT 'kinetic',
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      category TEXT NOT NULL,
      connected INTEGER DEFAULT 0,
      account_handle TEXT DEFAULT '',
      webhook_url TEXT DEFAULT '',
      auto_sync INTEGER DEFAULT 1,
      last_sync_at TEXT,
      followers_count INTEGER DEFAULT 0,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      caption TEXT NOT NULL,
      hashtags TEXT DEFAULT '',
      status TEXT NOT NULL,
      published_at TEXT,
      external_url TEXT,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS analytics_daily (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      project_id TEXT,
      platform TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      impressions INTEGER NOT NULL,
      views_3s INTEGER NOT NULL,
      completions INTEGER NOT NULL,
      clicks INTEGER NOT NULL,
      conversions INTEGER NOT NULL,
      spend REAL NOT NULL,
      revenue REAL NOT NULL,
      email_opens INTEGER DEFAULT 0,
      email_clicks INTEGER DEFAULT 0,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS review_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_role TEXT NOT NULL,
      timecode_sec REAL NOT NULL,
      body TEXT NOT NULL,
      resolved INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      client_access TEXT NOT NULL,
      last_active_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      period_label TEXT NOT NULL,
      summary_markdown TEXT NOT NULL,
      highlights_json TEXT NOT NULL,
      recommendations_json TEXT NOT NULL,
      metrics_snapshot_json TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const clientCount = (db.prepare('SELECT COUNT(*) as cnt FROM clients').get() as { cnt: number }).cnt;
  if (clientCount === 0) {
    seedInitialData();
  }
}

export function logAudit(actorRole: string, action: string, targetType: string, targetId: string, details: string) {
  db.prepare(`
    INSERT INTO audit_logs (id, actor_role, action, target_type, target_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    actorRole,
    action,
    targetType,
    targetId,
    details,
    new Date().toISOString()
  );
}

function seedInitialData() {
  const now = new Date().toISOString();

  // Generated visual asset paths (from Phase 1 batch generation)
  const IMG_HEADPHONES = '/src/assets/images/ad_audio_headphones_1795390924557.jpg';
  const IMG_DEVTOOLS = '/src/assets/images/ad_devtools_cloud_1795390925048.jpg';
  const IMG_ESPRESSO = '/src/assets/images/ad_espresso_roast_1795390924456.jpg';
  const IMG_WATCH = '/src/assets/images/ad_luxury_watch_1795390925192.jpg';
  const IMG_AVATAR = '/src/assets/images/avatar_producer_1795390925185.jpg';

  const insertClient = db.prepare(`
    INSERT INTO clients (id, name, industry, website, github_org, brand_primary, brand_accent, font_style, aws_region, aws_s3_bucket, aws_replication_mode, report_day_of_month, report_recipients, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertClient.run(
    'cli_aether',
    'Aether Acoustics',
    'Consumer Audio Hardware',
    'https://aetheracoustics.example.com',
    'aether-audio',
    '#0E1117',
    '#F59E0B',
    'Plus Jakarta Sans',
    'us-east-1',
    'aether-acoustics-ad-masters-prod',
    'Multi-AZ Active-Active (us-east-1 + eu-west-1)',
    1,
    'elena@aetheracoustics.io, growth@aetheracoustics.io',
    now
  );

  insertClient.run(
    'cli_kestrel',
    'Kestrel Labs',
    'Developer Infrastructure',
    'https://kestrellabs.dev',
    'vercel',
    '#090D16',
    '#38BDF8',
    'Plus Jakarta Sans',
    'us-west-2',
    'kestrel-labs-video-pipeline-prod',
    'Multi-AZ + CloudFront Edge',
    1,
    'devrel@kestrellabs.dev, vp-marketing@kestrellabs.dev',
    now
  );

  insertClient.run(
    'cli_solis',
    'Solis Roasters',
    'Specialty Coffee & DTC',
    'https://solisroasters.co',
    '',
    '#14100D',
    '#EA580C',
    'Plus Jakarta Sans',
    'eu-central-1',
    'solis-roasters-social-reels',
    'Multi-AZ Standard IA Archive',
    5,
    'founders@solisroasters.co',
    now
  );

  // Templates
  const insertTemplate = db.prepare(`
    INSERT INTO templates (id, client_id, name, category, aspect_ratio, bg_color, accent_color, text_color, font_display, overlay_style, motion_preset, lower_third_style, preview_image, is_system)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const templates = [
    ['tpl_cinema_reveal', null, 'Cinema Product Reveal', 'Hardware & Luxury', '16:9', '#0B0D12', '#F59E0B', '#F8FAFC', 'Plus Jakarta Sans', 'cinema-bars', 'slow-push', 'bar', IMG_HEADPHONES, 1],
    ['tpl_vertical_hook', null, 'Kinetic Vertical Reel', 'TikTok & Reels', '9:16', '#0E0B0A', '#EA580C', '#FFFBEB', 'Plus Jakarta Sans', 'kinetic-bold', 'snappy-cut', 'glass-strip', IMG_ESPRESSO, 1],
    ['tpl_dev_launch', null, 'GitHub Release Spotlight', 'SaaS & DevTools', '16:9', '#090D16', '#38BDF8', '#F1F5F9', 'Plus Jakarta Sans', 'tech-hud', 'slow-push', 'underline', IMG_DEVTOOLS, 1],
    ['tpl_minimal_luxury', null, 'Editorial Atelier', 'Watches & Fashion', '9:16', '#0C0C0E', '#D97706', '#F8FAFC', 'Plus Jakarta Sans', 'editorial-minimal', 'ambient-drift', 'underline', IMG_WATCH, 1],
    ['tpl_founder_story', null, 'Direct Response Story', 'Performance Social', '9:16', '#10141D', '#10B981', '#F8FAFC', 'Plus Jakarta Sans', 'kinetic-bold', 'snappy-cut', 'bar', IMG_HEADPHONES, 1],
  ];

  for (const t of templates) {
    insertTemplate.run(...t);
  }

  // Projects
  const insertProject = db.prepare(`
    INSERT INTO projects (id, client_id, title, source_type, source_url, aspect_ratio, duration_sec, status, template_id, scenes_json, voiceover_script, voiceover_voice, voiceover_style, voiceover_url, music_track_id, music_url, music_volume, voice_volume, video_clip_url, video_interaction_id, hero_image_url, cta_text, cta_url, caption_style, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertProject.run(
    'prj_aether_01',
    'cli_aether',
    'Aether One — Spatial Studio Launch Film',
    'website',
    'https://aetheracoustics.example.com/aether-one',
    '16:9',
    15,
    'In Review',
    'tpl_cinema_reveal',
    JSON.stringify([
      {
        id: 'sc_1',
        index: 0,
        startSec: 0,
        durationSec: 5,
        headline: 'Silence Every Distraction.',
        subtitle: 'Precision-milled planar drivers tuned for mastering rooms.',
        visualPrompt: 'Slow macro dolly across matte obsidian wireless studio headphones with brushed amber-brass yokes under dramatic rim light.',
        motion: 'zoom-in',
        imageUrl: IMG_HEADPHONES,
      },
      {
        id: 'sc_2',
        index: 1,
        startSec: 5,
        durationSec: 5,
        headline: '48-Hour Lossless Clarity.',
        subtitle: 'Adaptive studio ANC with zero phase distortion.',
        visualPrompt: 'Sweeping close-up highlighting soft acoustic leather earcups and subtle warm copper lighting on dark stone.',
        motion: 'pan-right',
        imageUrl: IMG_HEADPHONES,
      },
      {
        id: 'sc_3',
        index: 2,
        startSec: 10,
        durationSec: 5,
        headline: 'Hear What Was Recorded.',
        subtitle: 'Pre-order Aether One — Ships worldwide this Friday.',
        visualPrompt: 'Hero tabletop silhouette pull-out revealing the full studio headphones framed with clean cinema letterbox bars.',
        motion: 'zoom-out',
        imageUrl: IMG_HEADPHONES,
      },
    ]),
    'Silence every distraction. Meet Aether One—precision-milled planar headphones engineered for studio clarity anywhere you work. Forty-eight hours of lossless playback with zero phase distortion. Reserve yours today at aetheracoustics.com.',
    'Charon',
    'Deep, cinematic luxury commercial voiceover with poised pacing',
    null,
    'midnight-synth',
    null,
    0.26,
    0.95,
    null,
    null,
    IMG_HEADPHONES,
    'Reserve Aether One',
    'aetheracoustics.com/one',
    'kinetic',
    now,
    now
  );

  insertProject.run(
    'prj_aether_02',
    'cli_aether',
    'Aether Studio — 9:16 TikTok Teaser',
    'website',
    'https://aetheracoustics.example.com/aether-one',
    '9:16',
    12,
    'Approved',
    'tpl_minimal_luxury',
    JSON.stringify([
      {
        id: 'sc_a1',
        index: 0,
        startSec: 0,
        durationSec: 4,
        headline: 'Built For Ears That Notice.',
        subtitle: 'Reference sound in a 265g anodized frame.',
        visualPrompt: 'Vertical close-up of matte titanium industrial finish and acoustic precision details.',
        motion: 'zoom-in',
        imageUrl: IMG_WATCH,
      },
      {
        id: 'sc_a2',
        index: 1,
        startSec: 4,
        durationSec: 4,
        headline: 'Zero Plastic Resonance.',
        subtitle: 'CNC aluminum chamber tuned by mastering engineers.',
        visualPrompt: 'Slow vertical pan across studio headphones resting on dark stone.',
        motion: 'pan-left',
        imageUrl: IMG_HEADPHONES,
      },
      {
        id: 'sc_a3',
        index: 2,
        startSec: 8,
        durationSec: 4,
        headline: 'Experience Studio Reference.',
        subtitle: 'Limited Founder Batch open now.',
        visualPrompt: 'Dramatic backlit silhouette reveal.',
        motion: 'zoom-out',
        imageUrl: IMG_HEADPHONES,
      },
    ]),
    'Built for ears that notice every micro-detail. Zero plastic resonance. Pure studio reference wherever you create. Claim your Founder Edition today.',
    'Kore',
    'Crisp, modern, confident tech lifestyle narrator',
    null,
    'minimal-tech',
    null,
    0.3,
    0.95,
    null,
    null,
    IMG_WATCH,
    'Claim Founder Batch',
    'aetheracoustics.com/founder',
    'minimal',
    now,
    now
  );

  insertProject.run(
    'prj_kestrel_01',
    'cli_kestrel',
    'Kestrel Edge Runtime v3 — GitHub Launch',
    'github',
    'https://github.com/vercel/next.js',
    '16:9',
    15,
    'Scheduled',
    'tpl_dev_launch',
    JSON.stringify([
      {
        id: 'sc_k1',
        index: 0,
        startSec: 0,
        durationSec: 5,
        headline: 'Cold Starts Are History.',
        subtitle: 'Sub-8ms global edge execution directly from git push.',
        visualPrompt: 'Wide architectural glide down dark anodized server racks pulsing with refined warm amber light rails.',
        motion: 'zoom-in',
        imageUrl: IMG_DEVTOOLS,
      },
      {
        id: 'sc_k2',
        index: 1,
        startSec: 5,
        durationSec: 5,
        headline: 'Zero Config. Full Type Safety.',
        subtitle: 'Open-source runtime built for high-throughput TypeScript teams.',
        visualPrompt: 'Steady horizontal tracking shot across illuminated precision hardware modules.',
        motion: 'pan-right',
        imageUrl: IMG_DEVTOOLS,
      },
      {
        id: 'sc_k3',
        index: 2,
        startSec: 10,
        durationSec: 5,
        headline: 'Deploy In 4 Seconds.',
        subtitle: 'Star on GitHub and spin up your first edge worker free.',
        visualPrompt: 'Pull-back wide establishing shot of clean dark data center monolith.',
        motion: 'zoom-out',
        imageUrl: IMG_DEVTOOLS,
      },
    ]),
    'Cold starts are history. Kestrel Edge Runtime delivers sub-eight-millisecond execution straight from git push. Zero configuration, full TypeScript safety, and open source from day one. Try it free at kestrellabs.dev.',
    'Fenrir',
    'Sharp, energetic developer keynote voiceover',
    null,
    'minimal-tech',
    null,
    0.25,
    0.95,
    null,
    null,
    IMG_DEVTOOLS,
    'Star on GitHub',
    'github.com/kestrel-labs',
    'broadcast',
    now,
    now
  );

  insertProject.run(
    'prj_solis_01',
    'cli_solis',
    'Solis Single-Origin Crema — Reels Campaign',
    'website',
    'https://solisroasters.co/espresso-club',
    '9:16',
    15,
    'Published',
    'tpl_vertical_hook',
    JSON.stringify([
      {
        id: 'sc_s1',
        index: 0,
        startSec: 0,
        durationSec: 5,
        headline: 'Roasted Yesterday. Poured Today.',
        subtitle: 'High-altitude Ethiopian Heirloom micro-lots.',
        visualPrompt: 'Vertical high-speed commercial pour of velvety golden espresso crema into smoked glass with rising steam.',
        motion: 'zoom-in',
        imageUrl: IMG_ESPRESSO,
      },
      {
        id: 'sc_s2',
        index: 1,
        startSec: 5,
        durationSec: 5,
        headline: 'Notes of Dark Cacao & Bergamot.',
        subtitle: 'Small-batch precision profiles sealed within 20 minutes.',
        visualPrompt: 'Slow vertical drift across dark slate stone and warm golden espresso extraction.',
        motion: 'pan-right',
        imageUrl: IMG_ESPRESSO,
      },
      {
        id: 'sc_s3',
        index: 2,
        startSec: 10,
        durationSec: 5,
        headline: 'Elevate Your Morning Ritual.',
        subtitle: 'First tasting flight 30% off — Free express shipping.',
        visualPrompt: 'Warm backlit reveal of freshly extracted espresso shot.',
        motion: 'zoom-out',
        imageUrl: IMG_ESPRESSO,
      },
    ]),
    'Roasted yesterday, poured this morning. Solis micro-lot espresso brings dark cacao richness and bright bergamot clarity straight to your kitchen. Taste the difference with thirty percent off your first tasting flight.',
    'Zephyr',
    'Warm, sensory, inviting lifestyle storyteller',
    null,
    'velvet-groove',
    null,
    0.32,
    0.95,
    null,
    null,
    IMG_ESPRESSO,
    'Get 30% Off Flight',
    'solisroasters.co/flight',
    'kinetic',
    now,
    now
  );

  // Integrations (5 Social + 3 Email Marketing per client)
  const insertIntegration = db.prepare(`
    INSERT INTO integrations (id, client_id, platform, category, connected, account_handle, webhook_url, auto_sync, last_sync_at, followers_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const platformConfigs: Array<{ platform: string; category: 'social' | 'email'; defaultConnected: number; handleSuffix: string; followers: number }> = [
    { platform: 'TikTok', category: 'social', defaultConnected: 1, handleSuffix: 'official', followers: 142800 },
    { platform: 'Instagram Reels', category: 'social', defaultConnected: 1, handleSuffix: 'studio', followers: 98400 },
    { platform: 'YouTube Shorts', category: 'social', defaultConnected: 1, handleSuffix: 'tv', followers: 61200 },
    { platform: 'LinkedIn', category: 'social', defaultConnected: 1, handleSuffix: 'inc', followers: 34900 },
    { platform: 'X (Twitter)', category: 'social', defaultConnected: 0, handleSuffix: 'hq', followers: 28100 },
    { platform: 'Klaviyo', category: 'email', defaultConnected: 1, handleSuffix: 'lifecycle', followers: 52400 },
    { platform: 'Mailchimp', category: 'email', defaultConnected: 0, handleSuffix: 'newsletter', followers: 19300 },
    { platform: 'HubSpot', category: 'email', defaultConnected: 1, handleSuffix: 'crm', followers: 41600 },
  ];

  const clientSlugs: Record<string, string> = {
    cli_aether: 'aetheracoustics',
    cli_kestrel: 'kestrellabs',
    cli_solis: 'solisroasters',
  };

  for (const [cid, slug] of Object.entries(clientSlugs)) {
    for (const p of platformConfigs) {
      const id = `int_${cid}_${p.platform.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const mult = cid === 'cli_aether' ? 1 : cid === 'cli_kestrel' ? 0.72 : 1.18;
      insertIntegration.run(
        id,
        cid,
        p.platform,
        p.category,
        p.defaultConnected,
        p.category === 'social' ? `@${slug}.${p.handleSuffix}` : `${slug}-${p.handleSuffix}@campaigns.io`,
        '',
        1,
        p.defaultConnected ? now : null,
        Math.round(p.followers * mult)
      );
    }
  }

  // Scheduled Posts
  const insertSchedule = db.prepare(`
    INSERT INTO scheduled_posts (id, client_id, project_id, platform, scheduled_for, caption, hashtags, status, published_at, external_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const dayOffsetIso = (days: number, hour = 14) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  insertSchedule.run('sch_1', 'cli_aether', 'prj_aether_01', 'YouTube Shorts', dayOffsetIso(1, 16), 'Studio-grade planar clarity, untethered. Meet Aether One.', '#AetherOne #StudioAudio #SpatialSound', 'Queued', null, null);
  insertSchedule.run('sch_2', 'cli_aether', 'prj_aether_02', 'TikTok', dayOffsetIso(2, 18), 'Zero plastic resonance. Engineered for ears that catch every layer.', '#Audiophile #Headphones #ProductDesign', 'Queued', null, null);
  insertSchedule.run('sch_3', 'cli_aether', 'prj_aether_02', 'Instagram Reels', dayOffsetIso(-1, 15), 'Founder Edition pre-orders are officially open.', '#AetherAcoustics #AudioGear #IndustrialDesign', 'Published', dayOffsetIso(-1, 15), 'https://instagram.com/reel/aether-founder-01');
  insertSchedule.run('sch_4', 'cli_aether', 'prj_aether_01', 'Klaviyo', dayOffsetIso(3, 10), 'Launch Film + Early Access VIP Email Embed — Aether One', '#VIPDrop #EmailCampaign', 'Queued', null, null);
  insertSchedule.run('sch_5', 'cli_kestrel', 'prj_kestrel_01', 'LinkedIn', dayOffsetIso(1, 11), 'Sub-8ms edge execution straight from git push. Kestrel v3 is live.', '#DevTools #TypeScript #EdgeComputing', 'Queued', null, null);
  insertSchedule.run('sch_6', 'cli_solis', 'prj_solis_01', 'Instagram Reels', dayOffsetIso(-2, 9), 'Roasted yesterday, poured this morning. First flight 30% off.', '#SpecialtyCoffee #EspressoReel #SolisRoasters', 'Published', dayOffsetIso(-2, 9), 'https://instagram.com/reel/solis-crema-09');

  // Review Comments
  const insertComment = db.prepare(`
    INSERT INTO review_comments (id, project_id, author_name, author_role, timecode_sec, body, resolved, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertComment.run('cmt_1', 'prj_aether_01', 'Elena Vance', 'Client Reviewer', 2.4, 'Love the opening rim-light push-in on the brass yoke. Can we keep the headline up 0.5s longer before Scene 2?', 0, now);
  insertComment.run('cmt_2', 'prj_aether_01', 'Marcus Thorne', 'Creative Producer', 8.1, 'Updated the voiceover script pacing so "zero phase distortion" lands right on the leather detail pan.', 1, now);
  insertComment.run('cmt_3', 'prj_aether_01', 'Elena Vance', 'Client Reviewer', 12.6, 'End-card CTA URL looks crisp and legible inside the 16:9 safe zone. Ready to approve after voiceover render.', 0, now);
  insertComment.run('cmt_4', 'prj_kestrel_01', 'Devon Park', 'Agency Admin', 4.5, 'GitHub star badge & sub-8ms latency metric both verified from latest v3 release notes.', 1, now);

  // Team Members
  const insertMember = db.prepare(`
    INSERT INTO team_members (id, name, email, role, avatar_url, client_access, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertMember.run('usr_1', 'Devon Park', 'devon@cadencestudio.agency', 'admin', IMG_AVATAR, 'All Client Accounts (3)', now);
  insertMember.run('usr_2', 'Marcus Thorne', 'marcus@cadencestudio.agency', 'producer', IMG_AVATAR, 'Aether Acoustics, Kestrel Labs, Solis Roasters', now);
  insertMember.run('usr_3', 'Elena Vance', 'elena@aetheracoustics.io', 'reviewer', IMG_AVATAR, 'Aether Acoustics', now);
  insertMember.run('usr_4', 'Priya Nair', 'priya@cadencestudio.agency', 'analyst', IMG_AVATAR, 'All Client Accounts (3)', now);

  // Analytics Daily (last 21 days across connected platforms per client)
  const insertAnalytic = db.prepare(`
    INSERT INTO analytics_daily (id, client_id, project_id, platform, metric_date, impressions, views_3s, completions, clicks, conversions, spend, revenue, email_opens, email_clicks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const clientMainProjects: Record<string, string> = {
    cli_aether: 'prj_aether_01',
    cli_kestrel: 'prj_kestrel_01',
    cli_solis: 'prj_solis_01',
  };

  const platforms = ['TikTok', 'Instagram Reels', 'YouTube Shorts', 'LinkedIn', 'Klaviyo', 'HubSpot'];
  const insertAnalyticsTx = db.transaction(() => {
    for (const [cid, pid] of Object.entries(clientMainProjects)) {
      const baseScale = cid === 'cli_aether' ? 1.15 : cid === 'cli_kestrel' ? 0.85 : 1.35;
      for (let d = 20; d >= 0; d--) {
        const dt = new Date();
        dt.setDate(dt.getDate() - d);
        const dateStr = dt.toISOString().slice(0, 10);
        const trend = 1 + (20 - d) * 0.025; // steady organic + paid lift

        for (let pIdx = 0; pIdx < platforms.length; pIdx++) {
          const platform = platforms[pIdx];
          const isEmail = platform === 'Klaviyo' || platform === 'HubSpot';
          const wave = 0.85 + Math.sin(d * 0.65 + pIdx * 1.4) * 0.22;
          const platWeight =
            platform === 'TikTok' ? 1.55 :
            platform === 'Instagram Reels' ? 1.25 :
            platform === 'YouTube Shorts' ? 0.95 :
            platform === 'LinkedIn' ? 0.58 :
            0.42;

          const impressions = Math.round(14000 * baseScale * trend * wave * platWeight);
          const views3s = isEmail ? 0 : Math.round(impressions * (0.38 + (pIdx % 3) * 0.04));
          const completions = isEmail ? 0 : Math.round(views3s * (0.44 + (pIdx % 2) * 0.06));
          const clicks = Math.round(impressions * (isEmail ? 0.052 : 0.029));
          const conversions = Math.max(1, Math.round(clicks * (cid === 'cli_kestrel' ? 0.068 : 0.084)));
          const spend = Number((impressions * (isEmail ? 0.002 : 0.014)).toFixed(2));
          const aov = cid === 'cli_aether' ? 285 : cid === 'cli_kestrel' ? 190 : 68;
          const revenue = Number((conversions * aov).toFixed(2));
          const emailOpens = isEmail ? Math.round(impressions * 0.41) : 0;
          const emailClicks = isEmail ? clicks : 0;

          insertAnalytic.run(
            `an_${cid}_${dateStr}_${pIdx}`,
            cid,
            pid,
            platform,
            dateStr,
            impressions,
            views3s,
            completions,
            clicks,
            conversions,
            spend,
            revenue,
            emailOpens,
            emailClicks
          );
        }
      }
    }
  });
  insertAnalyticsTx();

  // Seed 1 initial monthly report for Aether Acoustics
  db.prepare(`
    INSERT INTO reports (id, client_id, period_label, summary_markdown, highlights_json, recommendations_json, metrics_snapshot_json, delivery_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rep_aether_initial',
    'cli_aether',
    'October 2026 Executive Review',
    'Aether Acoustics delivered a strong pre-launch acceleration across short-form video and Klaviyo VIP sequences. Planar driver storytelling drove a 41.2% 3-second hook rate on TikTok and Instagram Reels, outperforming consumer audio benchmarks by 11.8 percentage points.',
    JSON.stringify([
      'TikTok & Instagram Reels drove 64% of total top-of-funnel video impressions with an average 4.1x blended ROAS.',
      'Klaviyo video-embedded launch teasers achieved a 41.4% open rate and 5.2% click-through rate.',
      'The 15-second Cinema Product Reveal template outperformed static image ads on conversion rate by 2.4x.',
    ]),
    JSON.stringify([
      'Shift 15% of LinkedIn display budget into 9:16 TikTok & YouTube Shorts Founder Batch cutdowns.',
      'Test a dual-speaker comparison voiceover highlighting 48-hour battery life within the first 3 seconds.',
      'Schedule automated Klaviyo follow-ups 24 hours after each published Instagram Reel.',
    ]),
    JSON.stringify({
      impressions: 1842600,
      views_3s: 742100,
      hook_rate: 40.3,
      completion_rate: 46.8,
      clicks: 56120,
      ctr: 3.05,
      conversions: 1284,
      spend: 24890,
      revenue: 109450,
      roas: 4.4,
      email_opens: 91400,
      email_clicks: 11240,
      by_platform: [
        { platform: 'TikTok', impressions: 698000, clicks: 20400, conversions: 492, revenue: 41820 },
        { platform: 'Instagram Reels', impressions: 512000, clicks: 15800, conversions: 381, revenue: 32940 },
        { platform: 'YouTube Shorts', impressions: 324000, clicks: 8900, conversions: 204, revenue: 17420 },
        { platform: 'Klaviyo', impressions: 186000, clicks: 7620, conversions: 146, revenue: 12180 },
        { platform: 'LinkedIn', impressions: 122600, clicks: 3400, conversions: 61, revenue: 5090 },
      ],
    }),
    'Sent to 2 recipients',
    now
  );

  logAudit('admin', 'workspace.seeded', 'system', 'cadence', 'Initialized multi-client agency workspace with 3 brand portfolios and automated integrations.');
}
