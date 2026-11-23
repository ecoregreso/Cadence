import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Building2,
  CalendarClock,
  FileBarChart2,
  Film,
  Layers,
  Loader2,
  Plus,
  Shield,
} from 'lucide-react';
import { AnalyticsView } from './components/AnalyticsView';
import { ClientsTeamView } from './components/ClientsTeamView';
import { ReportsView } from './components/ReportsView';
import { SchedulerView } from './components/SchedulerView';
import { StudioView } from './components/StudioView';
import { TemplatesView } from './components/TemplatesView';
import { api, setApiRole } from './lib/api';
import type {
  ActiveTab,
  AdProject,
  AnalyticsDaily,
  BrandTemplate,
  ChannelIntegration,
  ClientAccount,
  MonthlyReport,
  RoleDefinition,
  RoleKey,
  ScheduledPost,
  TeamMember,
} from './types';

interface ToastMessage {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'studio', label: 'Studio', icon: Film },
  { id: 'templates', label: 'Templates', icon: Layers },
  { id: 'scheduler', label: 'Scheduler', icon: CalendarClock },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'reports', label: 'Reports', icon: FileBarChart2 },
  { id: 'clients', label: 'Clients & Team', icon: Building2 },
];

export default function App() {
  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  const [clients, setClients] = useState<ClientAccount[]>([]);
  const [activeClientId, setActiveClientId] = useState<string>('');
  const [templates, setTemplates] = useState<BrandTemplate[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<Record<RoleKey, RoleDefinition> | null>(null);
  const [activeRoleKey, setActiveRoleKey] = useState<RoleKey>('admin');

  const [activeTab, setActiveTab] = useState<ActiveTab>('studio');
  const [openIngestSignal, setOpenIngestSignal] = useState(0);

  // Client-scoped datasets
  const [projects, setProjects] = useState<AdProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<ChannelIntegration[]>([]);
  const [schedule, setSchedule] = useState<ScheduledPost[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsDaily[]>([]);
  const [reports, setReports] = useState<MonthlyReport[]>([]);
  const [clientDataLoading, setClientDataLoading] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((text: string, tone: 'info' | 'success' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { id, text, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // Bootstrap workspace
  useEffect(() => {
    setApiRole(activeRoleKey);
    api
      .bootstrap()
      .then((data) => {
        setClients(data.clients);
        setTemplates(data.templates);
        setTeam(data.team);
        setRoles(data.roles);
        if (data.clients[0]) {
          setActiveClientId(data.clients[0].id);
        }
        setBootLoading(false);
      })
      .catch((err) => {
        setBootError(err instanceof Error ? err.message : 'Unable to load workspace.');
        setBootLoading(false);
      });
  }, []);

  // Sync role header when switched
  const handleRoleSwitch = (nextRole: RoleKey) => {
    setActiveRoleKey(nextRole);
    setApiRole(nextRole);
    if (roles?.[nextRole]) {
      notify(`Switched active role preset to ${roles[nextRole].label}.`, 'info');
    }
  };

  // Load client-scoped data when client changes
  useEffect(() => {
    if (!activeClientId) return;
    setClientDataLoading(true);
    Promise.all([
      api.getProjects(activeClientId),
      api.getIntegrations(activeClientId),
      api.getSchedule(activeClientId),
      api.getAnalytics(activeClientId, 21),
      api.getReports(activeClientId),
    ])
      .then(([prjs, intgs, sched, anl, reps]) => {
        setProjects(prjs);
        setSelectedProjectId(prjs[0]?.id || null);
        setIntegrations(intgs);
        setSchedule(sched);
        setAnalytics(anl);
        setReports(reps);
      })
      .catch((err) => {
        notify(err instanceof Error ? err.message : 'Failed to load client workspace.', 'error');
      })
      .finally(() => setClientDataLoading(false));
  }, [activeClientId, notify]);

  if (bootLoading) {
    return (
      <div className="min-h-screen bg-[#0B0D12] flex flex-col items-center justify-center text-slate-300 gap-3">
        <Loader2 className="w-7 h-7 text-amber-400 animate-spin" />
        <div className="text-sm font-medium">Loading Cadence Studio...</div>
      </div>
    );
  }

  if (bootError || !roles) {
    return (
      <div className="min-h-screen bg-[#0B0D12] flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md p-6 rounded-xl bg-[#12161F] border border-white/[0.1] space-y-3">
          <h1 className="text-lg font-semibold text-slate-100">Workspace Connection Issue</h1>
          <p className="text-xs text-slate-400">{bootError || 'Server did not return workspace configuration.'}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const activeClient = clients.find((c) => c.id === activeClientId) || clients[0];
  const activeRole = roles[activeRoleKey];
  const activeProject = projects.find((p) => p.id === selectedProjectId) || projects[0] || null;
  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeTab) || NAV_ITEMS[0];

  const handleApplyTemplateToCurrent = async (templateId: string) => {
    if (!activeProject) return;
    try {
      const updated = await api.updateProject(activeProject.id, { template_id: templateId });
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      notify('Applied brand template to active video cut.', 'success');
      setActiveTab('studio');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to apply template.', 'error');
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0B0D12] text-[#F1F5F9] flex">
      {/* LEFT SIDEBAR (248px Desktop Workspace Rail) */}
      <aside className="w-[248px] shrink-0 bg-[#12161F] border-r border-white/[0.08] flex flex-col justify-between no-print">
        <div className="flex flex-col min-h-0">
          {/* Brand Wordmark */}
          <div className="h-14 px-5 flex items-center border-b border-white/[0.08]">
            <button
              onClick={() => setActiveTab('studio')}
              className="text-base font-bold tracking-tight text-slate-100 font-display whitespace-nowrap shrink-0"
            >
              Cadence Studio
            </button>
          </div>

          {/* Client Account Switcher */}
          <div className="p-4 border-b border-white/[0.08]">
            <label htmlFor="client-select" className="block text-[11px] font-medium text-slate-400 mb-1.5">
              Client Account
            </label>
            <select
              id="client-select"
              value={activeClient?.id || ''}
              onChange={(e) => setActiveClientId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs font-medium text-slate-100 focus:outline-none focus:border-amber-500/60"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {activeClient && (
              <div className="text-[11px] text-slate-500 mt-1.5 truncate">{activeClient.industry}</div>
            )}
          </div>

          {/* Primary Navigation */}
          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-[#181D29] text-amber-400'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.03]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Switchable RBAC Role Preset Switcher */}
        <div className="p-4 border-t border-white/[0.08] bg-[#0E121A] space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <Shield className="w-3.5 h-3.5 text-amber-400" />
              Active Role Preset
            </span>
          </div>
          <select
            aria-label="Switch active role preset"
            value={activeRoleKey}
            onChange={(e) => handleRoleSwitch(e.target.value as RoleKey)}
            className="w-full px-2.5 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs font-medium text-slate-100 focus:outline-none focus:border-amber-500/60"
          >
            {Object.values(roles).map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 leading-snug">{activeRole.description}</p>
        </div>
      </aside>

      {/* RIGHT WORKSPACE VIEWPORT */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Contextual Top Bar (SaaS Contract: Breadcrumb left + 1 Primary CTA right) */}
        <header className="h-14 shrink-0 px-6 border-b border-white/[0.08] bg-[#0B0D12] flex items-center justify-between gap-8 no-print">
          <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
            <span className="truncate text-slate-300 font-medium">{activeClient?.name}</span>
            <span aria-hidden="true">/</span>
            <span className="text-slate-100 font-medium whitespace-nowrap shrink-0">{activeNavMeta.label}</span>
            {clientDataLoading && <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin ml-2 shrink-0" />}
          </div>

          <button
            onClick={() => {
              setActiveTab('studio');
              setOpenIngestSignal((n) => n + 1);
            }}
            disabled={!activeRole.permissions.generateMedia}
            title={!activeRole.permissions.generateMedia ? `Locked for ${activeRole.label}` : 'Create a new video ad'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Video Ad
          </button>
        </header>

        {/* Active Module Content */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          {activeClient && activeTab === 'studio' && (
            <StudioView
              client={activeClient}
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
              onProjectsChange={setProjects}
              templates={templates}
              role={activeRole}
              onNotify={notify}
              onJumpToScheduler={(pid) => {
                setSelectedProjectId(pid);
                setActiveTab('scheduler');
              }}
              openIngestSignal={openIngestSignal}
            />
          )}

          {activeClient && activeTab === 'templates' && (
            <TemplatesView
              client={activeClient}
              templates={templates}
              onTemplatesChange={setTemplates}
              activeProject={activeProject}
              onApplyTemplate={handleApplyTemplateToCurrent}
              role={activeRole}
              onNotify={notify}
            />
          )}

          {activeClient && activeTab === 'scheduler' && (
            <SchedulerView
              client={activeClient}
              projects={projects}
              integrations={integrations}
              schedule={schedule}
              onScheduleChange={setSchedule}
              defaultProjectId={selectedProjectId}
              role={activeRole}
              onNotify={notify}
            />
          )}

          {activeClient && activeTab === 'analytics' && (
            <AnalyticsView
              client={activeClient}
              analytics={analytics}
              onAnalyticsChange={setAnalytics}
              integrations={integrations}
              onNotify={notify}
            />
          )}

          {activeClient && activeTab === 'reports' && (
            <ReportsView
              client={activeClient}
              reports={reports}
              onReportsChange={setReports}
              onClientUpdated={(updated) => setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))}
              role={activeRole}
              onNotify={notify}
            />
          )}

          {activeClient && activeTab === 'clients' && (
            <ClientsTeamView
              clients={clients}
              activeClient={activeClient}
              onClientsChange={setClients}
              onSelectClient={setActiveClientId}
              integrations={integrations}
              onIntegrationsChange={setIntegrations}
              team={team}
              onTeamChange={setTeam}
              roles={roles}
              activeRole={activeRole}
              onNotify={notify}
            />
          )}
        </main>
      </div>

      {/* Toast Notification Stack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-5 right-5 z-50 space-y-2 max-w-sm no-print">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`px-4 py-3 rounded-lg border text-xs font-medium shadow-xl ${
                t.tone === 'error'
                  ? 'bg-[#1D1216] border-rose-500/40 text-rose-200'
                  : t.tone === 'success'
                  ? 'bg-[#111C18] border-emerald-500/40 text-emerald-200'
                  : 'bg-[#181D29] border-white/[0.14] text-slate-100'
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
