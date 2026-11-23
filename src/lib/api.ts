import type {
  AdProject,
  AnalyticsDaily,
  AuditLogEntry,
  BrandTemplate,
  ChannelIntegration,
  ClientAccount,
  GitHubRepoSummary,
  MonthlyReport,
  ReviewComment,
  RoleDefinition,
  RoleKey,
  ScheduledPost,
  TeamMember,
} from '../types';

let currentRole: RoleKey = 'admin';

export function setApiRole(role: RoleKey) {
  currentRole = role;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'X-Active-Role': currentRole,
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || `Request failed (${res.status})` };
  }

  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  bootstrap: () =>
    request<{
      clients: ClientAccount[];
      templates: BrandTemplate[];
      team: TeamMember[];
      roles: Record<RoleKey, RoleDefinition>;
    }>('/api/bootstrap'),

  // Clients
  getClients: () => request<ClientAccount[]>('/api/clients'),
  createClient: (payload: Partial<ClientAccount>) =>
    request<ClientAccount>('/api/clients', { method: 'POST', body: JSON.stringify(payload) }),
  updateClient: (id: string, payload: Partial<ClientAccount>) =>
    request<ClientAccount>(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // Projects
  getProjects: (clientId: string) => request<AdProject[]>(`/api/projects?clientId=${encodeURIComponent(clientId)}`),
  createProject: (payload: Partial<AdProject>) =>
    request<AdProject>('/api/projects', { method: 'POST', body: JSON.stringify(payload) }),
  updateProject: (id: string, payload: Partial<AdProject>) =>
    request<AdProject>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteProject: (id: string) => request<{ deleted: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  uploadProjectMedia: (id: string, kind: 'image' | 'video' | 'audio', dataUrl: string) =>
    request<{ mediaUrl: string }>(`/api/projects/${id}/upload-media`, {
      method: 'POST',
      body: JSON.stringify({ kind, dataUrl }),
    }),

  // Comments
  getComments: (projectId: string) => request<ReviewComment[]>(`/api/projects/${projectId}/comments`),
  addComment: (projectId: string, body: string, timecode_sec: number) =>
    request<ReviewComment>(`/api/projects/${projectId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, timecode_sec }),
    }),
  toggleCommentResolved: (commentId: string, resolved: boolean) =>
    request<ReviewComment>(`/api/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved }),
    }),

  // Templates
  getTemplates: () => request<BrandTemplate[]>('/api/templates'),
  createTemplate: (payload: Partial<BrandTemplate>) =>
    request<BrandTemplate>('/api/templates', { method: 'POST', body: JSON.stringify(payload) }),
  updateTemplate: (id: string, payload: Partial<BrandTemplate>) =>
    request<BrandTemplate>(`/api/templates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // Ingestion
  ingestWebsite: (payload: { url: string; clientId: string; aspectRatio: '9:16' | '16:9'; goal?: string }) =>
    request<{
      project: AdProject;
      scrapedSummary: { title: string; description: string; headingsCount: number; ogImage: string | null };
      socialCaption: string;
      hashtags: string;
    }>('/api/ingest/website', { method: 'POST', body: JSON.stringify(payload) }),

  fetchGitHubRepos: (user: string, token?: string) =>
    request<GitHubRepoSummary[]>(`/api/ingest/github/repos?user=${encodeURIComponent(user)}`, {
      headers: token ? { 'X-GitHub-Token': token } : undefined,
    }),

  ingestGitHubRepo: (
    payload: { ownerRepo: string; clientId: string; aspectRatio: '9:16' | '16:9'; goal?: string },
    token?: string
  ) =>
    request<{
      project: AdProject;
      repoSummary: GitHubRepoSummary;
      socialCaption: string;
      hashtags: string;
    }>('/api/ingest/github/generate', {
      method: 'POST',
      headers: token ? { 'X-GitHub-Token': token } : undefined,
      body: JSON.stringify(payload),
    }),

  // AI Production
  regenerateScript: (payload: { projectId: string; brief: string; aspectRatio: '9:16' | '16:9' }) =>
    request<AdProject>('/api/ai/script', { method: 'POST', body: JSON.stringify(payload) }),

  generateVoiceover: (payload: {
    projectId: string;
    script: string;
    voiceName: string;
    style: string;
    dualSpeaker?: boolean;
    secondaryVoiceName?: string;
  }) =>
    request<{ audioUrl: string; filename: string; modelUsed: string }>('/api/ai/voiceover', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  generateOmniVideo: (payload: {
    projectId: string;
    prompt: string;
    aspectRatio: '16:9' | '9:16';
    durationSec?: number;
    previousInteractionId?: string | null;
  }) =>
    request<{ videoUrl: string; interactionId: string }>('/api/ai/video', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  generateLyriaMusic: (payload: { projectId: string; prompt: string }) =>
    request<{ audioUrl: string; lyrics: string }>('/api/ai/music', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Integrations
  getIntegrations: (clientId: string) =>
    request<ChannelIntegration[]>(`/api/integrations?clientId=${encodeURIComponent(clientId)}`),
  toggleIntegration: (id: string) =>
    request<ChannelIntegration>(`/api/integrations/${id}/toggle`, { method: 'POST' }),
  updateIntegration: (id: string, payload: Partial<ChannelIntegration>) =>
    request<ChannelIntegration>(`/api/integrations/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  syncIntegration: (id: string) =>
    request<ChannelIntegration>(`/api/integrations/${id}/sync`, { method: 'POST' }),

  // Scheduler
  getSchedule: (clientId: string) =>
    request<ScheduledPost[]>(`/api/scheduler?clientId=${encodeURIComponent(clientId)}`),
  createSchedule: (payload: {
    client_id: string;
    project_id: string;
    platform: string;
    scheduled_for: string;
    caption: string;
    hashtags: string;
  }) => request<ScheduledPost>('/api/scheduler', { method: 'POST', body: JSON.stringify(payload) }),
  publishPostNow: (id: string) =>
    request<{ post: ScheduledPost; webhookDispatched: boolean }>(`/api/scheduler/${id}/publish`, { method: 'POST' }),
  deleteSchedule: (id: string) => request<{ deleted: boolean }>(`/api/scheduler/${id}`, { method: 'DELETE' }),

  // Analytics
  getAnalytics: (clientId: string, days = 21) =>
    request<AnalyticsDaily[]>(`/api/analytics?clientId=${encodeURIComponent(clientId)}&days=${days}`),
  pulseAnalytics: (clientId: string) =>
    request<{ rows: AnalyticsDaily[]; syncedAt: string }>('/api/analytics/pulse', {
      method: 'POST',
      body: JSON.stringify({ clientId }),
    }),

  // Reports
  getReports: (clientId: string) =>
    request<MonthlyReport[]>(`/api/reports?clientId=${encodeURIComponent(clientId)}`),
  generateReport: (clientId: string, periodLabel?: string) =>
    request<MonthlyReport>('/api/reports/generate', {
      method: 'POST',
      body: JSON.stringify({ clientId, periodLabel }),
    }),
  sendReport: (reportId: string) =>
    request<MonthlyReport>(`/api/reports/${reportId}/send`, { method: 'POST' }),

  // Team & Audit
  getTeam: () => request<TeamMember[]>('/api/team'),
  addTeamMember: (payload: { name: string; email: string; role: RoleKey; client_access: string }) =>
    request<TeamMember>('/api/team', { method: 'POST', body: JSON.stringify(payload) }),
  updateTeamMember: (id: string, payload: { role?: RoleKey; client_access?: string }) =>
    request<TeamMember>(`/api/team/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteTeamMember: (id: string) => request<{ deleted: boolean }>(`/api/team/${id}`, { method: 'DELETE' }),
  getAuditLogs: () => request<AuditLogEntry[]>('/api/audit'),
};
