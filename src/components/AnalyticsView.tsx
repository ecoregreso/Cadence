import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Radio, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type { AnalyticsDaily, ChannelIntegration, ClientAccount } from '../types';

interface AnalyticsViewProps {
  client: ClientAccount;
  analytics: AnalyticsDaily[];
  onAnalyticsChange: (rows: AnalyticsDaily[]) => void;
  integrations: ChannelIntegration[];
  onNotify: (msg: string, tone?: 'info' | 'success' | 'error') => void;
}

export function AnalyticsView({
  client,
  analytics,
  onAnalyticsChange,
  integrations,
  onNotify,
}: AnalyticsViewProps) {
  const [rangeDays, setRangeDays] = useState<7 | 14 | 21>(21);
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [liveStreaming, setLiveStreaming] = useState<boolean>(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>(() => new Date().toLocaleTimeString());
  const [syncing, setSyncing] = useState(false);

  const connectedPlatformNames = useMemo(
    () => new Set(integrations.filter((i) => i.connected === 1).map((i) => i.platform)),
    [integrations]
  );

  // Real-time channel telemetry pulse every 8s when live stream is active
  useEffect(() => {
    if (!liveStreaming) return;
    const timer = setInterval(async () => {
      try {
        const res = await api.pulseAnalytics(client.id);
        onAnalyticsChange(res.rows);
        setLastSyncedAt(new Date(res.syncedAt).toLocaleTimeString());
      } catch {
        // silent retry on next interval
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [liveStreaming, client.id]);

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const res = await api.pulseAnalytics(client.id);
      onAnalyticsChange(res.rows);
      setLastSyncedAt(new Date(res.syncedAt).toLocaleTimeString());
      onNotify(`Aggregated latest real-time telemetry across ${connectedPlatformNames.size} connected channels.`, 'info');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Analytics sync failed.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const filteredRows = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rangeDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return analytics.filter((r) => {
      if (r.metric_date < cutoffStr) return false;
      if (platformFilter !== 'all' && r.platform !== platformFilter) return false;
      return true;
    });
  }, [analytics, rangeDays, platformFilter]);

  const kpis = useMemo(() => {
    let impressions = 0;
    let views3s = 0;
    let completions = 0;
    let clicks = 0;
    let conversions = 0;
    let spend = 0;
    let revenue = 0;
    let emailOpens = 0;
    let emailClicks = 0;

    for (const r of filteredRows) {
      impressions += r.impressions;
      views3s += r.views_3s;
      completions += r.completions;
      clicks += r.clicks;
      conversions += r.conversions;
      spend += r.spend;
      revenue += r.revenue;
      emailOpens += r.email_opens;
      emailClicks += r.email_clicks;
    }

    return {
      impressions,
      hookRate: impressions > 0 ? (views3s / impressions) * 100 : 0,
      watchThrough: views3s > 0 ? (completions / views3s) * 100 : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      conversions,
      revenue,
      spend,
      roas: spend > 0 ? revenue / spend : 0,
      emailOpens,
      emailCtr: emailOpens > 0 ? (emailClicks / emailOpens) * 100 : 0,
    };
  }, [filteredRows]);

  // Daily trend aggregation
  const dailySeries = useMemo(() => {
    const map = new Map<string, { date: string; impressions: number; revenue: number; clicks: number }>();
    for (const r of filteredRows) {
      const cur = map.get(r.metric_date) || {
        date: r.metric_date.slice(5),
        impressions: 0,
        revenue: 0,
        clicks: 0,
      };
      cur.impressions += r.impressions;
      cur.revenue = Math.round(cur.revenue + r.revenue);
      cur.clicks += r.clicks;
      map.set(r.metric_date, cur);
    }
    return Array.from(map.values());
  }, [filteredRows]);

  // Platform breakdown
  const channelBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        platform: string;
        impressions: number;
        views3s: number;
        clicks: number;
        conversions: number;
        spend: number;
        revenue: number;
        emailOpens: number;
      }
    >();
    for (const r of filteredRows) {
      const cur = map.get(r.platform) || {
        platform: r.platform,
        impressions: 0,
        views3s: 0,
        clicks: 0,
        conversions: 0,
        spend: 0,
        revenue: 0,
        emailOpens: 0,
      };
      cur.impressions += r.impressions;
      cur.views3s += r.views_3s;
      cur.clicks += r.clicks;
      cur.conversions += r.conversions;
      cur.spend += r.spend;
      cur.revenue += r.revenue;
      cur.emailOpens += r.email_opens;
      map.set(r.platform, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredRows]);

  const availablePlatforms = useMemo(() => {
    const set = new Set<string>(analytics.map((r) => r.platform));
    return Array.from(set);
  }, [analytics]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Real-Time Campaign Analytics</h1>
          <p className="text-sm text-slate-400 mt-1">
            Unified cross-channel video and email performance telemetry for {client.name} · Last synced{' '}
            <span className="font-mono tabular-nums text-slate-300">{lastSyncedAt}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#12161F] border border-white/[0.08]">
            {([7, 14, 21] as const).map((d) => (
              <button
                key={d}
                onClick={() => setRangeDays(d)}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                  rangeDays === d ? 'bg-[#181D29] text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {d}D
              </button>
            ))}
          </div>

          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-[#12161F] border border-white/[0.1] text-xs text-slate-200"
          >
            <option value="all">All Connected Channels</option>
            {availablePlatforms.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <button
            onClick={() => setLiveStreaming((s) => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
              liveStreaming
                ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-300'
                : 'bg-[#12161F] border-white/[0.08] text-slate-400'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            {liveStreaming ? 'Live Stream On' : 'Live Stream Paused'}
          </button>

          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181D29] border border-white/[0.1] hover:border-amber-500/50 text-xs text-slate-200 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync Now
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Impressions', value: kpis.impressions.toLocaleString(), sub: `${rangeDays}-day reach` },
          { label: '3s Hook Rate', value: `${kpis.hookRate.toFixed(1)}%`, sub: 'Video thumb-stop' },
          { label: 'Watch-Through', value: `${kpis.watchThrough.toFixed(1)}%`, sub: 'Full ad completion' },
          { label: 'Blended CTR', value: `${kpis.ctr.toFixed(2)}%`, sub: 'Social + email' },
          { label: 'Conversions', value: kpis.conversions.toLocaleString(), sub: `$${Math.round(kpis.revenue).toLocaleString()} rev` },
          { label: 'Blended ROAS', value: `${kpis.roas.toFixed(2)}x`, sub: `$${Math.round(kpis.spend).toLocaleString()} spend` },
        ].map((metric) => (
          <div key={metric.label} className="p-4 rounded-xl bg-[#12161F] border border-white/[0.08]">
            <div className="text-xs text-slate-400">{metric.label}</div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-100 mt-1.5">{metric.value}</div>
            <div className="text-[11px] text-slate-500 mt-1">{metric.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 p-5 rounded-xl bg-[#12161F] border border-white/[0.08]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Attributed Revenue & Reach Velocity</h2>
              <p className="text-xs text-slate-400 mt-0.5">Daily aggregated performance across connected channels</p>
            </div>
            <span className="text-xs font-mono text-amber-400">USD Revenue</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailySeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="amberGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="date" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#12161F',
                    borderColor: 'rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#F1F5F9',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Attributed Revenue ($)"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  fill="url(#amberGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-5 p-5 rounded-xl bg-[#12161F] border border-white/[0.08]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Conversions by Channel</h2>
              <p className="text-xs text-slate-400 mt-0.5">Social video + email lifecycle attribution</p>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={channelBreakdown} layout="vertical" margin={{ top: 4, right: 16, left: 24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis type="number" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="platform" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} width={96} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#12161F',
                    borderColor: 'rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#F1F5F9',
                  }}
                />
                <Bar dataKey="conversions" name="Conversions" fill="#38BDF8" radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Unified Multi-Channel Performance Table */}
      <div className="rounded-xl bg-[#12161F] border border-white/[0.08] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08]">
          <h2 className="text-sm font-semibold text-slate-100">Channel Breakdown</h2>
          <span className="text-xs text-slate-400 font-mono tabular-nums">
            Email Opens: {kpis.emailOpens.toLocaleString()} · Email Click-to-Open: {kpis.emailCtr.toFixed(1)}%
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] text-[11px] text-slate-400 font-medium">
                <th className="py-3 px-5">Channel</th>
                <th className="py-3 px-4 text-right">Impressions</th>
                <th className="py-3 px-4 text-right">Clicks</th>
                <th className="py-3 px-4 text-right">CTR</th>
                <th className="py-3 px-4 text-right">Conversions</th>
                <th className="py-3 px-4 text-right">Ad Spend</th>
                <th className="py-3 px-4 text-right">Revenue</th>
                <th className="py-3 px-5 text-right">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-xs font-mono tabular-nums">
              {channelBreakdown.map((row) => {
                const ctr = row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0;
                const roas = row.spend > 0 ? row.revenue / row.spend : 0;
                const isConnected = connectedPlatformNames.has(row.platform);
                return (
                  <tr key={row.platform} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-5 font-sans font-medium text-slate-100">
                      {row.platform}
                      {!isConnected && <span className="ml-2 text-[11px] text-slate-500 font-normal">Archived</span>}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-300">{row.impressions.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-slate-300">{row.clicks.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-slate-300">{ctr.toFixed(2)}%</td>
                    <td className="py-3 px-4 text-right text-slate-200">{row.conversions.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-slate-400">${row.spend.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                    <td className="py-3 px-4 text-right text-emerald-400 font-medium">
                      ${row.revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-3 px-5 text-right text-amber-400 font-semibold">{roas.toFixed(2)}x</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
