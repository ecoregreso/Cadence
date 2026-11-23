import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2, Mail, Printer, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import type { ClientAccount, MonthlyReport, RoleDefinition } from '../types';

interface ReportsViewProps {
  client: ClientAccount;
  reports: MonthlyReport[];
  onReportsChange: (reports: MonthlyReport[]) => void;
  onClientUpdated: (client: ClientAccount) => void;
  role: RoleDefinition;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'error') => void;
}

export function ReportsView({
  client,
  reports,
  onReportsChange,
  onClientUpdated,
  role,
  onNotify,
}: ReportsViewProps) {
  const [selectedId, setSelectedId] = useState<string>(reports[0]?.id || '');
  const [periodLabel, setPeriodLabel] = useState('November 2026 Executive Review');
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);

  const [recipients, setRecipients] = useState(client.report_recipients || '');
  const [dayOfMonth, setDayOfMonth] = useState(client.report_day_of_month || 1);

  const activeReport = reports.find((r) => r.id === selectedId) || reports[0] || null;

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const created = await api.generateReport(client.id, periodLabel);
      onReportsChange([created, ...reports]);
      setSelectedId(created.id);
      onNotify(`Generated AI monthly performance report: ${created.period_label}.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to generate report.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleDispatchEmail = async () => {
    if (!activeReport) return;
    setSending(true);
    try {
      const updated = await api.sendReport(activeReport.id);
      onReportsChange(reports.map((r) => (r.id === updated.id ? updated : r)));
      onNotify(`Dispatched monthly performance deck to ${client.report_recipients || 'client stakeholders'}.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to dispatch report.', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleSaveAutomation = async () => {
    try {
      const updated = await api.updateClient(client.id, {
        report_recipients: recipients,
        report_day_of_month: dayOfMonth,
      });
      onClientUpdated(updated);
      onNotify('Saved automated monthly delivery schedule.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update schedule.', 'error');
    }
  };

  const handleDownloadCsv = () => {
    if (!activeReport) return;
    const rows = [
      ['Platform', 'Impressions', 'Clicks', 'Conversions', 'Revenue_USD'],
      ...(activeReport.metrics_snapshot.by_platform || []).map((p) => [
        p.platform,
        String(p.impressions),
        String(p.clicks),
        String(p.conversions),
        String(p.revenue),
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${client.name.toLowerCase().replace(/\s+/g, '-')}-${activeReport.period_label.toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    onNotify('Downloaded channel metrics CSV.', 'success');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-5 no-print">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Automated Monthly Client Reports</h1>
          <p className="text-sm text-slate-400 mt-1">
            Compile executive summaries, channel ROI tables, and next-month creative recommendations for {client.name}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[#12161F] border border-white/[0.1] text-xs text-slate-200 w-56"
          />
          <button
            onClick={handleGenerate}
            disabled={generating || !role.permissions.generateReports}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? 'Synthesizing Review...' : 'Generate AI Monthly Report'}
          </button>
        </div>
      </div>

      {/* Automated Delivery Cadence Settings */}
      <div className="p-4 rounded-xl bg-[#12161F] border border-white/[0.08] flex flex-wrap items-end justify-between gap-4 no-print">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs text-slate-400 mb-1">Automated Monthly Email Recipients</label>
          <input
            type="text"
            value={recipients}
            disabled={!role.permissions.manageClientsTeam}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="cmo@client.com, growth@client.com"
            className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-200 disabled:opacity-50"
          />
        </div>
        <div className="w-44">
          <label className="block text-xs text-slate-400 mb-1">Auto-Send Day</label>
          <select
            value={dayOfMonth}
            disabled={!role.permissions.manageClientsTeam}
            onChange={(e) => setDayOfMonth(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-200 disabled:opacity-50"
          >
            <option value={1}>1st of every month</option>
            <option value={5}>5th of every month</option>
            <option value={15}>15th of every month</option>
            <option value={28}>28th of every month</option>
          </select>
        </div>
        <button
          onClick={handleSaveAutomation}
          disabled={!role.permissions.manageClientsTeam}
          className="px-4 py-2 rounded-lg bg-[#181D29] border border-white/[0.1] hover:border-amber-500/40 text-xs font-medium text-slate-200 disabled:opacity-40 whitespace-nowrap shrink-0"
        >
          Save Auto-Delivery
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left History List */}
        <div className="lg:col-span-4 space-y-2 no-print">
          <div className="text-xs font-medium text-slate-400 px-1">Saved Review Decks ({reports.length})</div>
          {reports.map((rep) => {
            const active = rep.id === activeReport?.id;
            return (
              <button
                key={rep.id}
                onClick={() => setSelectedId(rep.id)}
                className={`w-full p-4 rounded-xl border text-left transition-colors ${
                  active
                    ? 'bg-[#181D29] border-amber-500/60'
                    : 'bg-[#12161F] border-white/[0.08] hover:border-white/[0.16]'
                }`}
              >
                <div className="text-sm font-semibold text-slate-100">{rep.period_label}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {rep.delivery_status} · <span className="font-mono tabular-nums">{rep.metrics_snapshot.roas}x ROAS</span>
                </div>
              </button>
            );
          })}
          {reports.length === 0 && (
            <div className="p-6 rounded-xl bg-[#12161F] border border-white/[0.08] text-center text-xs text-slate-500">
              <FileText className="w-6 h-6 mx-auto mb-2 opacity-50" />
              No reports compiled yet for {client.name}. Click Generate AI Monthly Report to build your first review.
            </div>
          )}
        </div>

        {/* Right Executive Printable Report Sheet */}
        <div className="lg:col-span-8">
          {activeReport ? (
            <div className="p-7 rounded-xl bg-[#12161F] border border-white/[0.08] space-y-6 print-sheet">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.08] pb-5">
                <div>
                  <div className="text-xs text-amber-400 font-medium">{client.name} · {client.industry}</div>
                  <h2 className="text-xl font-bold text-slate-100 mt-1">{activeReport.period_label}</h2>
                  <div className="text-xs text-slate-400 mt-1">
                    Status: {activeReport.delivery_status} · Compiled{' '}
                    {new Date(activeReport.created_at).toLocaleDateString()}
                  </div>
                </div>

                <div className="flex items-center gap-2 no-print">
                  <button
                    onClick={handleDownloadCsv}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0B0D12] border border-white/[0.1] hover:border-white/[0.2] text-xs text-slate-200 whitespace-nowrap shrink-0"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    CSV
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0B0D12] border border-white/[0.1] hover:border-white/[0.2] text-xs text-slate-200 whitespace-nowrap shrink-0"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print / PDF
                  </button>
                  <button
                    onClick={handleDispatchEmail}
                    disabled={sending || !role.permissions.generateReports}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {sending ? 'Sending...' : 'Send to Client'}
                  </button>
                </div>
              </div>

              {/* Executive KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Impressions', value: activeReport.metrics_snapshot.impressions.toLocaleString() },
                  { label: '3s Hook Rate', value: `${activeReport.metrics_snapshot.hook_rate}%` },
                  { label: 'Attributed Revenue', value: `$${Math.round(activeReport.metrics_snapshot.revenue).toLocaleString()}` },
                  { label: 'Blended ROAS', value: `${activeReport.metrics_snapshot.roas}x` },
                ].map((k) => (
                  <div key={k.label} className="p-3.5 rounded-lg bg-[#0B0D12] border border-white/[0.07]">
                    <div className="text-[11px] text-slate-400">{k.label}</div>
                    <div className="text-lg font-bold font-mono tabular-nums text-slate-100 mt-1">{k.value}</div>
                  </div>
                ))}
              </div>

              {/* AI Executive Narrative */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-100">Executive Summary</h3>
                <p className="text-sm text-slate-300 leading-relaxed">{activeReport.summary_markdown}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-100">Key Wins</h3>
                  <ul className="space-y-2 text-xs text-slate-300 leading-relaxed list-disc pl-4">
                    {activeReport.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-100">Next-Month Creative Plan</h3>
                  <ul className="space-y-2 text-xs text-slate-300 leading-relaxed list-disc pl-4">
                    {activeReport.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Channel Summary Table */}
              <div className="border-t border-white/[0.08] pt-4">
                <h3 className="text-sm font-semibold text-slate-100 mb-3">Channel Performance Breakdown</h3>
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-slate-400 font-sans">
                      <th className="py-2">Platform</th>
                      <th className="py-2 text-right">Impressions</th>
                      <th className="py-2 text-right">Clicks</th>
                      <th className="py-2 text-right">Conversions</th>
                      <th className="py-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {(activeReport.metrics_snapshot.by_platform || []).map((row) => (
                      <tr key={row.platform}>
                        <td className="py-2.5 font-sans font-medium text-slate-200">{row.platform}</td>
                        <td className="py-2.5 text-right text-slate-300">{row.impressions.toLocaleString()}</td>
                        <td className="py-2.5 text-right text-slate-300">{row.clicks.toLocaleString()}</td>
                        <td className="py-2.5 text-right text-slate-200">{row.conversions.toLocaleString()}</td>
                        <td className="py-2.5 text-right text-emerald-400">${Math.round(row.revenue).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-xl bg-[#12161F] border border-white/[0.08] text-center">
              <Download className="w-8 h-8 text-slate-500 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-200">Ready to compile your monthly client review</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                Aggregate live social and email campaign metrics for {client.name} into an executive report ready for PDF export or email dispatch.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
