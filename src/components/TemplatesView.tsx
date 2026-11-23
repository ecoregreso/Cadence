import React, { useState } from 'react';
import { Check, Palette, Plus } from 'lucide-react';
import { api } from '../lib/api';
import type { AdProject, BrandTemplate, ClientAccount, RoleDefinition } from '../types';

interface TemplatesViewProps {
  client: ClientAccount;
  templates: BrandTemplate[];
  onTemplatesChange: (templates: BrandTemplate[]) => void;
  activeProject: AdProject | null;
  onApplyTemplate: (templateId: string) => void;
  role: RoleDefinition;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'error') => void;
}

export function TemplatesView({
  client,
  templates,
  onTemplatesChange,
  activeProject,
  onApplyTemplate,
  role,
  onNotify,
}: TemplatesViewProps) {
  const [filterRatio, setFilterRatio] = useState<'all' | '9:16' | '16:9'>('all');
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [category, setCategory] = useState(client.industry);
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16');
  const [accentColor, setAccentColor] = useState(client.brand_accent || '#F59E0B');
  const [bgColor, setBgColor] = useState('#0B0D12');
  const [overlayStyle, setOverlayStyle] = useState<BrandTemplate['overlay_style']>('cinema-bars');
  const [lowerThirdStyle, setLowerThirdStyle] = useState<BrandTemplate['lower_third_style']>('bar');
  const [motionPreset, setMotionPreset] = useState<BrandTemplate['motion_preset']>('slow-push');

  const filtered = templates.filter((t) => (filterRatio === 'all' ? true : t.aspect_ratio === filterRatio));

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const created = await api.createTemplate({
        client_id: client.id,
        name: name.trim(),
        category,
        aspect_ratio: aspectRatio,
        bg_color: bgColor,
        accent_color: accentColor,
        text_color: '#F8FAFC',
        font_display: 'Plus Jakarta Sans',
        overlay_style: overlayStyle,
        motion_preset: motionPreset,
        lower_third_style: lowerThirdStyle,
      });
      onTemplatesChange([created, ...templates]);
      setName('');
      setCreating(false);
      onNotify(`Saved custom brand template "${created.name}".`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save template.', 'error');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Brand Aesthetic Templates</h1>
          <p className="text-sm text-slate-400 mt-1">
            Customize motion framing, typography overlays, lower thirds, and color palettes for {client.name}.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#12161F] border border-white/[0.08]">
            {(['all', '9:16', '16:9'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setFilterRatio(r)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filterRatio === r ? 'bg-[#181D29] text-amber-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r === 'all' ? 'All Ratios' : r}
              </button>
            ))}
          </div>

          <button
            onClick={() => setCreating((c) => !c)}
            disabled={!role.permissions.editProjects}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Brand Template
          </button>
        </div>
      </div>

      {/* Custom Template Builder Form */}
      {creating && (
        <form
          onSubmit={handleCreateTemplate}
          className="p-5 rounded-xl bg-[#12161F] border border-white/[0.1] grid grid-cols-1 md:grid-cols-12 gap-4"
        >
          <div className="md:col-span-4">
            <label className="block text-xs text-slate-400 mb-1.5">Template Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${client.name} Noir Launch`}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm text-slate-100"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs text-slate-400 mb-1.5">Category</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm text-slate-100"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-slate-400 mb-1.5">Aspect Ratio</label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as '9:16' | '16:9')}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-sm text-slate-100"
            >
              <option value="9:16">9:16 Vertical</option>
              <option value="16:9">16:9 Widescreen</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs text-slate-400 mb-1.5">Accent & Surface</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="h-9 w-12 rounded bg-[#0B0D12] border border-white/[0.1] cursor-pointer"
              />
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="h-9 w-12 rounded bg-[#0B0D12] border border-white/[0.1] cursor-pointer"
              />
              <span className="text-xs font-mono text-slate-400">{accentColor}</span>
            </div>
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs text-slate-400 mb-1.5">Framing Overlay</label>
            <select
              value={overlayStyle}
              onChange={(e) => setOverlayStyle(e.target.value as BrandTemplate['overlay_style'])}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100"
            >
              <option value="cinema-bars">Anamorphic Cinema Bars</option>
              <option value="kinetic-bold">Kinetic Full-Bleed</option>
              <option value="editorial-minimal">Editorial Minimal</option>
              <option value="tech-hud">Architectural Frame</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs text-slate-400 mb-1.5">Lower-Third Typography</label>
            <select
              value={lowerThirdStyle}
              onChange={(e) => setLowerThirdStyle(e.target.value as BrandTemplate['lower_third_style'])}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100"
            >
              <option value="bar">Clean Accent Rule</option>
              <option value="glass-strip">Frosted Cinema Strip</option>
              <option value="underline">Editorial Underline</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs text-slate-400 mb-1.5">Camera Motion</label>
            <select
              value={motionPreset}
              onChange={(e) => setMotionPreset(e.target.value as BrandTemplate['motion_preset'])}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-white/[0.1] text-xs text-slate-100"
            >
              <option value="slow-push">Slow Cinema Push</option>
              <option value="snappy-cut">Snappy Social Cut</option>
              <option value="ambient-drift">Ambient Drift</option>
            </select>
          </div>

          <div className="md:col-span-12 flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-4 py-2 rounded-lg text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400"
            >
              Save Brand Template
            </button>
          </div>
        </form>
      )}

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((tpl) => {
          const isApplied = activeProject?.template_id === tpl.id;
          return (
            <div
              key={tpl.id}
              className="rounded-xl bg-[#12161F] border border-white/[0.08] overflow-hidden flex flex-col"
            >
              <div className="relative h-48 bg-[#0B0D12] overflow-hidden">
                <img
                  src={tpl.preview_image}
                  alt={tpl.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover opacity-80"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/25" />
                {tpl.overlay_style === 'cinema-bars' && (
                  <>
                    <div className="absolute top-0 inset-x-0 h-3 bg-black" />
                    <div className="absolute bottom-0 inset-x-0 h-3 bg-black" />
                  </>
                )}
                <div className="absolute top-4 left-4 text-[11px] font-semibold text-white">
                  {client.name}
                  <div className="w-6 h-0.5 mt-1" style={{ backgroundColor: tpl.accent_color }} />
                </div>
                <div className="absolute bottom-4 left-4 right-4">
                  <div className="text-base font-bold text-white leading-tight">Crafted For Scroll-Stopping Impact.</div>
                  <div className="text-[11px] text-slate-300 mt-1">
                    {tpl.overlay_style} · {tpl.motion_preset}
                  </div>
                </div>
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-100">{tpl.name}</h3>
                    <span className="font-mono text-xs text-slate-400">{tpl.aspect_ratio}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {tpl.category} · {tpl.lower_third_style}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                    <Palette className="w-3.5 h-3.5" style={{ color: tpl.accent_color }} />
                    {tpl.accent_color}
                  </div>
                  <button
                    disabled={!activeProject || !role.permissions.editProjects}
                    onClick={() => onApplyTemplate(tpl.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      isApplied
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-[#181D29] text-slate-100 border border-white/[0.1] hover:border-amber-500/50 disabled:opacity-40'
                    }`}
                  >
                    {isApplied && <Check className="w-3.5 h-3.5" />}
                    {isApplied ? 'Active on Cut' : 'Apply to Cut'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
