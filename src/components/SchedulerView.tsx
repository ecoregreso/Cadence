import React, { useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Clock, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type {
  AdProject,
  ChannelIntegration,
  ClientAccount,
  RoleDefinition,
  ScheduledPost,
} from '../types';

interface SchedulerViewProps {
  client: ClientAccount;
  projects: AdProject[];
  integrations: ChannelIntegration[];
  schedule: ScheduledPost[];
  onScheduleChange: (posts: ScheduledPost[]) => void;
  defaultProjectId: string | null;
  role: RoleDefinition;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'error') => void;
}

const OPTIMAL_WINDOWS: Record<string, { label: string; hour: number }> = {
  TikTok: { label: '6:00 PM peak engagement', hour: 18 },
  'Instagram Reels': { label: '11:30 AM lunch scroll', hour: 11 },
  'YouTube Shorts': { label: '4:00 PM afternoon surge', hour: 16 },
  LinkedIn: { label: '9:00 AM B2B commute', hour: 9 },
  'X (Twitter)': { label: '1:00 PM midday cycle', hour: 13 },
  Klaviyo: { label: '10:00 AM inbox top-slot', hour: 10 },
  Mailchimp: { label: '10:30 AM newsletter window', hour: 10 },
  HubSpot: { label: '9:30 AM lifecycle send', hour: 9 },
};

export function SchedulerView({
  client,
  projects,
  integrations,
  schedule,
  onScheduleChange,
  defaultProjectId,
  role,
  onNotify,
}: SchedulerViewProps) {
  const connectedChannels = useMemo(() => integrations.filter((i) => i.connected === 1), [integrations]);

  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || '');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(() =>
    connectedChannels.slice(0, 2).map((c) => c.platform)
  );
  const [dateInput, setDateInput] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [timeInput, setTimeInput] = useState('16:00');
  const [caption, setCaption] = useState(() => {
    const p = projects.find((pr) => pr.id === (defaultProjectId || projects[0]?.id));
    return p ? `${p.scenes[0]?.headline || p.title} ${p.scenes[0]?.subtitle || ''}`.trim() : '';
  });
  const [hashtags, setHashtags] = useState(`#${client.name.replace(/\s+/g, '')} #VideoAd #Launch`);
  const [statusFilter, setStatusFilter] = useState<'all' | 'Queued' | 'Published'>('all');
  const [submitting, setSubmitting] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const togglePlatform = (plat: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(plat) ? prev.filter((p) => p !== plat) : [...prev, plat]
    );
  };

  const handleApplyOptimalTime = () => {
    const primary = selectedPlatforms[0] || 'TikTok';
    const opt = OPTIMAL_WINDOWS[primary] || { hour: 16, label: '4:00 PM' };
    setTimeInput(`${String(opt.hour).padStart(2, '0')}:00`);
    onNotify(`Applied AI optimal posting slot for ${primary} (${opt.label}).`, 'info');
  };

  const handleQueuePosts = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProject = projectId || projects[0]?.id;
    if (!targetProject || selectedPlatforms.length === 0) {
      onNotify('Select a video ad and at least one connected platform.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const createdList: ScheduledPost[] = [];
      for (let i = 0; i < selectedPlatforms.length; i++) {
        const platform = selectedPlatforms[i];
        const isoDate = new Date(`${dateInput}T${timeInput}:00`).toISOString();
        const created = await api.createSchedule({
          client_id: client.id,
          project_id: targetProject,
          platform,
          scheduled_for: isoDate,
          caption: caption.trim() || 'New video campaign release.',
          hashtags: hashtags.trim(),
        });
        createdList.push(created);
      }
      onScheduleChange([...schedule, ...createdList].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)));
      onNotify(`Scheduled ${createdList.length} automated cross-platform post${createdList.length > 1 ? 's' : ''}.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to schedule posts.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublishNow = async (postId: string) => {
    setPublishingId(postId);
    try {
      const { post, webhookDispatched } = await api.publishPostNow(postId);
      onScheduleChange(schedule.map((s) => (s.id === post.id ? post : s)));
      onNotify(
        webhookDispatched
          ? `Published to ${post.platform} and dispatched webhook payload.`
          : `Published to ${post.platform} and started live analytics ingestion.`,
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Publish failed.', 'error');
    } finally {
      setPublishingId(null);
    }
  };

  const handleDeletePost = async (postId: string) => {
    try {
      await api.deleteSchedule(postId);
      onScheduleChange(schedule.filter((s) => s.id !== postId));
      onNotify('Removed scheduled post from queue.', 'info');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to remove post.', 'error');
    }
  };

  // Rolling 7-day calendar columns
  const rollingDays = useMemo(() => {
    const list: Array<{ isoDate: string; dayLabel: string; numLabel: string; items: ScheduledPost[] }> = [];
    for (let offset = -1; offset < 6; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      const isoDate = d.toISOString().slice(0, 10);
      list.push({
        isoDate,
        dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }),
        numLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        items: schedule.filter((s) => s.scheduled_for.slice(0, 10) === isoDate),
      });
    }
    return list;
  }, [schedule]);

  const filteredQueue = schedule.filter((s) => (statusFilter === 'all' ? true : s.status === statusFilter));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Automated Cross-Platform Scheduler</h1>
          <p className="text-sm text-slate-400 mt-1">
            Distribute video masters across social channels and email campaigns for {client.name} with peak-time optimization.
          </p>
        </div>
        <div className="text-xs font-mono tabular-nums text-slate-400">
          {connectedChannels.length} connected channels · {schedule.filter((s) => s.status === 'Queued').length} queued ·{' '}
          {schedule.filter((s) => s.status === 'Published').length} published
        </div>
      </div>

      {/* Automated Cross-Platform Composer */}
      <form
        onSubmit={handleQueuePosts}
        className="p-5 rounded-xl bg-[#12161F] border border-white/[0.08] space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Queue Multi-Channel Release</h2>
          <button
            type="button"
            onClick={handleApplyOptimalTime}
            className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Auto-Pick Peak Time
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-5">
            <label className="block text-xs text-slate-400 mb-1.5">Video Ad Asset</label>
            <select
              value={projectId || projects[0]?.id || ''}
              onChange={(e) => {
                setProjectId(e.target.value);
                const found = projects.find((p) => p.id === e.target.value);
                if (found) setCaption(`${found.scenes[0]?.headline || found.title} — ${found.cta_text}`);
              }}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm text-slate-100"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.aspect_ratio} · {p.status})
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-4">
            <label className="block text-xs text-slate-400 mb-1.5">Publish Date</label>
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm font-mono text-slate-100"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs text-slate-400 mb-1.5">Publish Time</label>
            <input
              type="time"
              value={timeInput}
              onChange={(e) => setTimeInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm font-mono text-slate-100"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-2">Target Connected Channels</label>
          <div className="flex flex-wrap gap-2">
            {connectedChannels.map((ch) => {
              const active = selectedPlatforms.includes(ch.platform);
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => togglePlatform(ch.platform)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-amber-500/15 border-amber-500/60 text-amber-200'
                      : 'bg-[#0B0D12] border-white/[0.08] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {ch.platform} · {ch.category === 'email' ? 'Email Embed' : 'Video Post'}
                </button>
              );
            })}
            {connectedChannels.length === 0 && (
              <span className="text-xs text-amber-400">
                No channels connected yet. Enable one-click connections in Clients & Team.
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-8">
            <label className="block text-xs text-slate-400 mb-1.5">Post Caption / Email Subject</label>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write platform-ready ad copy..."
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm text-slate-100"
            />
          </div>
          <div className="md:col-span-4">
            <label className="block text-xs text-slate-400 mb-1.5">Hashtags / Campaign Tag</label>
            <input
              type="text"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm font-mono text-slate-300"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
          <span className="text-xs text-slate-500">
            {role.permissions.schedulePublish
              ? `Ready to queue across ${selectedPlatforms.length} selected channel${selectedPlatforms.length === 1 ? '' : 's'}.`
              : `Role "${role.label}" has read-only access to the release schedule.`}
          </span>
          <button
            type="submit"
            disabled={submitting || !role.permissions.schedulePublish || selectedPlatforms.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            {submitting ? 'Scheduling...' : 'Schedule Automated Drop'}
          </button>
        </div>
      </form>

      {/* Rolling 7-Day Calendar Strip */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-400" />
            7-Day Distribution Window
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {rollingDays.map((day) => (
            <div
              key={day.isoDate}
              className="min-h-[132px] p-3 rounded-lg bg-[#12161F] border border-white/[0.08] flex flex-col gap-2"
            >
              <div className="flex items-baseline justify-between border-b border-white/[0.06] pb-1.5">
                <span className="text-xs font-semibold text-slate-200">{day.dayLabel}</span>
                <span className="text-[11px] font-mono tabular-nums text-slate-500">{day.numLabel}</span>
              </div>
              <div className="space-y-1.5 flex-1">
                {day.items.map((item) => (
                  <div
                    key={item.id}
                    className="p-2 rounded bg-[#0B0D12] border border-white/[0.07] text-[11px]"
                  >
                    <div className="font-medium text-slate-200 truncate">{item.platform}</div>
                    <div className="text-slate-500 truncate mt-0.5">{item.project_title || 'Ad Asset'}</div>
                    <div
                      className={`font-mono text-[10px] mt-1 ${
                        item.status === 'Published' ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {new Date(item.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {item.status}
                    </div>
                  </div>
                ))}
                {day.items.length === 0 && (
                  <div className="text-[11px] text-slate-600 pt-2">Open slot</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Distribution Queue Table */}
      <div className="rounded-xl bg-[#12161F] border border-white/[0.08] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08]">
          <h2 className="text-sm font-semibold text-slate-100">Release Queue & Publish Log</h2>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0D12] border border-white/[0.08]">
            {(['all', 'Queued', 'Published'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  statusFilter === f ? 'bg-[#181D29] text-amber-400 font-medium' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f === 'all' ? 'All' : f}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] text-[11px] text-slate-400 font-medium">
                <th className="py-3 px-5">Platform</th>
                <th className="py-3 px-4">Campaign & Copy</th>
                <th className="py-3 px-4">Scheduled Time</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-xs">
              {filteredQueue.map((item) => (
                <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-5 font-medium text-slate-100 whitespace-nowrap">{item.platform}</td>
                  <td className="py-3 px-4 max-w-md">
                    <div className="text-slate-200 font-medium truncate">{item.project_title || item.project_id}</div>
                    <div className="text-slate-400 truncate mt-0.5">{item.caption}</div>
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                    {new Date(item.scheduled_for).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {item.status === 'Published' ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Published
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
                        <Clock className="w-3.5 h-3.5" />
                        Queued
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-3">
                      {item.status === 'Queued' && (
                        <button
                          onClick={() => handlePublishNow(item.id)}
                          disabled={!role.permissions.schedulePublish || publishingId === item.id}
                          className="inline-flex items-center gap-1.5 text-amber-400 hover:text-amber-300 font-medium disabled:opacity-40"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {publishingId === item.id ? 'Publishing...' : 'Publish Now'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeletePost(item.id)}
                        disabled={!role.permissions.schedulePublish}
                        className="text-slate-500 hover:text-rose-400 disabled:opacity-40"
                        title="Remove from schedule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredQueue.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No posts match this filter yet. Queue your first campaign drop above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
