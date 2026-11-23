import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db, initDatabase, logAudit, MEDIA_DIR, ROLE_DEFINITIONS } from './server/db.ts';
import {
  formatGeminiError,
  generateAdBlueprintFromSource,
  generateLyriaMusicClip,
  generateMonthlyReportNarrative,
  generateOmniVideoClip,
  generateVoiceoverWav,
} from './server/gemini.ts';
import { fetchGitHubRepoDetail, fetchGitHubRepos, scrapeWebsite } from './server/ingest.ts';
import type { RoleDefinition, RoleKey } from './src/types.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use('/media', express.static(MEDIA_DIR));

function getActiveRole(req: Request): RoleDefinition {
  const header = String(req.header('x-active-role') || 'admin').toLowerCase() as RoleKey;
  return ROLE_DEFINITIONS[header] || ROLE_DEFINITIONS.admin;
}

function requirePermission(perm: keyof RoleDefinition['permissions']) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getActiveRole(req);
    if (!role.permissions[perm]) {
      res.status(403).json({
        error: `Access denied for ${role.label}. Required permission: ${perm}. Switch to an authorized role preset to perform this action.`,
      });
      return;
    }
    next();
  };
}

function mapProjectRow(row: Record<string, unknown>) {
  return {
    ...row,
    scenes: JSON.parse(String(row.scenes_json || '[]')),
  };
}

function mapReportRow(row: Record<string, unknown>) {
  return {
    ...row,
    highlights: JSON.parse(String(row.highlights_json || '[]')),
    recommendations: JSON.parse(String(row.recommendations_json || '[]')),
    metrics_snapshot: JSON.parse(String(row.metrics_snapshot_json || '{}')),
  };
}

// Bootstrap workspace data
app.get('/api/bootstrap', (_req, res) => {
  const clients = db.prepare('SELECT * FROM clients ORDER BY created_at ASC').all();
  const templates = db.prepare('SELECT * FROM templates ORDER BY is_system DESC, name ASC').all();
  const team = db.prepare('SELECT * FROM team_members ORDER BY name ASC').all();
  res.json({
    clients,
    templates,
    team,
    roles: ROLE_DEFINITIONS,
  });
});

// Clients CRUD
app.get('/api/clients', (_req, res) => {
  const clients = db.prepare('SELECT * FROM clients ORDER BY created_at ASC').all();
  res.json(clients);
});

app.post('/api/clients', requirePermission('manageClientsTeam'), (req, res) => {
  const { name, industry, website, github_org, brand_accent, aws_region, aws_s3_bucket, report_recipients } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: 'Client name is required.' });
    return;
  }
  const id = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'brand';

  db.prepare(`
    INSERT INTO clients (id, name, industry, website, github_org, brand_primary, brand_accent, font_style, aws_region, aws_s3_bucket, aws_replication_mode, report_day_of_month, report_recipients, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name.trim(),
    industry?.trim() || 'Digital Product',
    website?.trim() || '',
    github_org?.trim() || '',
    '#0E1117',
    brand_accent || '#F59E0B',
    'Plus Jakarta Sans',
    aws_region || 'us-east-1',
    aws_s3_bucket?.trim() || `${slug}-ad-masters-prod`,
    'Multi-AZ Active-Active',
    1,
    report_recipients?.trim() || `marketing@${slug}.com`,
    now
  );

  // Auto-provision automated integration slots for the new client
  const defaults: Array<[string, 'social' | 'email']> = [
    ['TikTok', 'social'],
    ['Instagram Reels', 'social'],
    ['YouTube Shorts', 'social'],
    ['LinkedIn', 'social'],
    ['X (Twitter)', 'social'],
    ['Klaviyo', 'email'],
    ['Mailchimp', 'email'],
    ['HubSpot', 'email'],
  ];
  const insInt = db.prepare(`
    INSERT INTO integrations (id, client_id, platform, category, connected, account_handle, webhook_url, auto_sync, last_sync_at, followers_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [platform, cat] of defaults) {
    insInt.run(
      `int_${id}_${platform.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      id,
      platform,
      cat,
      cat === 'social' && (platform === 'TikTok' || platform === 'Instagram Reels') ? 1 : 0,
      cat === 'social' ? `@${slug}` : `growth@${slug}.com`,
      '',
      1,
      now,
      Math.round(5000 + Math.random() * 25000)
    );
  }

  logAudit(getActiveRole(req).key, 'client.created', 'client', id, `Created client workspace "${name.trim()}"`);
  const created = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  res.status(201).json(created);
});

app.patch('/api/clients/:id', requirePermission('manageClientsTeam'), (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Client not found.' });
    return;
  }

  const fields = [
    'name',
    'industry',
    'website',
    'github_org',
    'brand_primary',
    'brand_accent',
    'aws_region',
    'aws_s3_bucket',
    'aws_replication_mode',
    'report_day_of_month',
    'report_recipients',
  ];

  const updates: string[] = [];
  const values: unknown[] = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    logAudit(getActiveRole(req).key, 'client.updated', 'client', req.params.id, `Updated client configuration (${updates.length} fields)`);
  }
  res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id));
});

// Projects
app.get('/api/projects', (req, res) => {
  const clientId = String(req.query.clientId || '');
  const rows = clientId
    ? (db.prepare('SELECT * FROM projects WHERE client_id = ? ORDER BY updated_at DESC').all(clientId) as Record<string, unknown>[])
    : (db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as Record<string, unknown>[]);
  res.json(rows.map(mapProjectRow));
});

app.post('/api/projects', requirePermission('editProjects'), (req, res) => {
  const {
    client_id,
    title,
    source_type = 'manual',
    source_url = '',
    aspect_ratio = '9:16',
    duration_sec = 15,
    template_id = 'tpl_cinema_reveal',
    scenes = [],
    voiceover_script = '',
    voiceover_voice = 'Kore',
    voiceover_style = 'Confident, modern commercial narrator',
    music_track_id = 'midnight-synth',
    hero_image_url = '/src/assets/images/ad_audio_headphones_1795390924557.jpg',
    cta_text = 'Learn More',
    cta_url = 'example.com',
  } = req.body;

  if (!client_id || !title) {
    res.status(400).json({ error: 'client_id and title are required.' });
    return;
  }

  const id = `prj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, client_id, title, source_type, source_url, aspect_ratio, duration_sec, status, template_id, scenes_json, voiceover_script, voiceover_voice, voiceover_style, voiceover_url, music_track_id, music_url, music_volume, voice_volume, video_clip_url, video_interaction_id, hero_image_url, cta_text, cta_url, caption_style, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?, NULL, ?, NULL, 0.28, 0.95, NULL, NULL, ?, ?, ?, 'kinetic', ?, ?)
  `).run(
    id,
    client_id,
    title,
    source_type,
    source_url,
    aspect_ratio,
    duration_sec,
    template_id,
    JSON.stringify(scenes),
    voiceover_script,
    voiceover_voice,
    voiceover_style,
    music_track_id,
    hero_image_url,
    cta_text,
    cta_url,
    now,
    now
  );

  logAudit(getActiveRole(req).key, 'project.created', 'project', id, `Created ad project "${title}"`);
  const created = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown>;
  res.status(201).json(mapProjectRow(created));
});

app.patch('/api/projects/:id', (req, res) => {
  const role = getActiveRole(req);
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  // Allow reviewers to change status (approve/request changes), require editProjects for creative edits
  const bodyKeys = Object.keys(req.body);
  const isStatusOnly = bodyKeys.length === 1 && bodyKeys[0] === 'status';
  if (isStatusOnly) {
    const nextStatus = String(req.body.status);
    if (nextStatus === 'Approved' && !role.permissions.approveProjects) {
      res.status(403).json({ error: `Role "${role.label}" cannot approve ads. Switch to Client Reviewer or Agency Admin.` });
      return;
    }
    if (!role.permissions.editProjects && !role.permissions.approveProjects) {
      res.status(403).json({ error: `Role "${role.label}" cannot update project status.` });
      return;
    }
  } else if (!role.permissions.editProjects) {
    res.status(403).json({ error: `Role "${role.label}" has read/review-only access to creative timelines.` });
    return;
  }

  const allowed = [
    'title',
    'aspect_ratio',
    'duration_sec',
    'status',
    'template_id',
    'voiceover_script',
    'voiceover_voice',
    'voiceover_style',
    'voiceover_url',
    'music_track_id',
    'music_url',
    'music_volume',
    'voice_volume',
    'video_clip_url',
    'video_interaction_id',
    'hero_image_url',
    'cta_text',
    'cta_url',
    'caption_style',
  ];

  const updates: string[] = [];
  const values: unknown[] = [];

  if (req.body.scenes !== undefined) {
    updates.push('scenes_json = ?');
    values.push(JSON.stringify(req.body.scenes));
  }
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(req.params.id);

  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  if (req.body.status && req.body.status !== existing.status) {
    logAudit(role.key, 'project.status_changed', 'project', req.params.id, `Status changed from ${existing.status} to ${req.body.status}`);
  }
  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  res.json(mapProjectRow(updated));
});

app.delete('/api/projects/:id', requirePermission('editProjects'), (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  logAudit(getActiveRole(req).key, 'project.deleted', 'project', req.params.id, 'Deleted ad project');
  res.json({ deleted: true });
});

// Upload user media (image/video/audio) base64 to server media store
app.post('/api/projects/:id/upload-media', requirePermission('editProjects'), (req, res) => {
  const { kind, dataUrl } = req.body as { kind: 'image' | 'video' | 'audio'; dataUrl: string };
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    res.status(400).json({ error: 'Valid base64 data URL required.' });
    return;
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    res.status(400).json({ error: 'Malformed base64 media payload.' });
    return;
  }
  const mime = match[1];
  const ext = mime.split('/')[1]?.replace('mpeg', 'mp3').replace('quicktime', 'mov').split('+')[0] || 'bin';
  const filename = `up_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, filename), Buffer.from(match[2], 'base64'));
  const mediaUrl = `/media/${filename}`;

  if (kind === 'video') {
    db.prepare('UPDATE projects SET video_clip_url = ?, updated_at = ? WHERE id = ?').run(mediaUrl, new Date().toISOString(), req.params.id);
  } else if (kind === 'audio') {
    db.prepare('UPDATE projects SET music_url = ?, updated_at = ? WHERE id = ?').run(mediaUrl, new Date().toISOString(), req.params.id);
  } else if (kind === 'image') {
    db.prepare('UPDATE projects SET hero_image_url = ?, updated_at = ? WHERE id = ?').run(mediaUrl, new Date().toISOString(), req.params.id);
  }

  res.json({ mediaUrl });
});

// Project Review Comments
app.get('/api/projects/:id/comments', (req, res) => {
  const rows = db.prepare('SELECT * FROM review_comments WHERE project_id = ? ORDER BY timecode_sec ASC, created_at ASC').all(req.params.id);
  res.json(rows);
});

app.post('/api/projects/:id/comments', requirePermission('comment'), (req, res) => {
  const { body, timecode_sec = 0, author_name } = req.body;
  if (!body?.trim()) {
    res.status(400).json({ error: 'Comment text is required.' });
    return;
  }
  const role = getActiveRole(req);
  const id = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const defaultAuthors: Record<RoleKey, string> = {
    admin: 'Devon Park',
    producer: 'Marcus Thorne',
    reviewer: 'Elena Vance',
    analyst: 'Priya Nair',
  };

  db.prepare(`
    INSERT INTO review_comments (id, project_id, author_name, author_role, timecode_sec, body, resolved, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, req.params.id, author_name || defaultAuthors[role.key], role.label, Number(timecode_sec) || 0, body.trim(), now);

  res.status(201).json(db.prepare('SELECT * FROM review_comments WHERE id = ?').get(id));
});

app.patch('/api/comments/:commentId', requirePermission('comment'), (req, res) => {
  db.prepare('UPDATE review_comments SET resolved = ? WHERE id = ?').run(req.body.resolved ? 1 : 0, req.params.commentId);
  res.json(db.prepare('SELECT * FROM review_comments WHERE id = ?').get(req.params.commentId));
});

// Templates CRUD
app.get('/api/templates', (_req, res) => {
  res.json(db.prepare('SELECT * FROM templates ORDER BY is_system DESC, name ASC').all());
});

app.post('/api/templates', requirePermission('editProjects'), (req, res) => {
  const {
    client_id = null,
    name,
    category = 'Custom Brand Kit',
    aspect_ratio = '9:16',
    bg_color = '#0B0D12',
    accent_color = '#F59E0B',
    text_color = '#F8FAFC',
    font_display = 'Plus Jakarta Sans',
    overlay_style = 'cinema-bars',
    motion_preset = 'slow-push',
    lower_third_style = 'bar',
    preview_image = '/src/assets/images/ad_luxury_watch_1795390925192.jpg',
  } = req.body;

  if (!name?.trim()) {
    res.status(400).json({ error: 'Template name is required.' });
    return;
  }

  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO templates (id, client_id, name, category, aspect_ratio, bg_color, accent_color, text_color, font_display, overlay_style, motion_preset, lower_third_style, preview_image, is_system)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(id, client_id, name.trim(), category, aspect_ratio, bg_color, accent_color, text_color, font_display, overlay_style, motion_preset, lower_third_style, preview_image);

  logAudit(getActiveRole(req).key, 'template.created', 'template', id, `Created custom brand template "${name.trim()}"`);
  res.status(201).json(db.prepare('SELECT * FROM templates WHERE id = ?').get(id));
});

app.patch('/api/templates/:id', requirePermission('editProjects'), (req, res) => {
  const fields = ['name', 'category', 'aspect_ratio', 'bg_color', 'accent_color', 'text_color', 'overlay_style', 'motion_preset', 'lower_third_style'];
  const updates: string[] = [];
  const values: unknown[] = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE templates SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  res.json(db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id));
});

// Live Website Scraper -> Ad Blueprint & Project Creation
app.post('/api/ingest/website', requirePermission('generateMedia'), async (req, res) => {
  try {
    const { url, clientId, aspectRatio = '9:16', goal } = req.body;
    if (!url?.trim() || !clientId) {
      res.status(400).json({ error: 'Website URL and clientId are required.' });
      return;
    }

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as Record<string, string> | undefined;
    const scraped = await scrapeWebsite(url);

    const sourceContent = [
      `Page Title: ${scraped.title}`,
      `Meta Description: ${scraped.description}`,
      `Headings: ${scraped.headings.join(' | ')}`,
      `Page Content: ${scraped.bodyExcerpt}`,
    ].join('\n');

    const blueprint = await generateAdBlueprintFromSource({
      sourceType: 'website',
      sourceLabel: scraped.url,
      sourceContent,
      brandName: client?.name || scraped.title,
      industry: client?.industry || 'Product',
      aspectRatio,
      goal,
    });

    const fallbackImg =
      aspectRatio === '9:16'
        ? '/src/assets/images/ad_espresso_roast_1795390924456.jpg'
        : '/src/assets/images/ad_audio_headphones_1795390924557.jpg';

    const heroImage = fallbackImg;
    const scenes = blueprint.scenes.map((s, idx) => ({
      id: `sc_${Date.now()}_${idx}`,
      index: idx,
      startSec: idx * 5,
      durationSec: 5,
      headline: s.headline,
      subtitle: s.subtitle,
      visualPrompt: s.visualPrompt,
      motion: s.motion,
      imageUrl: heroImage,
    }));

    const projectId = `prj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const templateId = aspectRatio === '9:16' ? 'tpl_vertical_hook' : 'tpl_cinema_reveal';

    db.prepare(`
      INSERT INTO projects (id, client_id, title, source_type, source_url, aspect_ratio, duration_sec, status, template_id, scenes_json, voiceover_script, voiceover_voice, voiceover_style, voiceover_url, music_track_id, music_url, music_volume, voice_volume, video_clip_url, video_interaction_id, hero_image_url, cta_text, cta_url, caption_style, updated_at, created_at)
      VALUES (?, ?, ?, 'website', ?, ?, 15, 'Draft', ?, ?, ?, ?, ?, NULL, ?, NULL, 0.28, 0.95, NULL, NULL, ?, ?, ?, 'kinetic', ?, ?)
    `).run(
      projectId,
      clientId,
      blueprint.title,
      scraped.url,
      aspectRatio,
      templateId,
      JSON.stringify(scenes),
      blueprint.voiceoverScript,
      blueprint.recommendedVoice,
      blueprint.recommendedVoiceStyle,
      blueprint.recommendedMusicTrackId,
      heroImage,
      blueprint.ctaText,
      blueprint.ctaUrl,
      now,
      now
    );

    logAudit(getActiveRole(req).key, 'ingest.website', 'project', projectId, `Scraped ${scraped.url} and generated 3-scene ad blueprint`);
    const created = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
    res.status(201).json({
      project: mapProjectRow(created),
      scrapedSummary: {
        title: scraped.title,
        description: scraped.description,
        headingsCount: scraped.headings.length,
        ogImage: scraped.ogImage,
      },
      socialCaption: blueprint.socialCaption,
      hashtags: blueprint.hashtags,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// Live GitHub Repo Browser
app.get('/api/ingest/github/repos', async (req, res) => {
  try {
    const user = String(req.query.user || '').trim();
    const token = req.header('x-github-token') || undefined;
    const repos = await fetchGitHubRepos(user, token);
    res.json(repos);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load GitHub repositories.' });
  }
});

// Live GitHub Repo -> Ad Blueprint & Project Creation
app.post('/api/ingest/github/generate', requirePermission('generateMedia'), async (req, res) => {
  try {
    const { ownerRepo, clientId, aspectRatio = '16:9', goal } = req.body;
    const token = req.header('x-github-token') || undefined;
    if (!ownerRepo?.trim() || !clientId) {
      res.status(400).json({ error: 'ownerRepo (owner/repo) and clientId are required.' });
      return;
    }

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as Record<string, string> | undefined;
    const detail = await fetchGitHubRepoDetail(ownerRepo, token);

    const sourceContent = [
      `Repository: ${detail.repo.full_name}`,
      `Description: ${detail.repo.description || 'N/A'}`,
      `Primary Language: ${detail.repo.language || 'Unknown'} (${detail.languages.join(', ')})`,
      `GitHub Stars: ${detail.repo.stargazers_count.toLocaleString()} | Forks: ${detail.repo.forks_count.toLocaleString()}`,
      `Topics: ${detail.repo.topics.join(', ')}`,
      `Homepage: ${detail.repo.homepage || detail.repo.html_url}`,
      detail.latestRelease ? `Latest Release: ${detail.latestRelease}` : '',
      `README Summary: ${detail.readme}`,
    ]
      .filter(Boolean)
      .join('\n');

    const blueprint = await generateAdBlueprintFromSource({
      sourceType: 'github',
      sourceLabel: detail.repo.html_url,
      sourceContent,
      brandName: detail.repo.name || client?.name || 'Developer Project',
      industry: 'Developer Tools & Open Source Software',
      aspectRatio,
      goal: goal || 'Highlight developer velocity, GitHub adoption, and technical value',
    });

    const heroImage =
      aspectRatio === '9:16'
        ? '/src/assets/images/ad_luxury_watch_1795390925192.jpg'
        : '/src/assets/images/ad_devtools_cloud_1795390925048.jpg';

    const scenes = blueprint.scenes.map((s, idx) => ({
      id: `sc_${Date.now()}_${idx}`,
      index: idx,
      startSec: idx * 5,
      durationSec: 5,
      headline: s.headline,
      subtitle: s.subtitle,
      visualPrompt: s.visualPrompt,
      motion: s.motion,
      imageUrl: heroImage,
    }));

    const projectId = `prj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, client_id, title, source_type, source_url, aspect_ratio, duration_sec, status, template_id, scenes_json, voiceover_script, voiceover_voice, voiceover_style, voiceover_url, music_track_id, music_url, music_volume, voice_volume, video_clip_url, video_interaction_id, hero_image_url, cta_text, cta_url, caption_style, updated_at, created_at)
      VALUES (?, ?, ?, 'github', ?, ?, 15, 'Draft', 'tpl_dev_launch', ?, ?, ?, ?, NULL, ?, NULL, 0.25, 0.95, NULL, NULL, ?, ?, ?, 'broadcast', ?, ?)
    `).run(
      projectId,
      clientId,
      blueprint.title,
      detail.repo.html_url,
      aspectRatio,
      JSON.stringify(scenes),
      blueprint.voiceoverScript,
      blueprint.recommendedVoice,
      blueprint.recommendedVoiceStyle,
      blueprint.recommendedMusicTrackId,
      heroImage,
      blueprint.ctaText,
      blueprint.ctaUrl,
      now,
      now
    );

    logAudit(getActiveRole(req).key, 'ingest.github', 'project', projectId, `Ingested GitHub repository ${detail.repo.full_name}`);
    const created = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
    res.status(201).json({
      project: mapProjectRow(created),
      repoSummary: detail.repo,
      socialCaption: blueprint.socialCaption,
      hashtags: blueprint.hashtags,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// Regenerate Script / Storyboard for existing project
app.post('/api/ai/script', requirePermission('generateMedia'), async (req, res) => {
  try {
    const { projectId, brief, aspectRatio } = req.body;
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, string> | undefined;
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(project.client_id) as Record<string, string> | undefined;

    const blueprint = await generateAdBlueprintFromSource({
      sourceType: 'manual',
      sourceLabel: project.source_url || project.title,
      sourceContent: brief || project.voiceover_script,
      brandName: client?.name || project.title,
      industry: client?.industry || 'Brand',
      aspectRatio: aspectRatio || (project.aspect_ratio as '9:16' | '16:9'),
    });

    const existingScenes = JSON.parse(project.scenes_json || '[]') as Array<{ imageUrl?: string }>;
    const scenes = blueprint.scenes.map((s, idx) => ({
      id: `sc_${Date.now()}_${idx}`,
      index: idx,
      startSec: idx * 5,
      durationSec: 5,
      headline: s.headline,
      subtitle: s.subtitle,
      visualPrompt: s.visualPrompt,
      motion: s.motion,
      imageUrl: existingScenes[idx]?.imageUrl || project.hero_image_url,
    }));

    db.prepare(`
      UPDATE projects
      SET scenes_json = ?, voiceover_script = ?, cta_text = ?, cta_url = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(scenes), blueprint.voiceoverScript, blueprint.ctaText, blueprint.ctaUrl, new Date().toISOString(), projectId);

    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
    res.json(mapProjectRow(updated));
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// Real Gemini AI Voiceover Generation (WAV)
app.post('/api/ai/voiceover', requirePermission('generateMedia'), async (req, res) => {
  try {
    const { projectId, script, voiceName, style, dualSpeaker, secondaryVoiceName } = req.body;
    if (!script?.trim()) {
      res.status(400).json({ error: 'Voiceover script text is required.' });
      return;
    }

    const result = await generateVoiceoverWav({
      script: script.trim(),
      voiceName: voiceName || 'Kore',
      style: style || 'Confident, polished commercial voiceover',
      dualSpeaker: Boolean(dualSpeaker),
      secondaryVoiceName,
    });

    if (projectId) {
      db.prepare(`
        UPDATE projects
        SET voiceover_script = ?, voiceover_voice = ?, voiceover_style = ?, voiceover_url = ?, updated_at = ?
        WHERE id = ?
      `).run(script.trim(), voiceName || 'Kore', style || '', result.audioUrl, new Date().toISOString(), projectId);
      logAudit(getActiveRole(req).key, 'ai.voiceover_generated', 'project', projectId, `Generated WAV voiceover (${voiceName || 'Kore'}) using ${result.modelUsed}`);
    }

    res.json(result);
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// Optional Generative AI Video Clip (Omni Flash — requires paid API key)
app.post('/api/ai/video', requirePermission('generateMedia'), async (req, res) => {
  try {
    const { projectId, prompt, aspectRatio = '16:9', durationSec = 6, previousInteractionId } = req.body;
    if (!prompt?.trim()) {
      res.status(400).json({ error: 'Visual scene prompt is required.' });
      return;
    }
    const result = await generateOmniVideoClip({
      prompt: prompt.trim(),
      aspectRatio,
      durationSec,
      previousInteractionId,
    });
    if (projectId) {
      db.prepare(`
        UPDATE projects SET video_clip_url = ?, video_interaction_id = ?, updated_at = ? WHERE id = ?
      `).run(result.videoUrl, result.interactionId, new Date().toISOString(), projectId);
      logAudit(getActiveRole(req).key, 'ai.video_generated', 'project', projectId, 'Generated AI video clip via Gemini Omni Flash');
    }
    res.json(result);
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// Optional Generative AI Music Track (Lyria — requires paid API key)
app.post('/api/ai/music', requirePermission('generateMedia'), async (req, res) => {
  try {
    const { projectId, prompt } = req.body;
    if (!prompt?.trim()) {
      res.status(400).json({ error: 'Music style prompt is required.' });
      return;
    }
    const result = await generateLyriaMusicClip(prompt.trim());
    if (projectId) {
      db.prepare(`UPDATE projects SET music_url = ?, updated_at = ? WHERE id = ?`).run(result.audioUrl, new Date().toISOString(), projectId);
      logAudit(getActiveRole(req).key, 'ai.music_generated', 'project', projectId, 'Generated custom AI background soundtrack via Lyria');
    }
    res.json(result);
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// Automated Channel Integrations
app.get('/api/integrations', (req, res) => {
  const clientId = String(req.query.clientId || '');
  const rows = db.prepare('SELECT * FROM integrations WHERE client_id = ? ORDER BY category DESC, platform ASC').all(clientId);
  res.json(rows);
});

app.post('/api/integrations/:id/toggle', requirePermission('manageIntegrations'), (req, res) => {
  const existing = db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Integration not found.' });
    return;
  }
  const nextConnected = existing.connected ? 0 : 1;
  const now = new Date().toISOString();
  db.prepare('UPDATE integrations SET connected = ?, last_sync_at = ? WHERE id = ?').run(nextConnected, nextConnected ? now : existing.last_sync_at, req.params.id);
  logAudit(
    getActiveRole(req).key,
    nextConnected ? 'integration.connected' : 'integration.disconnected',
    'integration',
    req.params.id,
    `${nextConnected ? 'Auto-connected' : 'Disconnected'} ${existing.platform} for unified analytics & scheduling`
  );
  res.json(db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.id));
});

app.patch('/api/integrations/:id', requirePermission('manageIntegrations'), (req, res) => {
  const { webhook_url, account_handle, auto_sync } = req.body;
  const updates: string[] = [];
  const values: unknown[] = [];
  if (webhook_url !== undefined) {
    updates.push('webhook_url = ?');
    values.push(webhook_url);
  }
  if (account_handle !== undefined) {
    updates.push('account_handle = ?');
    values.push(account_handle);
  }
  if (auto_sync !== undefined) {
    updates.push('auto_sync = ?');
    values.push(auto_sync ? 1 : 0);
  }
  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE integrations SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  res.json(db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.id));
});

app.post('/api/integrations/:id/sync', requirePermission('manageIntegrations'), (req, res) => {
  const now = new Date().toISOString();
  db.prepare('UPDATE integrations SET last_sync_at = ?, followers_count = followers_count + ? WHERE id = ?').run(
    now,
    Math.floor(Math.random() * 65 + 12),
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.id));
});

// Cross-Platform Scheduler
app.get('/api/scheduler', (req, res) => {
  const clientId = String(req.query.clientId || '');
  const rows = db
    .prepare(`
      SELECT s.*, p.title as project_title
      FROM scheduled_posts s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.client_id = ?
      ORDER BY s.scheduled_for ASC
    `)
    .all(clientId);
  res.json(rows);
});

app.post('/api/scheduler', requirePermission('schedulePublish'), (req, res) => {
  const { client_id, project_id, platform, scheduled_for, caption, hashtags = '' } = req.body;
  if (!client_id || !project_id || !platform || !scheduled_for) {
    res.status(400).json({ error: 'client_id, project_id, platform, and scheduled_for are required.' });
    return;
  }

  const id = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO scheduled_posts (id, client_id, project_id, platform, scheduled_for, caption, hashtags, status, published_at, external_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Queued', NULL, NULL)
  `).run(id, client_id, project_id, platform, scheduled_for, caption || '', hashtags, );

  db.prepare("UPDATE projects SET status = 'Scheduled', updated_at = ? WHERE id = ? AND status IN ('Draft', 'Approved')").run(
    new Date().toISOString(),
    project_id
  );
  logAudit(getActiveRole(req).key, 'scheduler.queued', 'scheduled_post', id, `Scheduled post on ${platform} for ${scheduled_for}`);

  const created = db
    .prepare('SELECT s.*, p.title as project_title FROM scheduled_posts s LEFT JOIN projects p ON s.project_id = p.id WHERE s.id = ?')
    .get(id);
  res.status(201).json(created);
});

app.post('/api/scheduler/:id/publish', requirePermission('schedulePublish'), async (req, res) => {
  const post = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(req.params.id) as Record<string, string> | undefined;
  if (!post) {
    res.status(404).json({ error: 'Scheduled post not found.' });
    return;
  }

  const integration = db
    .prepare('SELECT * FROM integrations WHERE client_id = ? AND platform = ?')
    .get(post.client_id, post.platform) as Record<string, string> | undefined;

  let webhookDispatched = false;
  if (integration?.webhook_url?.startsWith('http')) {
    try {
      await fetch(integration.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'cadence.post.published',
          platform: post.platform,
          projectId: post.project_id,
          caption: post.caption,
          hashtags: post.hashtags,
          timestamp: new Date().toISOString(),
        }),
      });
      webhookDispatched = true;
    } catch {
      // Continue publishing in sandbox even if external webhook endpoint is unreachable
    }
  }

  const now = new Date().toISOString();
  const slug = post.platform.toLowerCase().replace(/[^a-z0-9]/g, '');
  const externalUrl = `https://${slug}.cadence-sandbox.app/post/${post.id}`;

  db.prepare("UPDATE scheduled_posts SET status = 'Published', published_at = ?, external_url = ? WHERE id = ?").run(now, externalUrl, post.id);
  db.prepare("UPDATE projects SET status = 'Published', updated_at = ? WHERE id = ?").run(now, post.project_id);

  // Inject immediate launch telemetry into today's analytics
  const today = now.slice(0, 10);
  db.prepare(`
    INSERT INTO analytics_daily (id, client_id, project_id, platform, metric_date, impressions, views_3s, completions, clicks, conversions, spend, revenue, email_opens, email_clicks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `an_pub_${Date.now()}`,
    post.client_id,
    post.project_id,
    post.platform,
    today,
    4200,
    1890,
    920,
    164,
    14,
    58.4,
    1820.0,
    post.platform === 'Klaviyo' || post.platform === 'Mailchimp' || post.platform === 'HubSpot' ? 1940 : 0,
    post.platform === 'Klaviyo' || post.platform === 'Mailchimp' || post.platform === 'HubSpot' ? 164 : 0
  );

  logAudit(getActiveRole(req).key, 'scheduler.published', 'scheduled_post', post.id, `Published campaign ad to ${post.platform}`);
  const updated = db
    .prepare('SELECT s.*, p.title as project_title FROM scheduled_posts s LEFT JOIN projects p ON s.project_id = p.id WHERE s.id = ?')
    .get(post.id);
  res.json({ post: updated, webhookDispatched });
});

app.delete('/api/scheduler/:id', requirePermission('schedulePublish'), (req, res) => {
  db.prepare('DELETE FROM scheduled_posts WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// Real-Time Analytics
app.get('/api/analytics', (req, res) => {
  const clientId = String(req.query.clientId || '');
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 21));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const rows = db
    .prepare('SELECT * FROM analytics_daily WHERE client_id = ? AND metric_date >= ? ORDER BY metric_date ASC')
    .all(clientId, cutoffStr);
  res.json(rows);
});

app.post('/api/analytics/pulse', (req, res) => {
  const { clientId } = req.body;
  if (!clientId) {
    res.status(400).json({ error: 'clientId is required.' });
    return;
  }

  const connected = db
    .prepare('SELECT platform FROM integrations WHERE client_id = ? AND connected = 1')
    .all(clientId) as Array<{ platform: string }>;

  const today = new Date().toISOString().slice(0, 10);
  const targetPlatforms = connected.length > 0 ? connected.map((c) => c.platform) : ['TikTok', 'Instagram Reels'];

  for (const platform of targetPlatforms) {
    const existing = db
      .prepare('SELECT * FROM analytics_daily WHERE client_id = ? AND platform = ? AND metric_date = ? LIMIT 1')
      .get(clientId, platform, today) as Record<string, unknown> | undefined;

    const addImp = Math.floor(140 + Math.random() * 480);
    const isEmail = platform === 'Klaviyo' || platform === 'Mailchimp' || platform === 'HubSpot';
    const addViews = isEmail ? 0 : Math.floor(addImp * 0.42);
    const addComp = isEmail ? 0 : Math.floor(addViews * 0.48);
    const addClicks = Math.max(2, Math.floor(addImp * 0.034));
    const addConv = Math.random() > 0.45 ? Math.floor(1 + Math.random() * 3) : 0;
    const addSpend = Number((addImp * 0.012).toFixed(2));
    const addRev = Number((addConv * 145).toFixed(2));

    if (existing) {
      db.prepare(`
        UPDATE analytics_daily
        SET impressions = impressions + ?,
            views_3s = views_3s + ?,
            completions = completions + ?,
            clicks = clicks + ?,
            conversions = conversions + ?,
            spend = ROUND(spend + ?, 2),
            revenue = ROUND(revenue + ?, 2),
            email_opens = email_opens + ?,
            email_clicks = email_clicks + ?
        WHERE id = ?
      `).run(
        addImp,
        addViews,
        addComp,
        addClicks,
        addConv,
        addSpend,
        addRev,
        isEmail ? Math.floor(addImp * 0.4) : 0,
        isEmail ? addClicks : 0,
        existing.id
      );
    } else {
      db.prepare(`
        INSERT INTO analytics_daily (id, client_id, project_id, platform, metric_date, impressions, views_3s, completions, clicks, conversions, spend, revenue, email_opens, email_clicks)
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `an_live_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        clientId,
        platform,
        today,
        addImp,
        addViews,
        addComp,
        addClicks,
        addConv,
        addSpend,
        addRev,
        isEmail ? Math.floor(addImp * 0.4) : 0,
        isEmail ? addClicks : 0
      );
    }
  }

  const updatedRows = db
    .prepare('SELECT * FROM analytics_daily WHERE client_id = ? ORDER BY metric_date ASC')
    .all(clientId);
  res.json({ rows: updatedRows, syncedAt: new Date().toISOString() });
});

// Monthly Automated Client Reports
app.get('/api/reports', (req, res) => {
  const clientId = String(req.query.clientId || '');
  const rows = db
    .prepare('SELECT * FROM reports WHERE client_id = ? ORDER BY created_at DESC')
    .all(clientId) as Record<string, unknown>[];
  res.json(rows.map(mapReportRow));
});

app.post('/api/reports/generate', requirePermission('generateReports'), async (req, res) => {
  try {
    const { clientId, periodLabel } = req.body;
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as Record<string, string> | undefined;
    if (!client) {
      res.status(404).json({ error: 'Client not found.' });
      return;
    }

    const analytics = db
      .prepare('SELECT * FROM analytics_daily WHERE client_id = ?')
      .all(clientId) as Array<Record<string, unknown>>;

    let impressions = 0;
    let views3s = 0;
    let completions = 0;
    let clicks = 0;
    let conversions = 0;
    let spend = 0;
    let revenue = 0;
    let emailOpens = 0;
    let emailClicks = 0;

    const platMap = new Map<string, { platform: string; impressions: number; clicks: number; conversions: number; revenue: number }>();

    for (const r of analytics) {
      const imp = Number(r.impressions || 0);
      const v3 = Number(r.views_3s || 0);
      const comp = Number(r.completions || 0);
      const clk = Number(r.clicks || 0);
      const conv = Number(r.conversions || 0);
      const sp = Number(r.spend || 0);
      const rev = Number(r.revenue || 0);

      impressions += imp;
      views3s += v3;
      completions += comp;
      clicks += clk;
      conversions += conv;
      spend += sp;
      revenue += rev;
      emailOpens += Number(r.email_opens || 0);
      emailClicks += Number(r.email_clicks || 0);

      const p = String(r.platform);
      const cur = platMap.get(p) || { platform: p, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
      cur.impressions += imp;
      cur.clicks += clk;
      cur.conversions += conv;
      cur.revenue = Number((cur.revenue + rev).toFixed(2));
      platMap.set(p, cur);
    }

    const snapshot = {
      impressions,
      views_3s: views3s,
      hook_rate: impressions > 0 ? Number(((views3s / impressions) * 100).toFixed(1)) : 0,
      completion_rate: views3s > 0 ? Number(((completions / views3s) * 100).toFixed(1)) : 0,
      clicks,
      ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      conversions,
      spend: Number(spend.toFixed(2)),
      revenue: Number(revenue.toFixed(2)),
      roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : 0,
      email_opens: emailOpens,
      email_clicks: emailClicks,
      by_platform: Array.from(platMap.values()).sort((a, b) => b.revenue - a.revenue),
    };

    const label = periodLabel?.trim() || `${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })} Executive Review`;
    const narrative = await generateMonthlyReportNarrative({
      clientName: client.name,
      industry: client.industry,
      periodLabel: label,
      metricsSummary: snapshot,
    });

    const id = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO reports (id, client_id, period_label, summary_markdown, highlights_json, recommendations_json, metrics_snapshot_json, delivery_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Ready to Send', ?)
    `).run(
      id,
      clientId,
      label,
      narrative.summaryMarkdown,
      JSON.stringify(narrative.highlights),
      JSON.stringify(narrative.recommendations),
      JSON.stringify(snapshot),
      now
    );

    logAudit(getActiveRole(req).key, 'report.generated', 'report', id, `Generated AI monthly performance report for ${client.name}`);
    const created = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json(mapReportRow(created));
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

app.post('/api/reports/:id/send', requirePermission('generateReports'), (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id) as Record<string, string> | undefined;
  if (!report) {
    res.status(404).json({ error: 'Report not found.' });
    return;
  }
  const client = db.prepare('SELECT report_recipients FROM clients WHERE id = ?').get(report.client_id) as { report_recipients: string } | undefined;
  const count = (client?.report_recipients || '').split(',').filter((x) => x.trim()).length || 1;
  const status = `Dispatched to ${count} recipient${count === 1 ? '' : 's'} · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  db.prepare('UPDATE reports SET delivery_status = ? WHERE id = ?').run(status, req.params.id);
  logAudit(getActiveRole(req).key, 'report.dispatched', 'report', req.params.id, status);
  const updated = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  res.json(mapReportRow(updated));
});

// Team & RBAC Management
app.get('/api/team', (_req, res) => {
  res.json(db.prepare('SELECT * FROM team_members ORDER BY name ASC').all());
});

app.post('/api/team', requirePermission('manageClientsTeam'), (req, res) => {
  const { name, email, role = 'producer', client_access = 'All Client Accounts' } = req.body;
  if (!name?.trim() || !email?.trim()) {
    res.status(400).json({ error: 'Name and email are required.' });
    return;
  }
  const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO team_members (id, name, email, role, avatar_url, client_access, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), email.trim(), role, '/src/assets/images/avatar_producer_1795390925185.jpg', client_access, now);

  logAudit(getActiveRole(req).key, 'team.invited', 'team_member', id, `Added ${name.trim()} with role ${role}`);
  res.status(201).json(db.prepare('SELECT * FROM team_members WHERE id = ?').get(id));
});

app.patch('/api/team/:id', requirePermission('manageClientsTeam'), (req, res) => {
  const { role, client_access } = req.body;
  if (role) {
    db.prepare('UPDATE team_members SET role = ? WHERE id = ?').run(role, req.params.id);
  }
  if (client_access) {
    db.prepare('UPDATE team_members SET client_access = ? WHERE id = ?').run(client_access, req.params.id);
  }
  logAudit(getActiveRole(req).key, 'team.role_updated', 'team_member', req.params.id, `Updated role/access to ${role || ''} ${client_access || ''}`.trim());
  res.json(db.prepare('SELECT * FROM team_members WHERE id = ?').get(req.params.id));
});

app.delete('/api/team/:id', requirePermission('manageClientsTeam'), (req, res) => {
  db.prepare('DELETE FROM team_members WHERE id = ?').run(req.params.id);
  logAudit(getActiveRole(req).key, 'team.removed', 'team_member', req.params.id, 'Removed team member');
  res.json({ deleted: true });
});

app.get('/api/audit', (_req, res) => {
  res.json(db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 40').all());
});

// Start Vite dev middleware or serve static build
async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Cadence Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
