export type RoleKey = 'admin' | 'producer' | 'reviewer' | 'analyst';

export interface RoleDefinition {
  key: RoleKey;
  label: string;
  shortLabel: string;
  description: string;
  permissions: {
    editProjects: boolean;
    generateMedia: boolean;
    approveProjects: boolean;
    schedulePublish: boolean;
    manageIntegrations: boolean;
    manageClientsTeam: boolean;
    generateReports: boolean;
    viewAnalytics: boolean;
    comment: boolean;
  };
}

export interface ClientAccount {
  id: string;
  name: string;
  industry: string;
  website: string;
  github_org: string;
  brand_primary: string;
  brand_accent: string;
  font_style: string;
  aws_region: string;
  aws_s3_bucket: string;
  aws_replication_mode: string;
  report_day_of_month: number;
  report_recipients: string;
  created_at: string;
}

export interface AdScene {
  id: string;
  index: number;
  startSec: number;
  durationSec: number;
  headline: string;
  subtitle: string;
  visualPrompt: string;
  motion: 'zoom-in' | 'pan-right' | 'zoom-out' | 'pan-left';
  imageUrl?: string;
}

export type ProjectStatus = 'Draft' | 'In Review' | 'Approved' | 'Scheduled' | 'Published';

export interface AdProject {
  id: string;
  client_id: string;
  title: string;
  source_type: 'website' | 'github' | 'manual';
  source_url: string;
  aspect_ratio: '9:16' | '16:9';
  duration_sec: number;
  status: ProjectStatus;
  template_id: string;
  scenes: AdScene[];
  voiceover_script: string;
  voiceover_voice: string;
  voiceover_style: string;
  voiceover_url: string | null;
  music_track_id: string;
  music_url: string | null;
  music_volume: number;
  voice_volume: number;
  video_clip_url: string | null;
  video_interaction_id: string | null;
  hero_image_url: string;
  cta_text: string;
  cta_url: string;
  caption_style: 'kinetic' | 'minimal' | 'broadcast' | 'none';
  updated_at: string;
  created_at: string;
}

export interface BrandTemplate {
  id: string;
  client_id: string | null;
  name: string;
  category: string;
  aspect_ratio: '9:16' | '16:9';
  bg_color: string;
  accent_color: string;
  text_color: string;
  font_display: string;
  overlay_style: 'cinema-bars' | 'kinetic-bold' | 'editorial-minimal' | 'tech-hud';
  motion_preset: 'slow-push' | 'snappy-cut' | 'ambient-drift';
  lower_third_style: 'bar' | 'underline' | 'glass-strip';
  preview_image: string;
  is_system: number;
}

export interface ChannelIntegration {
  id: string;
  client_id: string;
  platform: string;
  category: 'social' | 'email';
  connected: number;
  account_handle: string;
  webhook_url: string;
  auto_sync: number;
  last_sync_at: string | null;
  followers_count: number;
}

export interface ScheduledPost {
  id: string;
  client_id: string;
  project_id: string;
  project_title?: string;
  platform: string;
  scheduled_for: string;
  caption: string;
  hashtags: string;
  status: 'Queued' | 'Published' | 'Failed';
  published_at: string | null;
  external_url: string | null;
}

export interface AnalyticsDaily {
  id: string;
  client_id: string;
  project_id: string | null;
  platform: string;
  metric_date: string;
  impressions: number;
  views_3s: number;
  completions: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue: number;
  email_opens: number;
  email_clicks: number;
}

export interface ReviewComment {
  id: string;
  project_id: string;
  author_name: string;
  author_role: string;
  timecode_sec: number;
  body: string;
  resolved: number;
  created_at: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: RoleKey;
  avatar_url: string;
  client_access: string;
  last_active_at: string;
}

export interface MonthlyReport {
  id: string;
  client_id: string;
  period_label: string;
  summary_markdown: string;
  highlights: string[];
  recommendations: string[];
  metrics_snapshot: {
    impressions: number;
    views_3s: number;
    hook_rate: number;
    completion_rate: number;
    clicks: number;
    ctr: number;
    conversions: number;
    spend: number;
    revenue: number;
    roas: number;
    email_opens: number;
    email_clicks: number;
    by_platform: Array<{
      platform: string;
      impressions: number;
      clicks: number;
      conversions: number;
      revenue: number;
    }>;
  };
  delivery_status: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  details: string;
  created_at: string;
}

export interface GitHubRepoSummary {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  topics: string[];
  homepage: string | null;
  html_url: string;
  updated_at: string;
}

export type ActiveTab = 'studio' | 'templates' | 'scheduler' | 'analytics' | 'reports' | 'clients';
