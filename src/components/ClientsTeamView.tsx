import React, { useEffect, useState } from 'react';
import {
  Building2,
  Check,
  Cloud,
  Download,
  Link2,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  AuditLogEntry,
  ChannelIntegration,
  ClientAccount,
  RoleDefinition,
  RoleKey,
  TeamMember,
} from '../types';

interface ClientsTeamViewProps {
  clients: ClientAccount[];
  activeClient: ClientAccount;
  onClientsChange: (clients: ClientAccount[]) => void;
  onSelectClient: (id: string) => void;
  integrations: ChannelIntegration[];
  onIntegrationsChange: (list: ChannelIntegration[]) => void;
  team: TeamMember[];
  onTeamChange: (list: TeamMember[]) => void;
  roles: Record<RoleKey, RoleDefinition>;
  activeRole: RoleDefinition;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'error') => void;
}

export function ClientsTeamView({
  clients,
  activeClient,
  onClientsChange,
  onSelectClient,
  integrations,
  onIntegrationsChange,
  team,
  onTeamChange,
  roles,
  activeRole,
  onNotify,
}: ClientsTeamViewProps) {
  const [subTab, setSubTab] = useState<'integrations' | 'clients' | 'team' | 'cloud'>('integrations');
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // New Client Form
  const [newClientName, setNewClientName] = useState('');
  const [newClientIndustry, setNewClientIndustry] = useState('');
  const [newClientWebsite, setNewClientWebsite] = useState('');
  const [newClientGithub, setNewClientGithub] = useState('');

  // New Team Member Form
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<RoleKey>('producer');

  // AWS Cloud Config Form
  const [awsRegion, setAwsRegion] = useState(activeClient.aws_region || 'us-east-1');
  const [awsBucket, setAwsBucket] = useState(activeClient.aws_s3_bucket || '');
  const [awsMode, setAwsMode] = useState(activeClient.aws_replication_mode || 'Multi-AZ Active-Active');

  useEffect(() => {
    setAwsRegion(activeClient.aws_region || 'us-east-1');
    setAwsBucket(activeClient.aws_s3_bucket || '');
    setAwsMode(activeClient.aws_replication_mode || 'Multi-AZ Active-Active');
  }, [activeClient]);

  useEffect(() => {
    if (subTab === 'team') {
      api.getAuditLogs().then(setAuditLogs).catch(() => {});
    }
  }, [subTab]);

  const handleToggleIntegration = async (id: string) => {
    try {
      const updated = await api.toggleIntegration(id);
      onIntegrationsChange(integrations.map((i) => (i.id === id ? updated : i)));
      onNotify(
        updated.connected
          ? `Automatically connected ${updated.platform} — streaming data into dashboard.`
          : `Disconnected ${updated.platform}.`,
        updated.connected ? 'success' : 'info'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update connection.', 'error');
    }
  };

  const handleConnectAll = async () => {
    const disconnected = integrations.filter((i) => !i.connected);
    if (disconnected.length === 0) {
      onNotify('All social and email channels are already connected.', 'info');
      return;
    }
    try {
      const updatedMap = new Map(integrations.map((i) => [i.id, i]));
      for (const item of disconnected) {
        const res = await api.toggleIntegration(item.id);
        updatedMap.set(res.id, res);
      }
      onIntegrationsChange(Array.from(updatedMap.values()));
      onNotify(`Auto-connected ${disconnected.length} channels with zero manual setup.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to connect all channels.', 'error');
    }
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) return;
    try {
      const created = await api.createClient({
        name: newClientName.trim(),
        industry: newClientIndustry.trim() || 'SaaS & Consumer Tech',
        website: newClientWebsite.trim(),
        github_org: newClientGithub.trim(),
      });
      onClientsChange([...clients, created]);
      onSelectClient(created.id);
      setNewClientName('');
      setNewClientIndustry('');
      setNewClientWebsite('');
      setNewClientGithub('');
      onNotify(`Created isolated client workspace for ${created.name}.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to create client.', 'error');
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberName.trim() || !memberEmail.trim()) return;
    try {
      const created = await api.addTeamMember({
        name: memberName.trim(),
        email: memberEmail.trim(),
        role: memberRole,
        client_access: memberRole === 'reviewer' ? activeClient.name : `All Client Accounts (${clients.length})`,
      });
      onTeamChange([...team, created]);
      setMemberName('');
      setMemberEmail('');
      onNotify(`Invited ${created.name} as ${roles[created.role].label}.`, 'success');
      api.getAuditLogs().then(setAuditLogs).catch(() => {});
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to add team member.', 'error');
    }
  };

  const handleSaveAwsConfig = async () => {
    try {
      const updated = await api.updateClient(activeClient.id, {
        aws_region: awsRegion,
        aws_s3_bucket: awsBucket,
        aws_replication_mode: awsMode,
      });
      onClientsChange(clients.map((c) => (c.id === updated.id ? updated : c)));
      onNotify('Saved AWS S3 & Multi-AZ redundancy configuration.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update cloud settings.', 'error');
    }
  };

  const handleExportAwsBlueprint = () => {
    const blueprint = {
      service: 'Cadence Studio Video & Analytics Pipeline',
      client: activeClient.name,
      infrastructure_provider: 'AWS',
      storage: {
        s3_media_bucket: awsBucket || `${activeClient.id}-ad-masters`,
        primary_region: awsRegion,
        replication: awsMode,
        encryption: 'AES-256 / AWS KMS CMK',
        cdn: 'Amazon CloudFront (Signed URLs)',
      },
      database: {
        engine: 'Amazon RDS PostgreSQL Multi-AZ',
        backup_retention_days: 35,
        point_in_time_recovery: true,
      },
      connected_webhooks: integrations
        .filter((i) => i.connected)
        .map((i) => ({ platform: i.platform, handle: i.account_handle, webhook: i.webhook_url || 'managed-sandbox' })),
    };

    const blob = new Blob([JSON.stringify(blueprint, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeClient.name.toLowerCase().replace(/\s+/g, '-')}-aws-blueprint.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    onNotify('Exported AWS Cloud Redundancy manifest JSON.', 'success');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Clients, Integrations & Governance</h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage multi-client accounts, automated social & email connections, role-based access control, and cloud redundancy.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#12161F] border border-white/[0.08]">
          {(
            [
              { id: 'integrations', label: 'API Integrations', icon: Link2 },
              { id: 'clients', label: `Clients (${clients.length})`, icon: Building2 },
              { id: 'team', label: 'Team & RBAC', icon: Shield },
              { id: 'cloud', label: 'AWS Cloud', icon: Cloud },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  subTab === tab.id ? 'bg-[#181D29] text-amber-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* SUBTAB 1: AUTOMATED INTEGRATIONS HUB */}
      {subTab === 'integrations' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#12161F] border border-white/[0.08]">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Zero-Config Automated Channel Connectors</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Link social media and email marketing accounts for {activeClient.name} with one click—no manual OAuth credential setup required.
              </p>
            </div>
            <button
              onClick={handleConnectAll}
              disabled={!activeRole.permissions.manageIntegrations}
              className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              Auto-Connect All Channels
            </button>
          </div>

          {!activeRole.permissions.manageIntegrations && (
            <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 px-4 py-2.5 rounded-lg">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              Integration credentials and webhook endpoints are protected by RBAC. Switch to Agency Admin to modify connections.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {integrations.map((intg) => (
              <div
                key={intg.id}
                className="p-4 rounded-xl bg-[#12161F] border border-white/[0.08] space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{intg.platform}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {intg.category === 'social' ? 'Social Video Platform' : 'Email Marketing Service'} ·{' '}
                      <span className="font-mono text-slate-300">{intg.account_handle}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleIntegration(intg.id)}
                    disabled={!activeRole.permissions.manageIntegrations}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                      intg.connected
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20'
                        : 'bg-[#181D29] border-white/[0.12] text-slate-200 hover:border-amber-500/50'
                    } disabled:opacity-40`}
                  >
                    {intg.connected ? 'Connected' : 'One-Click Connect'}
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums pt-2 border-t border-white/[0.06]">
                  <span>Audience: {intg.followers_count.toLocaleString()}</span>
                  <button
                    disabled={!intg.connected || !activeRole.permissions.manageIntegrations}
                    onClick={async () => {
                      const synced = await api.syncIntegration(intg.id);
                      onIntegrationsChange(integrations.map((item) => (item.id === intg.id ? synced : item)));
                      onNotify(`Synced latest metrics from ${intg.platform}.`, 'info');
                    }}
                    className="inline-flex items-center gap-1 text-slate-300 hover:text-amber-400 disabled:opacity-40"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Sync
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Optional Outbound Webhook URL (Live Dispatch)</label>
                  <input
                    type="url"
                    defaultValue={intg.webhook_url}
                    disabled={!activeRole.permissions.manageIntegrations}
                    placeholder="https://hooks.zapier.com/..."
                    onBlur={async (e) => {
                      if (e.target.value !== intg.webhook_url) {
                        const updated = await api.updateIntegration(intg.id, { webhook_url: e.target.value });
                        onIntegrationsChange(integrations.map((item) => (item.id === intg.id ? updated : item)));
                        onNotify(`Updated webhook endpoint for ${intg.platform}.`, 'success');
                      }
                    }}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0B0D12] border border-white/[0.08] text-xs font-mono text-slate-300 disabled:opacity-40"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUBTAB 2: MULTI-CLIENT ACCOUNTS */}
      {subTab === 'clients' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-3">
            {clients.map((cli) => {
              const isCurrent = cli.id === activeClient.id;
              return (
                <div
                  key={cli.id}
                  className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
                    isCurrent ? 'bg-[#181D29] border-amber-500/50' : 'bg-[#12161F] border-white/[0.08]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: cli.brand_accent }} />
                      <h3 className="text-sm font-semibold text-slate-100 truncate">{cli.name}</h3>
                    </div>
                    <div className="text-xs text-slate-400 mt-1 truncate">
                      {cli.industry} · {cli.website || 'No URL set'} {cli.github_org ? `· github.com/${cli.github_org}` : ''}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 mt-1">
                      AWS S3: {cli.aws_s3_bucket || 'unconfigured'} ({cli.aws_region})
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      onSelectClient(cli.id);
                      onNotify(`Switched active agency workspace to ${cli.name}.`, 'info');
                    }}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                      isCurrent
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                        : 'bg-[#0B0D12] text-slate-200 border border-white/[0.1] hover:border-amber-500/50'
                    }`}
                  >
                    {isCurrent ? 'Active Workspace' : 'Open Account'}
                  </button>
                </div>
              );
            })}
          </div>

          <form
            onSubmit={handleCreateClient}
            className="lg:col-span-5 p-5 rounded-xl bg-[#12161F] border border-white/[0.08] space-y-3.5 self-start"
          >
            <h2 className="text-sm font-semibold text-slate-100">Onboard New Client Account</h2>
            <p className="text-xs text-slate-400">
              Automatically provisions isolated ad projects, channel connectors, analytics, and report schedules.
            </p>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Company Name</label>
              <input
                type="text"
                required
                disabled={!activeRole.permissions.manageClientsTeam}
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Northstar Robotics"
                className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm text-slate-100 disabled:opacity-40"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Industry</label>
              <input
                type="text"
                disabled={!activeRole.permissions.manageClientsTeam}
                value={newClientIndustry}
                onChange={(e) => setNewClientIndustry(e.target.value)}
                placeholder="Industrial Hardware & AI"
                className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm text-slate-100 disabled:opacity-40"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Website URL (for one-click scraping)</label>
              <input
                type="url"
                disabled={!activeRole.permissions.manageClientsTeam}
                value={newClientWebsite}
                onChange={(e) => setNewClientWebsite(e.target.value)}
                placeholder="https://northstar.example.com"
                className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm text-slate-100 disabled:opacity-40"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">GitHub Organization (optional)</label>
              <input
                type="text"
                disabled={!activeRole.permissions.manageClientsTeam}
                value={newClientGithub}
                onChange={(e) => setNewClientGithub(e.target.value)}
                placeholder="northstar-robotics"
                className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm font-mono text-slate-100 disabled:opacity-40"
              />
            </div>
            <button
              type="submit"
              disabled={!activeRole.permissions.manageClientsTeam}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Client Workspace
            </button>
          </form>
        </div>
      )}

      {/* SUBTAB 3: TEAM & RBAC ACCESS CONTROL */}
      {subTab === 'team' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 rounded-xl bg-[#12161F] border border-white/[0.08] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Users className="w-4 h-4 text-amber-400" />
                  Agency & Client Team Roster
                </h2>
                <span className="text-xs text-slate-400 font-mono">{team.length} members</span>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {team.map((member) => (
                  <div key={member.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={member.avatar_url}
                        alt={member.name}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-lg object-cover border border-white/[0.1] shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-100 truncate">{member.name}</div>
                        <div className="text-xs text-slate-400 truncate">
                          {member.email} · {member.client_access}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <select
                        value={member.role}
                        disabled={!activeRole.permissions.manageClientsTeam}
                        onChange={async (e) => {
                          try {
                            const updated = await api.updateTeamMember(member.id, { role: e.target.value as RoleKey });
                            onTeamChange(team.map((m) => (m.id === member.id ? updated : m)));
                            onNotify(`Updated ${member.name}'s role to ${roles[updated.role].label}.`, 'success');
                          } catch (err) {
                            onNotify(err instanceof Error ? err.message : 'Unable to update role.', 'error');
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-200 disabled:opacity-40"
                      >
                        {Object.values(roles).map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={!activeRole.permissions.manageClientsTeam || team.length <= 1}
                        onClick={async () => {
                          await api.deleteTeamMember(member.id);
                          onTeamChange(team.filter((m) => m.id !== member.id));
                          onNotify(`Removed ${member.name} from workspace.`, 'info');
                        }}
                        className="text-slate-500 hover:text-rose-400 disabled:opacity-30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleAddMember}
              className="lg:col-span-4 p-5 rounded-xl bg-[#12161F] border border-white/[0.08] space-y-3.5 self-start"
            >
              <h2 className="text-sm font-semibold text-slate-100">Add Team Collaborator</h2>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  disabled={!activeRole.permissions.manageClientsTeam}
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder="Jordan Rivera"
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100 disabled:opacity-40"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Work Email</label>
                <input
                  type="email"
                  required
                  disabled={!activeRole.permissions.manageClientsTeam}
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  placeholder="jordan@agency.co"
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100 disabled:opacity-40"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Assigned RBAC Role</label>
                <select
                  value={memberRole}
                  disabled={!activeRole.permissions.manageClientsTeam}
                  onChange={(e) => setMemberRole(e.target.value as RoleKey)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100 disabled:opacity-40"
                >
                  {Object.values(roles).map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={!activeRole.permissions.manageClientsTeam}
                className="w-full py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-40"
              >
                Grant Role Access
              </button>
            </form>
          </div>

          {/* RBAC Permission Matrix */}
          <div className="rounded-xl bg-[#12161F] border border-white/[0.08] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/[0.08]">
              <h2 className="text-sm font-semibold text-slate-100">Server-Enforced Role Permission Matrix</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] text-slate-400">
                    <th className="py-3 px-5">Capability</th>
                    {Object.values(roles).map((r) => (
                      <th key={r.key} className="py-3 px-4 text-center">
                        <span className={r.key === activeRole.key ? 'text-amber-400 font-semibold' : ''}>{r.label}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {(
                    [
                      ['editProjects', 'Edit Video Timeline & Brand Templates'],
                      ['generateMedia', 'Scrape URLs / GitHub & Generate AI Audio/Video'],
                      ['approveProjects', 'Approve Final Client Cut'],
                      ['schedulePublish', 'Schedule & Publish to Social / Email Channels'],
                      ['manageIntegrations', 'Configure API Connections & Webhooks'],
                      ['manageClientsTeam', 'Manage Clients, Team Roles & AWS Infrastructure'],
                      ['generateReports', 'Generate & Dispatch Monthly Reports'],
                    ] as Array<[keyof RoleDefinition['permissions'], string]>
                  ).map(([permKey, label]) => (
                    <tr key={permKey}>
                      <td className="py-2.5 px-5 text-slate-200">{label}</td>
                      {Object.values(roles).map((r) => (
                        <td key={r.key} className="py-2.5 px-4 text-center">
                          {r.permissions[permKey] ? (
                            <Check className="w-4 h-4 text-emerald-400 mx-auto" />
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Security Audit Trail */}
          <div className="rounded-xl bg-[#12161F] border border-white/[0.08] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/[0.08]">
              <h2 className="text-sm font-semibold text-slate-100">Recent RBAC Security Audit Log</h2>
            </div>
            <div className="divide-y divide-white/[0.06] max-h-60 overflow-y-auto text-xs">
              {auditLogs.map((log) => (
                <div key={log.id} className="px-5 py-2.5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <span className="font-mono text-amber-400 mr-2">{log.actor_role}</span>
                    <span className="text-slate-200">{log.details}</span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap shrink-0">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 4: AWS CLOUD REDUNDANCY & STORAGE BLUEPRINT */}
      {subTab === 'cloud' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 p-5 rounded-xl bg-[#12161F] border border-white/[0.08] space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">AWS Media Storage & Data Redundancy Configuration</h2>
              <p className="text-xs text-slate-400 mt-1">
                Configure target AWS S3 bucket, regional failover, and CloudFront distribution parameters for {activeClient.name}.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Primary AWS Region</label>
                <select
                  value={awsRegion}
                  disabled={!activeRole.permissions.manageClientsTeam}
                  onChange={(e) => setAwsRegion(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs font-mono text-slate-100 disabled:opacity-40"
                >
                  <option value="us-east-1">us-east-1 (N. Virginia)</option>
                  <option value="us-west-2">us-west-2 (Oregon)</option>
                  <option value="eu-west-1">eu-west-1 (Ireland)</option>
                  <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
                  <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Redundancy & Failover Mode</label>
                <select
                  value={awsMode}
                  disabled={!activeRole.permissions.manageClientsTeam}
                  onChange={(e) => setAwsMode(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100 disabled:opacity-40"
                >
                  <option value="Multi-AZ Active-Active (us-east-1 + eu-west-1)">Multi-AZ Active-Active + CRR</option>
                  <option value="Multi-AZ + CloudFront Edge">Multi-AZ + CloudFront Edge</option>
                  <option value="Multi-AZ Standard IA Archive">Multi-AZ + S3 Glacier Archive</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Target S3 Media Archive Bucket</label>
              <input
                type="text"
                value={awsBucket}
                disabled={!activeRole.permissions.manageClientsTeam}
                onChange={(e) => setAwsBucket(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs font-mono text-slate-100 disabled:opacity-40"
              />
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
              <button
                onClick={handleExportAwsBlueprint}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] hover:border-amber-500/40 text-xs text-slate-200"
              >
                <Download className="w-3.5 h-3.5" />
                Export AWS Manifest JSON
              </button>
              <button
                onClick={handleSaveAwsConfig}
                disabled={!activeRole.permissions.manageClientsTeam}
                className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-40"
              >
                Save Cloud Settings
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 p-5 rounded-xl bg-[#12161F] border border-white/[0.08] space-y-3">
            <h2 className="text-sm font-semibold text-slate-100">Active Storage & Failover Posture</h2>
            <div className="space-y-2.5 text-xs">
              <div className="p-3 rounded-lg bg-[#0B0D12] border border-white/[0.06]">
                <div className="text-slate-400">Local Runtime Database</div>
                <div className="text-slate-100 font-medium mt-0.5">SQLite WAL Mode (Zero-Latency Local Persistence)</div>
              </div>
              <div className="p-3 rounded-lg bg-[#0B0D12] border border-white/[0.06]">
                <div className="text-slate-400">Production Cloud Target</div>
                <div className="text-slate-100 font-medium mt-0.5">AWS S3 + CloudFront + Multi-AZ RDS Replication</div>
              </div>
              <div className="p-3 rounded-lg bg-[#0B0D12] border border-white/[0.06]">
                <div className="text-slate-400">Encryption & Access Control</div>
                <div className="text-slate-100 font-medium mt-0.5">Server-Side RBAC Guard · AES-256 Media Export Config</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
