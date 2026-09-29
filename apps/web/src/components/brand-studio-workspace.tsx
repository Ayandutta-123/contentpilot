'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  ExternalLink,
  Image as ImageIcon,
  LayoutTemplate,
  Library,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Unlock,
  KeyRound,
} from 'lucide-react';
import {
  InhouseTemplateEditor,
  type EditorCanvas,
} from '@/components/inhouse-template-editor';
import { PasswordInput } from '@/components/password-input';
import { BackButton, ProcessOverlay, ProcessingButton, Spinner } from '@/components/ui';
import { api, apiUpload } from '@/lib/api';
import { notifyError, notifySuccess, toast } from '@/lib/toast';

type BrandFillType =
  | 'headline'
  | 'subheadline'
  | 'body'
  | 'cta'
  | 'hashtag'
  | 'date'
  | 'offer'
  | 'custom_text'
  | 'json'
  | 'image_prompt'
  | 'image_url';

const TEXT_FILL_OPTIONS: Array<{ id: BrandFillType; label: string; hint: string }> = [
  { id: 'headline', label: 'Headline', hint: 'Short punchy title' },
  { id: 'subheadline', label: 'Subheadline', hint: 'Supporting line under headline' },
  { id: 'body', label: 'Body copy', hint: 'Longer on-image text' },
  { id: 'cta', label: 'Call to action', hint: 'e.g. Learn more, Shop now' },
  { id: 'offer', label: 'Offer / promo', hint: 'Discount or deal line' },
  { id: 'hashtag', label: 'Hashtags', hint: 'On-image hashtag line' },
  { id: 'date', label: 'Date / occasion', hint: 'Festival or event date' },
  { id: 'custom_text', label: 'Custom text', hint: 'Free-form — uses fill hint below' },
];

type PostPreset = {
  id: string;
  label: string;
  description: string;
  zones: Array<{ slot: string; fillType: BrandFillType; lineCount: number; fillHint: string }>;
};

type BrandLayer = {
  id: string;
  type: 'text' | 'image' | 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  slot?: string;
  text?: string;
  src?: string;
  editable?: boolean;
  fillMode?: 'static' | 'dynamic';
  fillType?: BrandFillType;
  fillHint?: string;
  lineCount?: number;
  placidType?: string;
  locked?: boolean;
  hidden?: boolean;
};

type BrandCanvas = {
  width?: number;
  height?: number;
  background?: { type: 'color' | 'image'; value: string };
  backgroundMode?: 'static' | 'dynamic';
  backgroundFit?: 'cover' | 'contain' | 'stretch';
  postType?: string;
  designSource?: 'placid' | 'inhouse';
  layers?: BrandLayer[];
};

type BrandTemplate = {
  id: string;
  name: string;
  provider: string;
  placidTemplateId?: string | null;
  backgroundUrl?: string | null;
  previewUrl?: string | null;
  canvas?: BrandCanvas | null;
  isActive: boolean;
};

type PlacidCatalogItem = {
  uuid: string;
  title: string;
  thumbnail?: string | null;
  layers: Array<{ name: string; type: string }>;
};

const FALLBACK_PRESETS: PostPreset[] = [
  {
    id: 'festival',
    label: 'Festival / greeting',
    description: 'Headline + 2 body lines',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Greeting' },
      { slot: 'body', fillType: 'json', lineCount: 2, fillHint: '2 body lines' },
    ],
  },
  {
    id: 'product_launch',
    label: 'Product launch',
    description: 'Headline + 3 body lines',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Launch' },
      { slot: 'body', fillType: 'json', lineCount: 3, fillHint: '3 body lines' },
    ],
  },
  {
    id: 'offer',
    label: 'Offer / promo',
    description: 'Headline + body + offer',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Promo' },
      { slot: 'body', fillType: 'json', lineCount: 2, fillHint: '2 body lines' },
      { slot: 'offer', fillType: 'offer', lineCount: 1, fillHint: 'Deal' },
    ],
  },
  {
    id: 'announcement',
    label: 'Announcement',
    description: 'Headline + 2 body lines',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Announcement' },
      { slot: 'body', fillType: 'json', lineCount: 2, fillHint: '2 body lines' },
    ],
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Configure zones yourself',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Headline' },
      { slot: 'subheadline', fillType: 'subheadline', lineCount: 1, fillHint: 'Support' },
    ],
  },
];

function isLayerDynamic(layer: BrandLayer): boolean {
  if (layer.fillMode) return layer.fillMode === 'dynamic';
  return layer.editable !== false && Boolean(layer.slot || layer.type === 'image');
}

function mediaUrl(url?: string | null): string {
  if (!url) return '';
  if (/^(https?:|data:)/.test(url)) return url;
  const [pathPart, query] = url.split('?');
  const encoded = pathPart
    .split('/')
    .map((seg) => {
      if (!seg) return '';
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return encodeURIComponent(seg);
      }
    })
    .join('/');
  return query ? `${encoded}?${query}` : encoded;
}

function layerLabel(layer: BrandLayer): string {
  const map: Record<string, string> = {
    logo: 'Logo',
    brand_name: 'Brand name',
    header_bar: 'Header bar',
    footer_bar: 'Footer bar',
    footer: 'Footer text',
    headline: 'Headline',
    subheadline: 'Subheadline',
    body: 'Body',
    hero_image: 'Hero image',
    offer: 'Offer',
  };
  return map[layer.id] || layer.slot || layer.id;
}

export default function BrandStudioWorkspace({
  forcedWorkspace,
  fullPage = true,
}: {
  forcedWorkspace: 'placid' | 'inhouse';
  fullPage?: boolean;
}) {
  const [templates, setTemplates] = useState<BrandTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [savingZones, setSavingZones] = useState(false);
  const [creating, setCreating] = useState(false);
  const [scaffolding, setScaffolding] = useState(false);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<'inhouse' | 'placid'>(forcedWorkspace);
  const [placidId, setPlacidId] = useState('');
  const [postType, setPostType] = useState('festival');
  const [presets, setPresets] = useState<PostPreset[]>(FALLBACK_PRESETS);
  const [placidConfigured, setPlacidConfigured] = useState(false);
  const [placidCatalog, setPlacidCatalog] = useState<PlacidCatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [syncingPlacid, setSyncingPlacid] = useState(false);
  const [placidKeyInput, setPlacidKeyInput] = useState('');
  const [savingPlacidKey, setSavingPlacidKey] = useState(false);
  const [workspace, setWorkspace] = useState<'placid' | 'inhouse'>(forcedWorkspace);
  const [selectedPlacidUuids, setSelectedPlacidUuids] = useState<string[]>([]);
  const [importingBulk, setImportingBulk] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [llmWarning, setLlmWarning] = useState('');

  useEffect(() => {
    setWorkspace(forcedWorkspace);
    setProvider(forcedWorkspace);
  }, [forcedWorkspace]);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) || null,
    [templates, selectedId],
  );

  /** Always holds the editor's latest draft — Save must not rely on stale render state. */
  const latestCanvasRef = useRef<BrandCanvas | null>(null);
  useEffect(() => {
    latestCanvasRef.current = selected?.canvas ?? null;
  }, [selected?.id, selected?.canvas]);

  const handleEditorCanvasChange = useCallback(
    (next: EditorCanvas) => {
      latestCanvasRef.current = next as BrandCanvas;
      setTemplates((prev) =>
        prev.map((template) =>
          template.id === selectedId
            ? { ...template, canvas: next as BrandCanvas }
            : template,
        ),
      );
    },
    [selectedId],
  );

  const isPlacid =
    selected?.provider === 'placid' || selected?.canvas?.designSource === 'placid';

  const layers = selected?.canvas?.layers || [];
  // Templates created before the Placid-style scaffold have no logo/header zones
  const isLegacyLayout =
    Boolean(selected) &&
    !isPlacid &&
    layers.length > 0 &&
    !layers.some((l) => l.id === 'logo' || l.id === 'header_bar');
  const dynamicCount = layers.filter((l) => l.id !== '_placid_note' && isLayerDynamic(l)).length;
  const staticCount = layers.filter(
    (l) => l.id !== '_placid_note' && l.type !== 'rect' && l.type !== 'ellipse' && !isLayerDynamic(l),
  ).length;

  const step1Done = Boolean(selected && (isPlacid ? selected.placidTemplateId : selected.backgroundUrl));
  const step2Done = Boolean(
    selected &&
      (isPlacid
        ? dynamicCount > 0
        : layers.some((l) => isLayerDynamic(l)) && layers.some((l) => !isLayerDynamic(l) || l.type === 'rect')),
  );
  const step3Done = step2Done;

  const load = async (preferId?: string) => {
    const r = await api<{
      data: BrandTemplate[];
      meta?: { placidConfigured?: boolean; postPresets?: PostPreset[] };
    }>('/brand/templates');
    setTemplates(r.data);
    const configured = Boolean(r.meta?.placidConfigured);
    setPlacidConfigured(configured);
    if (r.meta?.postPresets?.length) setPresets(r.meta.postPresets);
    const nextId = preferId || selectedId || (() => {
      const match = r.data.find((t) => {
        const placid = t.provider === 'placid' || t.canvas?.designSource === 'placid';
        return forcedWorkspace === 'placid' ? placid : !placid;
      });
      return match?.id || r.data[0]?.id || '';
    })();
    if (nextId) {
      setSelectedId(nextId);
      const picked = r.data.find((t) => t.id === nextId);
      if (picked) {
        const placid = picked.provider === 'placid' || picked.canvas?.designSource === 'placid';
        // Stay on the forced full-page workspace; don't jump to the other mode
        if (!fullPage) {
          setWorkspace(placid ? 'placid' : 'inhouse');
          setProvider(placid ? 'placid' : 'inhouse');
        }
        if (picked.canvas?.postType && picked.canvas.postType !== 'placid') {
          setPostType(picked.canvas.postType);
        }
        if (picked.placidTemplateId) setPlacidId(picked.placidTemplateId);
      }
    }
  };

  const loadPlacidCatalog = async (force = false) => {
    if (!force && !placidConfigured) return;
    setLoadingCatalog(true);
    try {
      const r = await api<{ data: PlacidCatalogItem[] }>('/brand/placid/templates');
      setPlacidCatalog(r.data || []);
    } catch (e) {
      setPlacidCatalog([]);
      setError(e instanceof Error ? e.message : 'Could not load design catalog');
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    load()
      .then(async () => {
        // Prefer Placid tab when API key is configured (checked inside load)
      })
      .catch((e) => setError(e.message));
    api<{ data: Record<string, unknown> }>('/settings/providers')
      .then((res) => {
        const d = res.data;
        if (d.llmProvider === 'claude' && !d.claudeApiKeySet) {
          setLlmWarning('Text model selected but no API key — add it in Settings → Integrations.');
        } else if (d.llmProvider === 'claude' && !d.claudeWorkspaceIdSet) {
          setLlmWarning('Text model needs a workspace ID in Settings → Integrations.');
        } else if (d.llmProvider === 'openai' && !d.openaiApiKeySet) {
          setLlmWarning('Text model selected but no API key — add it in Settings → Integrations.');
        } else {
          setLlmWarning('');
        }
      })
      .catch(() => undefined);
  }, []);

  // Prefer Placid only when not locked to a full-page workspace
  useEffect(() => {
    if (fullPage) return;
    if (placidConfigured && !selectedId) {
      setProvider('placid');
      setWorkspace('placid');
    }
  }, [placidConfigured, selectedId, fullPage]);

  useEffect(() => {
    if (placidConfigured) loadPlacidCatalog().catch(() => undefined);
  }, [placidConfigured]);

  const createTemplate = async (opts?: {
    provider?: 'inhouse' | 'placid';
    placidTemplateId?: string;
    templateName?: string;
  }) => {
    const nextProvider = opts?.provider || provider;
    const nextPlacidId = (opts?.placidTemplateId || placidId).trim();
    const nextName =
      (opts?.templateName || name).trim() ||
      (nextProvider === 'placid'
        ? placidCatalog.find((t) => t.uuid === nextPlacidId)?.title || 'Imported template'
        : '');

    if (!nextName) {
      setError('Enter a template name.');
      return;
    }
    if (nextProvider === 'placid' && !nextPlacidId) {
      setError('Pick a template from your connected design catalog.');
      return;
    }

    setCreating(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{ data: BrandTemplate }>('/brand/templates', {
        method: 'POST',
        body: {
          name: nextName,
          provider: nextProvider,
          placidTemplateId: nextProvider === 'placid' ? nextPlacidId : undefined,
          useDefaultCanvas: nextProvider === 'inhouse',
          postType: nextProvider === 'inhouse' ? postType : 'placid',
        },
      });
      setName('');
      setPlacidId(nextPlacidId);
      setOkMsg(
        nextProvider === 'placid'
          ? 'Template imported. Dynamic layers synced — generate in AI Assistant.'
          : 'Template created. Upload a plate to build an editable layout (logo, header, text, hero, footer).',
      );
      notifySuccess(nextProvider === 'placid' ? 'Template imported' : 'Template created');
      await load(res.data.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create template';
      setError(msg);
      notifyError(msg);
    } finally {
      setCreating(false);
    }
  };

  const uploadBg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedId) return;
    setUploading(true);
    setError('');
    setOkMsg('');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('templateId', selectedId);
    // Replace plate: keep existing Fixed/Dynamic zones instead of wiping the layout
    const hasLayout = Boolean(
      (latestCanvasRef.current || selected?.canvas)?.layers?.length,
    );
    if (hasLayout) fd.append('keepLayout', '1');
    try {
      const bitmap = await createImageBitmap(file);
      fd.append('canvasWidth', String(bitmap.width));
      fd.append('canvasHeight', String(bitmap.height));
      bitmap.close();
    } catch {
      // server reads dimensions via sharp
    }
    try {
      const res = await apiUpload<{
        data: BrandTemplate;
        meta?: { scaffolded?: boolean; note?: string };
      }>('/brand/templates/upload-background', fd);
      latestCanvasRef.current = res.data.canvas ?? null;
      setTemplates((prev) => prev.map((t) => (t.id === res.data.id ? res.data : t)));
      setOkMsg(
        res.meta?.note ||
          'Editable layout ready — drag zones, mark Fixed vs Dynamic, then Save design.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const scaffoldLayout = async () => {
    if (!selected) return;
    setScaffolding(true);
    setError('');
    try {
      const res = await api<{ data: BrandTemplate }>(`/brand/templates/${selected.id}`, {
        method: 'PATCH',
        body: { scaffoldLayout: true, postType: selected.canvas?.postType || postType },
      });
      setTemplates((prev) => prev.map((t) => (t.id === res.data.id ? res.data : t)));
      setOkMsg('Layout rebuilt: logo, header, headline, hero image, body, footer. Mark Fixed vs Dynamic.');
      notifySuccess('Layout applied');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not rebuild layout';
      setError(msg);
      notifyError(msg);
    } finally {
      setScaffolding(false);
    }
  };

  const applyPostType = async (id: string) => {
    if (!selected || isPlacid) return;
    setSavingZones(true);
    setError('');
    try {
      const res = await api<{ data: BrandTemplate }>(`/brand/templates/${selected.id}`, {
        method: 'PATCH',
        body: { postType: id, scaffoldLayout: true },
      });
      setTemplates((prev) => prev.map((t) => (t.id === res.data.id ? res.data : t)));
      setPostType(id);
      setOkMsg(`Applied “${presets.find((p) => p.id === id)?.label || id}” layout.`);
      notifySuccess(`Applied “${presets.find((p) => p.id === id)?.label || id}” layout`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not apply post type';
      setError(msg);
      notifyError(msg);
    } finally {
      setSavingZones(false);
    }
  };

  const saveZones = async (canvasFromEditor?: EditorCanvas) => {
    if (!selected) return;
    const canvas =
      (canvasFromEditor as BrandCanvas | undefined) ||
      latestCanvasRef.current ||
      selected.canvas;
    if (!canvas) return;
    setSavingZones(true);
    setError('');
    try {
      const res = await api<{ data: BrandTemplate }>(`/brand/templates/${selected.id}`, {
        method: 'PATCH',
        body: { canvas },
      });
      latestCanvasRef.current = res.data.canvas ?? (canvas as BrandCanvas);
      setTemplates((prev) => prev.map((t) => (t.id === res.data.id ? res.data : t)));
      setOkMsg('Design saved. Open AI Assistant to fill dynamic zones.');
      notifySuccess('Design saved');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setSavingZones(false);
    }
  };

  const updatePlacidLayerFill = async (
    layerId: string,
    patch: { fillType?: BrandFillType; fillHint?: string },
  ) => {
    if (!selected?.canvas) return;
    const nextLayers = (selected.canvas.layers || []).map((layer) => {
      if (layer.id !== layerId) return layer;
      const fillType = patch.fillType ?? layer.fillType ?? 'custom_text';
      const preset = TEXT_FILL_OPTIONS.find((o) => o.id === fillType);
      return {
        ...layer,
        ...patch,
        fillType,
        fillHint:
          patch.fillHint !== undefined
            ? patch.fillHint
            : patch.fillType
              ? preset?.hint || layer.fillHint
              : layer.fillHint,
      };
    });
    const nextCanvas = { ...selected.canvas, layers: nextLayers };
    latestCanvasRef.current = nextCanvas;
    setTemplates((prev) =>
      prev.map((t) => (t.id === selected.id ? { ...t, canvas: nextCanvas } : t)),
    );
    try {
      const res = await api<{ data: BrandTemplate }>(`/brand/templates/${selected.id}`, {
        method: 'PATCH',
        body: { canvas: nextCanvas },
      });
      setTemplates((prev) => prev.map((t) => (t.id === res.data.id ? res.data : t)));
      notifySuccess('Layer text role saved');
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Could not save layer role');
    }
  };

  const savePlacidKey = async () => {
    const key = placidKeyInput.trim();
    if (!key) {
      const msg = 'Paste your design-library API token from its project settings.';
      setError(msg);
      toast.error(msg);
      return;
    }
    if (/[→←]|ByteString/u.test(key) || [...key].some((ch) => ch.charCodeAt(0) > 255)) {
      const msg =
        'That paste includes special characters (like →). Copy only the raw API token from the design library project settings.';
      setError(msg);
      toast.error(msg);
      return;
    }
    setSavingPlacidKey(true);
    setError('');
    try {
      await api('/settings/providers', {
        method: 'PUT',
        body: { placidApiKey: key },
      });
      setPlacidKeyInput('');
      setPlacidConfigured(true);
      setProvider('placid');
      setOkMsg('Placid connected. Loading templates…');
      await loadPlacidCatalog(true);
      await load();
      setOkMsg('Placid connected. Use Import on a template below (or Select all new).');
      notifySuccess('Placid connected — templates loaded');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save API key';
      setError(msg);
      notifyError(msg);
    } finally {
      setSavingPlacidKey(false);
    }
  };

  const syncPlacid = async (uuid?: string) => {
    if (!selected) return;
    const id = (uuid || placidId || selected.placidTemplateId || '').trim();
    if (!id) {
      setError('This imported template has no external link. Re-import it from the catalog.');
      return;
    }
    setSyncingPlacid(true);
    setError('');
    try {
      const res = await api<{
        data: BrandTemplate;
        meta?: { dynamicLayers?: Array<{ name: string; type: string }>; placidTitle?: string };
      }>(`/brand/templates/${selected.id}/sync-placid`, {
        method: 'POST',
        body: { placidTemplateId: id },
      });
      setTemplates((prev) => prev.map((t) => (t.id === res.data.id ? res.data : t)));
      setPlacidId(id);
      const names = (res.meta?.dynamicLayers || []).map((l) => `${l.name}`).join(', ');
      setOkMsg(`Synced “${res.meta?.placidTitle || res.data.name}”. Dynamic: ${names || 'none'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Template sync failed');
    } finally {
      setSyncingPlacid(false);
    }
  };

  const deleteTemplate = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete template “${selected.name}”?`)) return;
    try {
      await api(`/brand/templates/${selected.id}`, { method: 'DELETE' });
      setSelectedId('');
      setOkMsg('Template deleted.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const isPlacidTemplate = (t: BrandTemplate) =>
    t.provider === 'placid' || t.canvas?.designSource === 'placid';

  const placidTemplates = templates.filter(isPlacidTemplate);
  const inhouseTemplates = templates.filter((t) => !isPlacidTemplate(t));
  const railTemplates = workspace === 'placid' ? placidTemplates : inhouseTemplates;

  const switchWorkspace = (next: 'placid' | 'inhouse') => {
    setWorkspace(next);
    setProvider(next);
    setError('');
    setOkMsg('');
    setSelectedPlacidUuids([]);
    const match = templates.find((t) => (next === 'placid' ? isPlacidTemplate(t) : !isPlacidTemplate(t)));
    if (match) {
      setSelectedId(match.id);
      if (match.canvas?.postType && match.canvas.postType !== 'placid') setPostType(match.canvas.postType);
      if (match.placidTemplateId) setPlacidId(match.placidTemplateId);
    } else {
      setSelectedId('');
    }
  };

  const selectTemplate = (t: BrandTemplate) => {
    setSelectedId(t.id);
    setError('');
    setOkMsg('');
    const placid = isPlacidTemplate(t);
    setWorkspace(placid ? 'placid' : 'inhouse');
    setProvider(placid ? 'placid' : 'inhouse');
    if (t.canvas?.postType && t.canvas.postType !== 'placid') setPostType(t.canvas.postType);
    if (t.placidTemplateId) setPlacidId(t.placidTemplateId);
  };

  const togglePlacidSelect = (uuid: string) => {
    setSelectedPlacidUuids((prev) =>
      prev.includes(uuid) ? prev.filter((u) => u !== uuid) : [...prev, uuid],
    );
  };

  const selectAllPlacidCatalog = () => {
    const imported = new Set(
      placidTemplates.map((t) => t.placidTemplateId).filter(Boolean) as string[],
    );
    const available = placidCatalog.map((t) => t.uuid).filter((u) => !imported.has(u));
    setSelectedPlacidUuids(available);
  };

  const importSelectedPlacid = async () => {
    const uuids = [...selectedPlacidUuids];
    if (!uuids.length) {
      setError('Select one or more templates to import.');
      return;
    }
    setImportingBulk(true);
    setCreating(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{
        data: {
          imported: Array<{ id: string; name: string }>;
          errors: Array<{ uuid: string; error: string }>;
          importedCount: number;
          failedCount: number;
        };
      }>('/brand/templates/import-placid-bulk', {
        method: 'POST',
        body: { uuids },
      });
      setSelectedPlacidUuids([]);
      const lastId = res.data.imported[res.data.imported.length - 1]?.id;
      await load(lastId);
      const failNote =
        res.data.failedCount > 0
          ? ` ${res.data.failedCount} failed: ${res.data.errors.map((e) => e.uuid.slice(0, 8)).join(', ')}.`
          : '';
      setOkMsg(
        `Imported ${res.data.importedCount} template${res.data.importedCount === 1 ? '' : 's'}.${failNote}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk import failed');
    } finally {
      setImportingBulk(false);
      setCreating(false);
    }
  };

  const importedPlacidIds = useMemo(
    () =>
      new Set(
        templates
          .filter((t) => t.provider === 'placid' || t.canvas?.designSource === 'placid')
          .map((t) => t.placidTemplateId)
          .filter(Boolean) as string[],
      ),
    [templates],
  );

  return (
      <div
        className={`animate-fade-in ${
          fullPage
            ? 'mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-[1800px] flex-col gap-4 p-3 sm:p-4 lg:p-5'
            : 'mx-auto max-w-[1600px] space-y-5'
        }`}
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {fullPage && (
              <BackButton href="/brand-studio" label="Back to Brand Studio" className="mb-3" />
            )}
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              {workspace === 'placid' ? (
                <Library className="text-brand-600" size={22} />
              ) : (
                <LayoutTemplate className="text-brand-600" size={22} />
              )}
              {fullPage
                ? workspace === 'placid'
                  ? 'Design library'
                  : 'In-house editor'
                : 'Brand Studio'}
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 max-w-2xl">
              {fullPage
                ? workspace === 'placid'
                  ? 'Full-screen design import — connect, multi-select, and manage dynamic layers without the cramped hub layout.'
                  : 'Full-screen in-house editor — upload plates and edit Fixed / Dynamic zones with the full canvas.'
                : 'Two separate workspaces: import finished designs from your design library, or build plates in the in-house editor.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {fullPage && (
              <>
                <Link
                  href={workspace === 'placid' ? '/brand-studio/inhouse' : '/brand-studio/placid'}
                  className="btn-secondary min-h-[44px] md:!min-h-[40px] gap-2"
                >
                  {workspace === 'placid' ? (
                    <>
                      <LayoutTemplate size={15} /> In-house editor
                    </>
                  ) : (
                    <>
                      <Library size={15} /> Design library
                    </>
                  )}
                </Link>
                <a
                  href={workspace === 'placid' ? '/brand-studio/placid' : '/brand-studio/inhouse'}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary min-h-[44px] md:!min-h-[40px] gap-2"
                  title="Open this workspace in a new browser tab"
                >
                  <ExternalLink size={15} /> New tab
                </a>
              </>
            )}
            {selected && (
              <Link
                href={`/ai-assistant?template=${encodeURIComponent(selected.id)}`}
                className="btn-primary min-h-[44px] md:!min-h-[40px] gap-2"
              >
                <MessageSquare size={16} />
                Open AI Assistant
              </Link>
            )}
          </div>
        </header>

        {!fullPage && (
        <div
          className="grid grid-cols-1 gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1.5 sm:grid-cols-2"
          role="tablist"
          aria-label="Brand Studio workspace"
        >
          <Link
            href="/brand-studio/placid"
            role="tab"
            aria-selected={workspace === 'placid'}
            className={`rounded-xl px-3 py-3.5 text-left transition-colors min-h-[56px] ${
              workspace === 'placid'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Library size={16} /> Design library
            </span>
            <span
              className={`mt-0.5 block text-[11px] leading-snug ${
                workspace === 'placid' ? 'text-white/80' : 'text-[hsl(var(--muted-foreground))]'
              }`}
            >
              Opens full page · import one or many
            </span>
          </Link>
          <Link
            href="/brand-studio/inhouse"
            role="tab"
            aria-selected={workspace === 'inhouse'}
            className={`rounded-xl px-3 py-3.5 text-left transition-colors min-h-[56px] ${
              workspace === 'inhouse'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <LayoutTemplate size={16} /> In-house editor
            </span>
            <span
              className={`mt-0.5 block text-[11px] leading-snug ${
                workspace === 'inhouse' ? 'text-white/80' : 'text-[hsl(var(--muted-foreground))]'
              }`}
            >
              Opens full page · upload plate &amp; zones
            </span>
          </Link>
        </div>
        )}

        <ol className="grid gap-2 sm:grid-cols-3 text-sm">
          {[
            {
              n: 1,
              label: workspace === 'placid' ? 'Import design' : 'Upload plate + layout',
              done: step1Done && ((workspace === 'placid') === isPlacid),
            },
            { n: 2, label: 'Fixed vs dynamic zones', done: step2Done && ((workspace === 'placid') === isPlacid) },
            { n: 3, label: 'Generate in AI Assistant', done: step3Done && ((workspace === 'placid') === isPlacid) },
          ].map((s) => (
            <li
              key={s.n}
              className={`rounded-xl border px-3 py-2.5 flex items-center gap-2 ${
                s.done
                  ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300'
                  : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  s.done ? 'bg-emerald-600 text-white' : 'bg-[hsl(var(--muted))]'
                }`}
              >
                {s.done ? <Check size={12} /> : s.n}
              </span>
              {s.label}
            </li>
          ))}
        </ol>

        {(error || okMsg || llmWarning) && (
          <div
            className={`rounded-xl px-3 py-2 text-sm ${
              error
                ? 'bg-red-500/10 text-red-600'
                : okMsg
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-500/10 text-amber-800 dark:text-amber-200'
            }`}
          >
            {error || okMsg || (
              <>
                {llmWarning}{' '}
                <Link href="/settings" className="underline font-medium">
                  Open Settings
                </Link>
              </>
            )}
          </div>
        )}

        <div
          className={`grid gap-4 ${
            fullPage
            ? 'flex-1 grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] min-h-0'
            : 'gap-5 xl:grid-cols-[360px_minmax(0,1fr)]'
          }`}
        >
          <aside className="space-y-4">
            {workspace === 'placid' ? (
              <>
                <section className="card space-y-3 !p-4">
                  <h2 className="text-sm font-semibold flex items-center gap-2">
                    <Library size={15} /> Design connection
                  </h2>

                  {placidConfigured ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2">
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                        Connected · {placidCatalog.length} in catalog
                      </p>
                      <button
                        type="button"
                        className="text-[11px] text-brand-600 inline-flex items-center gap-1 shrink-0"
                        onClick={() => loadPlacidCatalog(true)}
                        disabled={loadingCatalog}
                      >
                        <RefreshCw size={11} className={loadingCatalog ? 'animate-spin' : ''} />
                        Refresh
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-800 dark:text-amber-200 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
                      Not connected — paste your Placid API key below to load templates.
                    </p>
                  )}

                  <div className="rounded-xl border border-brand-600/35 bg-brand-600/5 p-3 space-y-2.5">
                    <p className="text-xs font-semibold flex items-center gap-1.5 text-brand-700 dark:text-brand-300">
                      <KeyRound size={14} /> Import with Placid API key
                    </p>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
                      Paste your <strong>project API token</strong> from{' '}
                      <a
                        className="underline text-brand-600"
                        href="https://placid.app/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Project → API Tokens
                      </a>
                      . We save it, load that project’s templates, then you import them below — same as before.
                    </p>
                    <PasswordInput
                      className="input text-xs"
                      placeholder="Paste Placid API token"
                      value={placidKeyInput}
                      onChange={(e) => setPlacidKeyInput(e.target.value)}
                      autoComplete="off"
                    />
                    <ProcessingButton
                      className="w-full min-h-[44px] md:!min-h-[40px] text-xs"
                      loading={savingPlacidKey}
                      loadingText={placidConfigured ? 'Updating…' : 'Connecting…'}
                      icon={<KeyRound size={13} />}
                      onClick={() => void savePlacidKey()}
                      disabled={!placidKeyInput.trim()}
                    >
                      {placidConfigured
                        ? 'Update key & reload templates'
                        : 'Connect & load templates'}
                    </ProcessingButton>
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                      Or manage the token under{' '}
                      <Link href="/settings" className="underline text-brand-600">
                        Settings → Integrations → Placid
                      </Link>
                      .
                    </p>
                  </div>
                </section>

                {placidConfigured && (
                  <section className="card space-y-3 !p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold">Your templates</h2>
                        <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
                          Templates from the connected API token. Tap <strong>Import</strong> — no UUID needed.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          className="text-brand-600 underline disabled:opacity-40"
                          disabled={!placidCatalog.length || creating}
                          onClick={selectAllPlacidCatalog}
                        >
                          Select all new
                        </button>
                        <button
                          type="button"
                          className="text-[hsl(var(--muted-foreground))] underline disabled:opacity-40"
                          disabled={!selectedPlacidUuids.length}
                          onClick={() => setSelectedPlacidUuids([])}
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {loadingCatalog && (
                      <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] py-4">
                        <Spinner size={14} /> Loading templates from your project…
                      </div>
                    )}
                    {!loadingCatalog && placidCatalog.length === 0 && (
                      <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-3 space-y-2">
                        <p className="text-xs font-medium">No templates in this project yet</p>
                        <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
                          In{' '}
                          <a
                            href="https://placid.app/"
                            className="underline text-brand-600"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open catalog
                          </a>
                          , create a template, mark layers as Dynamic, then click Refresh above.
                        </p>
                      </div>
                    )}

                    <ul className="grid gap-2.5 max-h-[420px] overflow-y-auto">
                      {placidCatalog.map((t) => {
                        const already = importedPlacidIds.has(t.uuid);
                        const checked = selectedPlacidUuids.includes(t.uuid);
                        return (
                          <li key={t.uuid}>
                            <div
                              className={`rounded-xl border overflow-hidden transition-colors ${
                                checked
                                  ? 'border-brand-600 bg-brand-600/5'
                                  : 'border-[hsl(var(--border))]'
                              } ${already ? 'opacity-80' : ''}`}
                            >
                              <div className="flex gap-2.5">
                                <button
                                  type="button"
                                  className="w-20 shrink-0 aspect-square bg-[hsl(var(--muted))] relative"
                                  disabled={creating || already}
                                  onClick={() => !already && togglePlacidSelect(t.uuid)}
                                  aria-label={already ? `${t.title} already imported` : `Select ${t.title}`}
                                >
                                  {t.thumbnail ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={t.thumbnail}
                                      alt=""
                                      className="absolute inset-0 h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-[hsl(var(--muted-foreground))]">
                                      <ImageIcon size={18} />
                                    </div>
                                  )}
                                </button>
                                <div className="min-w-0 flex-1 py-2.5 pr-2.5 space-y-2">
                                  <div className="flex items-start gap-2">
                                    {!already && (
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 accent-[hsl(var(--brand))]"
                                        checked={checked}
                                        disabled={creating}
                                        onChange={() => togglePlacidSelect(t.uuid)}
                                        aria-label={`Select ${t.title}`}
                                      />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-semibold truncate">{t.title}</p>
                                      <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                                        {t.layers?.length || 0} dynamic layer
                                        {(t.layers?.length || 0) === 1 ? '' : 's'}
                                        {already ? ' · already in library' : ''}
                                      </p>
                                    </div>
                                  </div>
                                  {already ? (
                                    <span className="inline-flex min-h-[36px] items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                                      <Check size={12} className="mr-1.5" /> Imported
                                    </span>
                                  ) : (
                                    <ProcessingButton
                                      className="w-full min-h-[44px] md:!min-h-[40px] !px-3 text-xs"
                                      loading={creating && !importingBulk && placidId === t.uuid}
                                      loadingText="Importing…"
                                      icon={<Plus size={13} />}
                                      disabled={creating}
                                      onClick={() => {
                                        setPlacidId(t.uuid);
                                        setName(t.title);
                                        void createTemplate({
                                          provider: 'placid',
                                          placidTemplateId: t.uuid,
                                          templateName: t.title,
                                        });
                                      }}
                                    >
                                      Import template
                                    </ProcessingButton>
                                  )}
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {placidCatalog.some((t) => !importedPlacidIds.has(t.uuid)) && (
                      <ProcessingButton
                        className="w-full"
                        disabled={!placidConfigured || selectedPlacidUuids.length === 0}
                        loading={importingBulk}
                        loadingText="Importing…"
                        icon={<Plus size={15} />}
                        onClick={() => void importSelectedPlacid()}
                      >
                        {selectedPlacidUuids.length === 0
                          ? 'Select templates to import'
                          : `Import ${selectedPlacidUuids.length} selected`}
                      </ProcessingButton>
                    )}
                  </section>
                )}
              </>
            ) : (
              <section className="card space-y-3 !p-4">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <LayoutTemplate size={15} /> New in-house template
                </h2>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
                  Create a blank plate, upload your design, then mark logo / header / text / hero / footer as Fixed or
                  Dynamic.
                </p>
                <div>
                  <label className="label">Name</label>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Festival square"
                  />
                </div>
                <div>
                  <label className="label">Post type</label>
                  <select className="input text-sm" value={postType} onChange={(e) => setPostType(e.target.value)}>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <ProcessingButton
                  className="w-full"
                  disabled={!name.trim()}
                  loading={creating}
                  loadingText="Creating…"
                  icon={<Plus size={15} />}
                  onClick={() => createTemplate({ provider: 'inhouse' })}
                >
                  Create in-house template
                </ProcessingButton>
              </section>
            )}

            <section className="card space-y-2 !p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {workspace === 'placid' ? 'Imported' : 'In-house templates'}
                </p>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {railTemplates.length} total
                </span>
              </div>
              {railTemplates.length === 0 && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {workspace === 'placid'
                    ? 'None imported yet — select templates above.'
                    : 'None yet — create one above, then upload a plate.'}
                </p>
              )}
              <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                {railTemplates.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => selectTemplate(t)}
                      className={`w-full text-left rounded-xl border px-3 py-2 text-sm transition-colors ${
                        selectedId === t.id
                          ? 'border-brand-600 bg-brand-600/10'
                          : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
                      }`}
                    >
                      <span className="font-medium block truncate">{t.name}</span>
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        {isPlacidTemplate(t) ? 'Imported' : 'In-house'}
                        {t.backgroundUrl || t.previewUrl ? ' · plate set' : ' · no plate'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {selected && ((workspace === 'placid') === isPlacid) && (
                <button
                  type="button"
                  className="btn-secondary w-full min-h-[44px] md:!min-h-[36px] text-xs text-red-600 gap-1"
                  onClick={() => void deleteTemplate()}
                >
                  <Trash2 size={13} /> Delete selected
                </button>
              )}
            </section>
          </aside>

          <main className="min-w-0 space-y-4">
            {(!selected || (workspace === 'placid') !== isPlacid) && (
              <section className="card flex min-h-[320px] flex-col items-center justify-center gap-2 text-center !p-8">
                {workspace === 'placid' ? (
                  <Library className="text-brand-600" size={28} />
                ) : (
                  <LayoutTemplate className="text-brand-600" size={28} />
                )}
                <p className="font-semibold">
                  {workspace === 'placid' ? 'Select or import a template' : 'Select or create an in-house template'}
                </p>
                <p className="text-sm text-[hsl(var(--muted-foreground))] max-w-md">
                  {workspace === 'placid'
                    ? 'Design stays in the source app. ContentPilot only fills dynamic layers after import.'
                    : 'Upload a brand plate here and edit zones Fixed vs Dynamic for AI Assistant.'}
                </p>
              </section>
            )}

            {selected && isPlacid && workspace === 'placid' && (
              <section className="card space-y-4 !p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{selected.name}</h2>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                      Design is locked in the source app. ContentPilot only fills dynamic layers. Static logo / chrome stay in
                      the source design.
                    </p>
                  </div>
                  <ProcessingButton
                    className="min-h-[44px] md:!min-h-[36px] !px-3 text-xs"
                    loading={syncingPlacid}
                    loadingText="Syncing…"
                    icon={<RefreshCw size={13} />}
                    onClick={() => syncPlacid()}
                  >
                    Re-sync from source
                  </ProcessingButton>
                </div>

                {(selected.previewUrl || selected.backgroundUrl) && (
                  <div className="rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted))] max-w-xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaUrl(selected.previewUrl || selected.backgroundUrl)}
                      alt="Template preview"
                      className="w-full object-contain max-h-[480px]"
                      decoding="async"
                    />
                  </div>
                )}

                <div>
                  <p className="label">Linked template</p>
                  <p className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 px-3 py-2.5 text-xs font-medium">
                    {selected.name}
                    <span className="mt-0.5 block font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                      {placidId || selected.placidTemplateId || '—'}
                    </span>
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium mb-1">
                    Dynamic layers ({dynamicCount}) — AI fills these
                  </p>
                  <p className="mb-2 text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
                    Picture layers get a photo URL only (the source app sizes it). For each text layer, pick what kind of copy
                    the text model should generate every time.
                  </p>
                  <ul className="space-y-2">
                    {layers
                      .filter((l) => l.id !== '_placid_note' && isLayerDynamic(l))
                      .map((l) => {
                        const isPicture =
                          l.type === 'image' ||
                          l.placidType === 'picture' ||
                          l.placidType === 'browserframe';
                        return (
                          <li
                            key={l.id}
                            className="rounded-xl border border-[hsl(var(--border))] px-3 py-2.5 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium truncate flex items-center gap-1.5 text-xs">
                                <Unlock size={12} className="text-brand-600 shrink-0" />
                                {l.slot || l.id}
                              </span>
                              <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">
                                {isPicture ? 'picture · image URL only' : 'text only'}
                              </span>
                            </div>
                            {!isPicture && (
                              <>
                                <label className="block space-y-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                                    Text type for AI
                                  </span>
                                  <select
                                    className="input min-h-[44px] md:!min-h-[40px] text-xs"
                                    value={l.fillType && TEXT_FILL_OPTIONS.some((o) => o.id === l.fillType) ? l.fillType : 'custom_text'}
                                    onChange={(e) =>
                                      void updatePlacidLayerFill(l.id, {
                                        fillType: e.target.value as BrandFillType,
                                      })
                                    }
                                  >
                                    {TEXT_FILL_OPTIONS.map((opt) => (
                                      <option key={opt.id} value={opt.id}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="block space-y-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                                    Prompt hint (sent to AI)
                                  </span>
                                  <input
                                    className="input min-h-[44px] md:!min-h-[40px] text-xs"
                                    defaultValue={l.fillHint || ''}
                                    placeholder="e.g. One benefit line under 8 words"
                                    onBlur={(e) => {
                                      const next = e.target.value.trim();
                                      if (next !== (l.fillHint || '').trim()) {
                                        void updatePlacidLayerFill(l.id, { fillHint: next });
                                      }
                                    }}
                                  />
                                </label>
                              </>
                            )}
                          </li>
                        );
                      })}
                    {dynamicCount === 0 && (
                      <li className="text-xs text-amber-700">
                        No dynamic layers — open the template in the source app, mark text/picture layers as Dynamic, then
                        Re-sync.
                      </li>
                    )}
                  </ul>
                </div>
              </section>
            )}

            {selected && !isPlacid && workspace === 'inhouse' && selected.canvas && (
              <>
                <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 sm:p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{selected.name}</p>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        {staticCount} fixed · {dynamicCount} dynamic · drag zones on the canvas, then toggle Fixed /
                        Dynamic in the inspector
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <select
                        className="input min-h-[44px] md:!min-h-[36px] !w-auto text-xs"
                        value={selected.canvas.postType || postType}
                        onChange={(e) => void applyPostType(e.target.value)}
                        disabled={savingZones || scaffolding}
                      >
                        {presets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <ProcessingButton
                        className="min-h-[44px] md:!min-h-[36px] !px-3 text-xs"
                        loading={scaffolding}
                        loadingText="Rebuilding…"
                        onClick={() => void scaffoldLayout()}
                      >
                        Rebuild layout
                      </ProcessingButton>
                    </div>
                  </div>

                  {isLegacyLayout && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                      This template still uses the old zone set (brand / subtext / accent). Click{' '}
                      <strong>Rebuild layout</strong> to get the standard editable layout: logo, header, headline,
                      hero image, body and footer.
                    </div>
                  )}

                  {!selected.backgroundUrl && (
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-brand-500/40 bg-brand-500/5 px-4 py-8 text-center hover:bg-brand-500/10">
                      {uploading ? <Spinner size={22} /> : <ImageIcon size={22} className="text-brand-600" />}
                      <span className="text-sm font-medium">
                        {uploading ? 'Uploading…' : 'Upload brand plate'}
                      </span>
                      <span className="text-[11px] text-[hsl(var(--muted-foreground))] max-w-sm">
                        We build an editable layout on top: logo, header, headline, hero image, body, footer — then you
                        mark Fixed vs Dynamic.
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        disabled={uploading}
                        onChange={uploadBg}
                      />
                    </label>
                  )}

                  {selected.backgroundUrl && layers.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5">
                      {layers
                        .filter((l) => l.type !== 'rect' && l.type !== 'ellipse')
                        .map((layer) => {
                          const dynamic = isLayerDynamic(layer);
                          return (
                            <li
                              key={layer.id}
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] ${
                                dynamic
                                  ? 'border-brand-500/40 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                                  : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
                              }`}
                            >
                              {dynamic ? <Unlock size={10} /> : <Lock size={10} />}
                              {layerLabel(layer)}
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </section>

                <InhouseTemplateEditor
                  key={selected.id}
                  canvas={selected.canvas as EditorCanvas}
                  backgroundUrl={selected.backgroundUrl}
                  saving={savingZones}
                  uploading={uploading}
                  defaultFullscreen={false}
                  fillViewport={fullPage}
                  onChange={handleEditorCanvasChange}
                  onSave={saveZones}
                  onUploadBackground={uploadBg}
                />
              </>
            )}
          </main>
        </div>

        <ProcessOverlay
          open={creating || uploading || scaffolding || syncingPlacid || importingBulk}
          title={
            importingBulk
              ? 'Importing templates…'
              : creating
                ? 'Setting up template…'
                : uploading
                  ? 'Building editable layout…'
                  : scaffolding
                    ? 'Rebuilding zones…'
                    : 'Syncing template…'
          }
        />
      </div>
  );
}
