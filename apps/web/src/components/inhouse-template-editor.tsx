'use client';

import {
  AlignCenter,
  AlignEndHorizontal,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignVerticalJustifyCenter,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Grid3X3,
  Image as ImageIcon,
  Italic,
  Lock,
  Magnet,
  Maximize2,
  Minimize2,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { apiUpload } from '@/lib/api';
import { InlineNotice, ProcessingButton, Spinner } from '@/components/ui';

export type EditorFillType =
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

export type EditorLayerType = 'text' | 'image' | 'rect' | 'ellipse';

export type EditorLayer = {
  id: string;
  type: EditorLayerType;
  x: number;
  y: number;
  w: number;
  h: number;
  slot?: string;
  text?: string;
  src?: string;
  fill?: string;
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngle?: number;
  strokeColor?: string;
  strokeWidth?: number;
  radius?: number;
  editable?: boolean;
  fillMode?: 'static' | 'dynamic';
  fillType?: EditorFillType;
  fillHint?: string;
  jsonSchema?: string;
  lineCount?: number;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  fontStyle?: 'normal' | 'italic';
  color?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textStrokeColor?: string;
  textStrokeWidth?: number;
  shadow?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
  highlight?: string;
  highlightPadding?: number;
  highlightRadius?: number;
  hidden?: boolean;
  locked?: boolean;
  opacity?: number;
  rotation?: number;
  textFit?: 'wrap' | 'fit' | 'single_line';
  imageFit?: 'cover' | 'contain';
};

export type EditorCanvas = {
  width?: number;
  height?: number;
  background?: { type: 'color' | 'image'; value: string };
  backgroundMode?: 'static' | 'dynamic';
  backgroundFit?: 'cover' | 'contain' | 'stretch';
  postType?: string;
  designSource?: 'placid' | 'inhouse';
  layers?: EditorLayer[];
};

type Props = {
  canvas: EditorCanvas;
  backgroundUrl?: string | null;
  onChange: (canvas: EditorCanvas) => void;
  /** Must persist the editor's local draft — parent React state may be one tick behind. */
  onSave: (canvas: EditorCanvas) => void | Promise<void>;
  onUploadBackground: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  saving?: boolean;
  uploading?: boolean;
  /** Start in overlay fullscreen (Escape to exit) */
  defaultFullscreen?: boolean;
  /** Expand editor to use the full workspace page height */
  fillViewport?: boolean;
};

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type PointerOperation = {
  kind: 'move' | 'resize';
  handle?: HandleId;
  layerId: string;
  startClientX: number;
  startClientY: number;
  startLayer: EditorLayer;
};

const FILL_TYPES: Array<{ id: EditorFillType; label: string; for: Array<'text' | 'image'> }> = [
  { id: 'headline', label: 'Headline', for: ['text'] },
  { id: 'subheadline', label: 'Subheadline', for: ['text'] },
  { id: 'body', label: 'Body text', for: ['text'] },
  { id: 'cta', label: 'Call to action', for: ['text'] },
  { id: 'hashtag', label: 'Hashtags', for: ['text'] },
  { id: 'date', label: 'Date / occasion', for: ['text'] },
  { id: 'offer', label: 'Offer / promo', for: ['text'] },
  { id: 'custom_text', label: 'Custom text', for: ['text'] },
  { id: 'json', label: 'Structured JSON lines', for: ['text'] },
  { id: 'image_prompt', label: 'AI image prompt', for: ['image'] },
  { id: 'image_url', label: 'Image URL', for: ['image'] },
];

const FONT_STACKS: Array<{ id: string; label: string }> = [
  { id: 'system-ui,Segoe UI,sans-serif', label: 'Inter / System' },
  { id: 'Helvetica Neue,Helvetica,Arial,sans-serif', label: 'Helvetica / Arial' },
  { id: 'Verdana,Geneva,sans-serif', label: 'Verdana' },
  { id: 'Trebuchet MS,sans-serif', label: 'Trebuchet' },
  { id: 'Impact,Haettenschweiler,sans-serif', label: 'Impact (poster)' },
  { id: 'Georgia,serif', label: 'Georgia (serif)' },
  { id: 'Times New Roman,Times,serif', label: 'Times (serif)' },
  { id: 'Palatino,Palatino Linotype,serif', label: 'Palatino (serif)' },
  { id: 'Courier New,Courier,monospace', label: 'Courier (mono)' },
];

const FONT_WEIGHTS = ['300', '400', '500', '600', '700', '800', '900'];

const CANVAS_PRESETS: Array<{ id: string; label: string; width: number; height: number }> = [
  { id: 'ig_square', label: 'Instagram square 1080×1080', width: 1080, height: 1080 },
  { id: 'ig_portrait', label: 'Instagram portrait 1080×1350', width: 1080, height: 1350 },
  { id: 'ig_story', label: 'Story / Reel 1080×1920', width: 1080, height: 1920 },
  { id: 'fb_link', label: 'Facebook link 1200×630', width: 1200, height: 630 },
  { id: 'li_post', label: 'LinkedIn 1200×627', width: 1200, height: 627 },
  { id: 'x_post', label: 'X / Twitter 1600×900', width: 1600, height: 900 },
  { id: 'pin', label: 'Pinterest 1000×1500', width: 1000, height: 1500 },
  { id: 'yt_thumb', label: 'YouTube thumb 1280×720', width: 1280, height: 720 },
];

const HANDLES: Array<{ id: HandleId; className: string; cursor: string }> = [
  { id: 'nw', className: '-left-1 -top-1', cursor: 'nwse-resize' },
  { id: 'n', className: 'left-1/2 -top-1 -translate-x-1/2', cursor: 'ns-resize' },
  { id: 'ne', className: '-right-1 -top-1', cursor: 'nesw-resize' },
  { id: 'e', className: '-right-1 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { id: 'se', className: '-right-1 -bottom-1', cursor: 'nwse-resize' },
  { id: 's', className: 'left-1/2 -bottom-1 -translate-x-1/2', cursor: 'ns-resize' },
  { id: 'sw', className: '-left-1 -bottom-1', cursor: 'nesw-resize' },
  { id: 'w', className: '-left-1 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

function cloneCanvas(canvas: EditorCanvas): EditorCanvas {
  return JSON.parse(JSON.stringify(canvas)) as EditorCanvas;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniqueId(prefix: string, layers: EditorLayer[]): string {
  let i = 1;
  let id = prefix;
  const ids = new Set(layers.map((layer) => layer.id));
  while (ids.has(id)) id = `${prefix}_${i++}`;
  return id;
}

function schemaForLines(count: number): string {
  return JSON.stringify(
    {
      lines: Array.from({ length: count }, (_, i) => ({
        index: i + 1,
        role: `Line ${i + 1}`,
        value: 'short on-image text',
      })),
      _rules: [`Return exactly ${count} lines`, 'Do not add or remove lines'],
    },
    null,
    2,
  );
}

function friendlyLayerName(layer: EditorLayer): string {
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

function mediaUrl(url?: string | null): string {
  if (!url) return '';
  if (/^(https?:|data:)/.test(url)) return url;
  const [path, query] = url.split('?');
  const encoded = path
    .split('/')
    .map((part) => {
      if (!part) return '';
      try {
        return encodeURIComponent(decodeURIComponent(part));
      } catch {
        return encodeURIComponent(part);
      }
    })
    .join('/');
  return query ? `${encoded}?${query}` : encoded;
}

function transformPreview(text: string, mode?: EditorLayer['textTransform']): string {
  if (mode === 'uppercase') return text.toUpperCase();
  if (mode === 'lowercase') return text.toLowerCase();
  if (mode === 'capitalize') return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return text;
}

function shapeBackground(layer: EditorLayer): string {
  if (layer.gradientFrom && layer.gradientTo) {
    return `linear-gradient(${layer.gradientAngle ?? 90}deg, ${layer.gradientFrom}, ${layer.gradientTo})`;
  }
  return layer.fill || '#6366f1';
}

function formatNumberFieldValue(value: number, step?: number): string {
  if (step && step < 1) {
    const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 2;
    return String(Number(value.toFixed(decimals)));
  }
  return String(Math.round(value));
}

/** Draft-while-typing number input — commits on blur / Enter so keystrokes don't thrash the canvas. */
function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => formatNumberFieldValue(value, step));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(formatNumberFieldValue(value, step));
  }, [value, step, focused]);

  const commit = () => {
    const raw = draft.trim();
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
      setDraft(formatNumberFieldValue(value, step));
      return;
    }
    let next = Number(raw);
    if (!Number.isFinite(next)) {
      setDraft(formatNumberFieldValue(value, step));
      return;
    }
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    if (!(step && step < 1)) next = Math.round(next);
    setDraft(formatNumberFieldValue(next, step));
    if (next !== value) onChange(next);
  };

  return (
    <label className="space-y-1">
      <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">{label}</span>
      <input
        type="number"
        className="input min-h-[44px] md:!min-h-[36px] text-xs"
        value={draft}
        min={min}
        max={max}
        step={step}
        onFocus={() => setFocused(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value?: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">{label}</span>
      <input
        type="color"
        className="h-9 w-full rounded border border-[hsl(var(--border))] bg-transparent"
        value={value || fallback}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 border-t border-[hsl(var(--border))] pt-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {title}
      </p>
      {children}
    </div>
  );
}

function IconToggle({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg p-1.5 hover:bg-[hsl(var(--muted))] sm:h-8 sm:w-8 sm:rounded ${
        active ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : ''
      }`}
    >
      {children}
    </button>
  );
}

export function InhouseTemplateEditor({
  canvas: canvasProp,
  backgroundUrl,
  onChange,
  onSave,
  onUploadBackground,
  saving,
  uploading,
  defaultFullscreen = false,
  fillViewport = false,
}: Props) {
  // Local working copy — parent sync is one-way emit, with guarded external reloads only.
  const [canvas, setCanvas] = useState<EditorCanvas>(() => cloneCanvas(canvasProp));
  const lastSentJsonRef = useRef(JSON.stringify(canvasProp));
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  useEffect(() => {
    const json = JSON.stringify(canvasProp);
    if (json === lastSentJsonRef.current) return;
    lastSentJsonRef.current = json;
    setCanvas(cloneCanvas(canvasProp));
  }, [canvasProp]);

  const emitChange = useCallback(
    (next: EditorCanvas) => {
      lastSentJsonRef.current = JSON.stringify(next);
      setCanvas(next);
      onChange(next);
    },
    [onChange],
  );

  const width = canvas.width || 1080;
  const height = canvas.height || 1080;
  const layers = canvas.layers || [];
  const [selectedId, setSelectedId] = useState<string>(layers[0]?.id || '');
  const [layerNameDraft, setLayerNameDraft] = useState(layers[0]?.id || '');
  const [history, setHistory] = useState<EditorCanvas[]>([]);
  const [future, setFuture] = useState<EditorCanvas[]>([]);
  const [zoom, setZoom] = useState<'fit' | '25' | '50' | '75' | '100' | '150'>('fit');
  const [fullscreen, setFullscreen] = useState(defaultFullscreen);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [uploadingLayer, setUploadingLayer] = useState(false);
  const [editorError, setEditorError] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportScrollRef = useRef({ left: 0, top: 0 });
  const operationRef = useRef<PointerOperation | null>(null);
  const operationSnapshotRef = useRef<EditorCanvas | null>(null);
  const clipboardRef = useRef<EditorLayer | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const pendingDragPatchRef = useRef<{ id: string; patch: Partial<EditorLayer> } | null>(null);

  const selected = useMemo(
    () => layers.find((layer) => layer.id === selectedId) || null,
    [layers, selectedId],
  );

  useEffect(() => {
    if (selectedId && layers.some((layer) => layer.id === selectedId)) return;
    setSelectedId(layers[0]?.id || '');
  }, [layers, selectedId]);

  useEffect(() => {
    setLayerNameDraft(selected?.id || '');
  }, [selected?.id]);

  // Keep canvas scroll position stable across layer/property updates
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { left, top } = viewportScrollRef.current;
    if (viewport.scrollLeft !== left || viewport.scrollTop !== top) {
      viewport.scrollLeft = left;
      viewport.scrollTop = top;
    }
  });

  const commit = useCallback(
    (next: EditorCanvas) => {
      setHistory((previous) => [...previous.slice(-49), cloneCanvas(canvasRef.current)]);
      setFuture([]);
      emitChange(next);
    },
    [emitChange],
  );

  const patchLayer = useCallback(
    (id: string, patch: Partial<EditorLayer>, record = true) => {
      const current = canvasRef.current;
      const next = {
        ...current,
        designSource: 'inhouse' as const,
        layers: (current.layers || []).map((layer) =>
          layer.id === id ? { ...layer, ...patch } : layer,
        ),
      };
      if (record) commit(next);
      else emitChange(next);
    },
    [commit, emitChange],
  );

  const snapToGridRef = useRef(snapToGrid);
  snapToGridRef.current = snapToGrid;

  const addLayer = (type: EditorLayerType) => {
    const current = canvasRef.current;
    const currentLayers = current.layers || [];
    const w = current.width || 1080;
    const h = current.height || 1080;
    const prefix =
      type === 'text' ? 'text' : type === 'image' ? 'image' : type === 'ellipse' ? 'ellipse' : 'shape';
    const id = uniqueId(prefix, currentLayers);
    const base = {
      id,
      x: Math.round(w * 0.12),
      y: Math.round(h * 0.2),
      opacity: 100,
      rotation: 0,
    };
    const nextLayer: EditorLayer =
      type === 'text'
        ? {
            ...base,
            type,
            w: Math.round(w * 0.76),
            h: Math.round(h * 0.11),
            slot: id,
            text: 'New text',
            fillMode: 'dynamic',
            editable: true,
            fillType: 'custom_text',
            lineCount: 1,
            fontSize: Math.round(h * 0.045),
            fontWeight: '700',
            fontFamily: FONT_STACKS[0].id,
            color: '#ffffff',
            align: 'center',
            valign: 'middle',
            lineHeight: 1.25,
            textFit: 'fit',
          }
        : type === 'image'
          ? {
              ...base,
              type,
              w: Math.round(w * 0.5),
              h: Math.round(h * 0.33),
              slot: id,
              src: '',
              fillMode: 'dynamic',
              editable: true,
              fillType: 'image_prompt',
              imageFit: 'cover',
              radius: 16,
            }
          : {
              ...base,
              type,
              w: Math.round(w * 0.5),
              h: Math.round(h * 0.2),
              fill: '#6366f1',
              fillMode: 'static',
              editable: false,
              opacity: 85,
              radius: type === 'rect' ? 12 : 0,
            };
    commit({ ...current, designSource: 'inhouse', layers: [...currentLayers, nextLayer] });
    setSelectedId(id);
  };

  const removeSelected = () => {
    const current = canvasRef.current;
    const currentLayers = current.layers || [];
    const sel = currentLayers.find((layer) => layer.id === selectedId);
    if (!sel) return;
    const index = currentLayers.findIndex((layer) => layer.id === sel.id);
    commit({ ...current, layers: currentLayers.filter((layer) => layer.id !== sel.id) });
    setSelectedId(currentLayers[index - 1]?.id || currentLayers[index + 1]?.id || '');
  };

  const duplicateSelected = () => {
    const current = canvasRef.current;
    const currentLayers = current.layers || [];
    const w = current.width || 1080;
    const h = current.height || 1080;
    const sel = currentLayers.find((layer) => layer.id === selectedId);
    if (!sel) return;
    const id = uniqueId(`${sel.id}_copy`, currentLayers);
    const copy = {
      ...cloneCanvas({ layers: [sel] }).layers![0],
      id,
      x: clamp(sel.x + 24, 0, w - sel.w),
      y: clamp(sel.y + 24, 0, h - sel.h),
    };
    if (copy.slot) copy.slot = id;
    commit({ ...current, layers: [...currentLayers, copy] });
    setSelectedId(id);
  };

  const reorder = (direction: -1 | 1) => {
    const current = canvasRef.current;
    const currentLayers = current.layers || [];
    const index = currentLayers.findIndex((layer) => layer.id === selectedId);
    if (index < 0) return;
    const target = clamp(index + direction, 0, currentLayers.length - 1);
    if (target === index) return;
    const nextLayers = [...currentLayers];
    [nextLayers[index], nextLayers[target]] = [nextLayers[target], nextLayers[index]];
    commit({ ...current, layers: nextLayers });
  };

  const sendTo = (edge: 'front' | 'back') => {
    const current = canvasRef.current;
    const currentLayers = current.layers || [];
    const sel = currentLayers.find((layer) => layer.id === selectedId);
    if (!sel) return;
    const rest = currentLayers.filter((layer) => layer.id !== sel.id);
    commit({
      ...current,
      layers: edge === 'front' ? [...rest, sel] : [sel, ...rest],
    });
  };

  const alignToCanvas = (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    const current = canvasRef.current;
    const w = current.width || 1080;
    const h = current.height || 1080;
    const sel = (current.layers || []).find((layer) => layer.id === selectedId);
    if (!sel || sel.locked) return;
    const patch: Partial<EditorLayer> = {};
    if (mode === 'left') patch.x = 0;
    if (mode === 'hcenter') patch.x = Math.round((w - sel.w) / 2);
    if (mode === 'right') patch.x = w - sel.w;
    if (mode === 'top') patch.y = 0;
    if (mode === 'vcenter') patch.y = Math.round((h - sel.h) / 2);
    if (mode === 'bottom') patch.y = h - sel.h;
    patchLayer(sel.id, patch);
  };

  const resizeCanvas = (nextWidth: number, nextHeight: number) => {
    const current = canvasRef.current;
    const prevW = current.width || 1080;
    const prevH = current.height || 1080;
    const w = clamp(Math.round(nextWidth), 240, 4096);
    const h = clamp(Math.round(nextHeight), 240, 4096);
    if (w === prevW && h === prevH) return;
    const scaleX = w / prevW;
    const scaleY = h / prevH;
    commit({
      ...current,
      width: w,
      height: h,
      layers: (current.layers || []).map((layer) => ({
        ...layer,
        x: Math.round(layer.x * scaleX),
        y: Math.round(layer.y * scaleY),
        w: Math.round(layer.w * scaleX),
        h: Math.round(layer.h * scaleY),
        ...(layer.fontSize
          ? { fontSize: Math.max(8, Math.round(layer.fontSize * Math.min(scaleX, scaleY))) }
          : {}),
      })),
    });
  };

  const uploadLayerImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selected || selected.type !== 'image') return;
    setUploadingLayer(true);
    setEditorError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await apiUpload<{ data: { publicUrl: string } }>(
        '/brand/templates/upload-layer-image',
        form,
      );
      patchLayer(selected.id, { src: response.data.publicUrl });
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Layer image upload failed');
    } finally {
      setUploadingLayer(false);
      event.target.value = '';
    }
  };

  const historyRef = useRef(history);
  historyRef.current = history;
  const futureRef = useRef(future);
  futureRef.current = future;

  const undo = useCallback(() => {
    const previous = historyRef.current.at(-1);
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [cloneCanvas(canvasRef.current), ...items.slice(0, 49)]);
    emitChange(previous);
  }, [emitChange]);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return;
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items.slice(-49), cloneCanvas(canvasRef.current)]);
    emitChange(next);
  }, [emitChange]);

  const flushDragPatch = useCallback(() => {
    dragRafRef.current = null;
    const pending = pendingDragPatchRef.current;
    if (!pending) return;
    pendingDragPatchRef.current = null;
    const current = canvasRef.current;
    emitChange({
      ...current,
      designSource: 'inhouse',
      layers: (current.layers || []).map((layer) =>
        layer.id === pending.id ? { ...layer, ...pending.patch } : layer,
      ),
    });
  }, [emitChange]);

  const requestSave = useCallback(() => {
    if (dragRafRef.current != null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    if (pendingDragPatchRef.current) flushDragPatch();
    const draft = cloneCanvas(canvasRef.current);
    lastSentJsonRef.current = JSON.stringify(draft);
    onChange(draft);
    return onSave(draft);
  }, [flushDragPatch, onChange, onSave]);

  const beginPointer = (
    event: ReactPointerEvent,
    layer: EditorLayer,
    kind: PointerOperation['kind'],
    handle?: HandleId,
  ) => {
    event.stopPropagation();
    setSelectedId(layer.id);
    // Locked layers stay selectable for inspector edits, but never drag
    if (layer.locked || layer.hidden) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    operationRef.current = {
      kind,
      handle,
      layerId: layer.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLayer: { ...layer },
    };
    operationSnapshotRef.current = cloneCanvas(canvasRef.current);
  };

  const movePointer = (event: ReactPointerEvent) => {
    const op = operationRef.current;
    const stage = stageRef.current;
    if (!op || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = ((event.clientX - op.startClientX) / rect.width) * width;
    const dy = ((event.clientY - op.startClientY) / rect.height) * height;
    const start = op.startLayer;
    const snapValue = (value: number) =>
      snapToGridRef.current ? Math.round(value / 10) * 10 : value;

    let patch: Partial<EditorLayer>;
    if (op.kind === 'move') {
      patch = {
        x: clamp(snapValue(start.x + dx), 0, width - start.w),
        y: clamp(snapValue(start.y + dy), 0, height - start.h),
      };
    } else {
      const handle = op.handle || 'se';
      let { x, y, w, h } = start;
      const minSize = 24;

      if (handle.includes('e')) w = clamp(snapValue(start.w + dx), minSize, width - start.x);
      if (handle.includes('s')) h = clamp(snapValue(start.h + dy), minSize, height - start.y);
      if (handle.includes('w')) {
        const nextX = clamp(snapValue(start.x + dx), 0, start.x + start.w - minSize);
        w = start.w + (start.x - nextX);
        x = nextX;
      }
      if (handle.includes('n')) {
        const nextY = clamp(snapValue(start.y + dy), 0, start.y + start.h - minSize);
        h = start.h + (start.y - nextY);
        y = nextY;
      }
      patch = { x, y, w, h };
    }

    pendingDragPatchRef.current = { id: op.layerId, patch };
    if (dragRafRef.current == null) {
      dragRafRef.current = requestAnimationFrame(flushDragPatch);
    }
  };

  const endPointer = () => {
    if (dragRafRef.current != null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    if (pendingDragPatchRef.current) flushDragPatch();
    if (!operationRef.current || !operationSnapshotRef.current) {
      operationRef.current = null;
      operationSnapshotRef.current = null;
      return;
    }
    setHistory((items) => [...items.slice(-49), operationSnapshotRef.current!]);
    setFuture([]);
    operationRef.current = null;
    operationSnapshotRef.current = null;
  };

  // Stable keyboard handler via refs — avoids re-binding every render
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const widthRef = useRef(width);
  widthRef.current = width;
  const heightRef = useRef(height);
  heightRef.current = height;
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  const patchLayerRef = useRef(patchLayer);
  patchLayerRef.current = patchLayer;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const requestSaveRef = useRef(requestSave);
  requestSaveRef.current = requestSave;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const modifier = event.metaKey || event.ctrlKey;
      const selectedLayer = selectedRef.current;
      const currentLayers = layersRef.current;
      const w = widthRef.current;
      const h = heightRef.current;
      const current = canvasRef.current;

      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void requestSaveRef.current();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoRef.current();
        else undoRef.current();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        if (!selectedLayer) return;
        const id = uniqueId(`${selectedLayer.id}_copy`, currentLayers);
        const copy = {
          ...cloneCanvas({ layers: [selectedLayer] }).layers![0],
          id,
          x: clamp(selectedLayer.x + 24, 0, w - selectedLayer.w),
          y: clamp(selectedLayer.y + 24, 0, h - selectedLayer.h),
        };
        if (copy.slot) copy.slot = id;
        commitRef.current({ ...current, layers: [...currentLayers, copy] });
        setSelectedId(id);
        return;
      }
      if (modifier && event.key.toLowerCase() === 'c' && selectedLayer) {
        clipboardRef.current = cloneCanvas({ layers: [selectedLayer] }).layers![0];
        return;
      }
      if (modifier && event.key.toLowerCase() === 'v' && clipboardRef.current) {
        event.preventDefault();
        const source = clipboardRef.current;
        const id = uniqueId(`${source.id}_copy`, currentLayers);
        const copy: EditorLayer = {
          ...source,
          id,
          slot: source.slot ? id : undefined,
          x: clamp(source.x + 24, 0, w - source.w),
          y: clamp(source.y + 24, 0, h - source.h),
        };
        commitRef.current({ ...current, layers: [...currentLayers, copy] });
        setSelectedId(id);
        return;
      }
      if (event.key === 'Escape' && fullscreenRef.current) {
        setFullscreen(false);
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLayer) {
        event.preventDefault();
        const index = currentLayers.findIndex((layer) => layer.id === selectedLayer.id);
        commitRef.current({
          ...current,
          layers: currentLayers.filter((layer) => layer.id !== selectedLayer.id),
        });
        setSelectedId(currentLayers[index - 1]?.id || currentLayers[index + 1]?.id || '');
        return;
      }
      if (
        selectedLayer &&
        !selectedLayer.locked &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        const patch: Partial<EditorLayer> = {};
        if (event.key === 'ArrowLeft') patch.x = clamp(selectedLayer.x - amount, 0, w - selectedLayer.w);
        if (event.key === 'ArrowRight') patch.x = clamp(selectedLayer.x + amount, 0, w - selectedLayer.w);
        if (event.key === 'ArrowUp') patch.y = clamp(selectedLayer.y - amount, 0, h - selectedLayer.h);
        if (event.key === 'ArrowDown') patch.y = clamp(selectedLayer.y + amount, 0, h - selectedLayer.h);
        patchLayerRef.current(selectedLayer.id, patch);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const canvasBackground = canvas.background?.type === 'color' ? canvas.background.value : '#0f172a';
  const canvasImage =
    canvas.background?.type === 'image' ? canvas.background.value : backgroundUrl;
  const activePreset = CANVAS_PRESETS.find((p) => p.width === width && p.height === height);

  return (
    <section
      className={
        fullscreen
          ? 'fixed inset-0 z-50 overflow-auto bg-[hsl(var(--background))] p-2 sm:p-4'
          : fillViewport
            ? 'flex min-h-[calc(100vh-9rem)] flex-col space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-sm sm:p-4'
            : 'space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Editable layout</p>
          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
            Drag zones · mark Fixed (locked brand) or Dynamic (AI fills) · Save design
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <select
            aria-label="Canvas size preset"
            className="input col-span-2 !min-h-[44px] text-xs sm:col-span-1 sm:!w-auto"
            value={activePreset?.id || 'custom'}
            onChange={(event) => {
              const preset = CANVAS_PRESETS.find((p) => p.id === event.target.value);
              if (preset) resizeCanvas(preset.width, preset.height);
            }}
          >
            {!activePreset && <option value="custom">Custom {width}×{height}</option>}
            {CANVAS_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <ProcessingButton
            className="!min-h-[44px] !px-3 text-xs sm:min-h-[44px] md:!min-h-[36px]"
            loading={saving}
            loadingText="Saving design…"
            icon={<Save size={13} />}
            onClick={() => void requestSave()}
          >
            Save design
          </ProcessingButton>
          <button
            type="button"
            className="btn-secondary !min-h-[44px] !px-3 text-xs sm:min-h-[44px] md:!min-h-[36px]"
            onClick={() => setFullscreen((value) => !value)}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {fullscreen ? 'Exit' : 'Fullscreen'}
          </button>
        </div>
      </div>
      {editorError && <InlineNotice kind="error">{editorError}</InlineNotice>}

      <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-2 scrollbar-none">
          <button type="button" className="btn-secondary shrink-0 !min-h-[44px] !px-2 text-[11px] sm:!min-h-[32px]" onClick={() => addLayer('text')}>
            <Type size={13} className="inline mr-1" /> Text
          </button>
          <button type="button" className="btn-secondary shrink-0 !min-h-[44px] !px-2 text-[11px] sm:!min-h-[32px]" onClick={() => addLayer('image')}>
            <ImageIcon size={13} className="inline mr-1" /> Image
          </button>
          <button type="button" className="btn-secondary shrink-0 !min-h-[44px] !px-2 text-[11px] sm:!min-h-[32px]" onClick={() => addLayer('rect')}>
            <Square size={13} className="inline mr-1" /> Box
          </button>
          <button type="button" className="btn-secondary shrink-0 !min-h-[44px] !px-2 text-[11px] sm:!min-h-[32px]" onClick={() => addLayer('ellipse')}>
            <Circle size={13} className="inline mr-1" /> Circle
          </button>

          <span className="mx-1 h-5 w-px bg-[hsl(var(--border))]" />
          <IconToggle title="Undo" onClick={undo}><Undo2 size={14} /></IconToggle>
          <IconToggle title="Redo" onClick={redo}><Redo2 size={14} /></IconToggle>

          <span className="mx-1 h-5 w-px bg-[hsl(var(--border))]" />
          <IconToggle title="Align left" onClick={() => alignToCanvas('left')}><AlignLeft size={14} /></IconToggle>
          <IconToggle title="Center horizontally" onClick={() => alignToCanvas('hcenter')}>
            <AlignHorizontalJustifyCenter size={14} />
          </IconToggle>
          <IconToggle title="Align right" onClick={() => alignToCanvas('right')}><AlignRight size={14} /></IconToggle>
          <IconToggle title="Align top" onClick={() => alignToCanvas('top')}><AlignStartHorizontal size={14} /></IconToggle>
          <IconToggle title="Center vertically" onClick={() => alignToCanvas('vcenter')}>
            <AlignVerticalJustifyCenter size={14} />
          </IconToggle>
          <IconToggle title="Align bottom" onClick={() => alignToCanvas('bottom')}><AlignEndHorizontal size={14} /></IconToggle>

          <span className="mx-1 h-5 w-px bg-[hsl(var(--border))]" />
          <IconToggle title="Bring to front" onClick={() => sendTo('front')}><ArrowUpToLine size={14} /></IconToggle>
          <IconToggle title="Send to back" onClick={() => sendTo('back')}><ArrowDownToLine size={14} /></IconToggle>

          <span className="mx-1 h-5 w-px bg-[hsl(var(--border))]" />
          <IconToggle title="Snap to 10px grid" active={snapToGrid} onClick={() => setSnapToGrid((v) => !v)}>
            <Magnet size={14} />
          </IconToggle>
          <IconToggle title="Toggle grid" active={showGrid} onClick={() => setShowGrid((v) => !v)}>
            <Grid3X3 size={14} />
          </IconToggle>
          <IconToggle title="Toggle safe area" active={showSafeArea} onClick={() => setShowSafeArea((v) => !v)}>
            <Square size={14} />
          </IconToggle>

          <select
            aria-label="Canvas zoom"
            className="ml-auto shrink-0 min-h-[44px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs md:min-h-0 md:rounded md:px-1.5 md:py-1 md:text-[11px]"
            value={zoom}
            onChange={(event) => setZoom(event.target.value as typeof zoom)}
          >
            <option value="fit">Fit</option>
            <option value="25">25%</option>
            <option value="50">50%</option>
            <option value="75">75%</option>
            <option value="100">100%</option>
            <option value="150">150%</option>
          </select>
          <label className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center whitespace-nowrap rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-2 text-xs hover:border-brand-500 md:min-h-0 md:rounded md:px-2 md:py-1.5 md:text-[11px]">
            {uploading ? <Spinner size={12} className="inline mr-1" /> : <ImageIcon size={12} className="inline mr-1" />}
            {uploading ? 'Uploading…' : canvasImage ? 'Replace plate' : 'Upload plate'}
            <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={onUploadBackground} />
          </label>
        </div>

        <div
          className={`grid min-h-0 lg:min-h-[560px] lg:grid-cols-[170px_minmax(0,1fr)_280px] ${
            fullscreen || fillViewport ? 'lg:h-[min(78vh,900px)]' : 'lg:h-[min(70vh,780px)]'
          }`}
        >
          <aside className="max-h-48 overflow-y-auto overscroll-contain border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 lg:max-h-none lg:h-full lg:border-b-0 lg:border-r">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Layers
              </p>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{layers.length}</span>
            </div>
            <ul className="space-y-1">
              {[...layers].reverse().map((layer) => (
                <li key={layer.id}>
                  <div
                    className={`flex items-center gap-1 rounded-lg border px-1.5 py-1.5 ${
                      selectedId === layer.id
                        ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                        : 'border-transparent hover:bg-[hsl(var(--muted))]'
                    }`}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px]"
                      onClick={() => setSelectedId(layer.id)}
                    >
                      {layer.type === 'text' ? (
                        <Type size={12} />
                      ) : layer.type === 'image' ? (
                        <ImageIcon size={12} />
                      ) : layer.type === 'ellipse' ? (
                        <Circle size={12} />
                      ) : (
                        <Square size={12} />
                      )}
                      <span className="min-w-0 flex-1 truncate">{friendlyLayerName(layer)}</span>
                      {layer.type !== 'rect' && layer.type !== 'ellipse' && (
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            layer.fillMode === 'dynamic' ? 'bg-brand-500' : 'bg-slate-400'
                          }`}
                          title={layer.fillMode === 'dynamic' ? 'Dynamic content' : 'Fixed content'}
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      title={layer.hidden ? 'Show layer' : 'Hide layer'}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] sm:h-7 sm:w-7 sm:rounded sm:p-0.5"
                      onClick={() => patchLayer(layer.id, { hidden: !layer.hidden })}
                    >
                      {layer.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      type="button"
                      title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] sm:h-7 sm:w-7 sm:rounded sm:p-0.5"
                      onClick={() => patchLayer(layer.id, { locked: !layer.locked })}
                    >
                      {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          <div
            ref={viewportRef}
            className="flex min-h-[320px] items-start justify-center overflow-auto overscroll-contain bg-slate-100 p-2 sm:p-4 dark:bg-slate-950 lg:min-h-0 lg:h-full"
            onScroll={(event) => {
              viewportScrollRef.current = {
                left: event.currentTarget.scrollLeft,
                top: event.currentTarget.scrollTop,
              };
            }}
          >
            <div
              ref={stageRef}
              className="relative shrink-0 overflow-hidden bg-slate-900 shadow-xl touch-none select-none"
              style={{
                aspectRatio: `${width} / ${height}`,
                containerType: 'inline-size',
                width:
                  zoom === 'fit'
                    ? fullscreen || fillViewport
                      ? 'min(100%, min(1100px, 92vmin))'
                      : 'min(100%, 720px)'
                    : `${Math.round(width * (Number(zoom) / 100))}px`,
                backgroundColor: canvasBackground,
              }}
              onPointerMove={movePointer}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onPointerDown={(event) => {
                // Only clear selection when clicking empty stage chrome (not a layer)
                if (event.target === event.currentTarget) setSelectedId('');
              }}
            >
              {canvasImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(canvasImage)}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  style={{
                    objectFit:
                      canvas.backgroundFit === 'stretch'
                        ? 'fill'
                        : canvas.backgroundFit === 'contain'
                          ? 'contain'
                          : 'cover',
                    objectPosition: 'center',
                    imageRendering: 'auto',
                  }}
                />
              )}
              {showGrid && (
                <div
                  className="pointer-events-none absolute inset-0 z-40 opacity-20"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, rgba(99,102,241,.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(99,102,241,.55) 1px, transparent 1px)',
                    backgroundSize: `${(50 / width) * 100}% ${(50 / height) * 100}%`,
                  }}
                />
              )}
              {showSafeArea && (
                <div className="pointer-events-none absolute inset-[5%] z-40 border border-dashed border-amber-300/80" />
              )}
              {selected && Math.abs(selected.x + selected.w / 2 - width / 2) <= 10 && (
                <div className="pointer-events-none absolute bottom-0 left-1/2 top-0 z-40 border-l border-fuchsia-400" />
              )}
              {selected && Math.abs(selected.y + selected.h / 2 - height / 2) <= 10 && (
                <div className="pointer-events-none absolute left-0 right-0 top-1/2 z-40 border-t border-fuchsia-400" />
              )}

              {layers.map((layer) => {
                if (layer.hidden) return null;
                const active = selectedId === layer.id;
                const style: React.CSSProperties = {
                  left: `${(layer.x / width) * 100}%`,
                  top: `${(layer.y / height) * 100}%`,
                  width: `${(layer.w / width) * 100}%`,
                  height: `${(layer.h / height) * 100}%`,
                  opacity: (layer.opacity ?? 100) / 100,
                  transform: `rotate(${layer.rotation || 0}deg)`,
                };
                const shadowCss = layer.shadow
                  ? `${layer.shadowX ?? 0}px ${layer.shadowY ?? 4}px ${layer.shadowBlur ?? 6}px ${
                      layer.shadowColor || 'rgba(0,0,0,0.45)'
                    }`
                  : undefined;

                return (
                  <div
                    key={layer.id}
                    className={`absolute ${layer.locked ? 'cursor-not-allowed' : 'cursor-move'} ${
                      active ? 'outline outline-2 outline-brand-500' : 'outline outline-1 outline-white/25'
                    }`}
                    style={style}
                    onPointerDown={(event) => beginPointer(event, layer, 'move')}
                  >
                    {(layer.type === 'rect' || layer.type === 'ellipse') && (
                      <div
                        className="h-full w-full"
                        style={{
                          background: shapeBackground(layer),
                          borderRadius:
                            layer.type === 'ellipse' ? '50%' : `${((layer.radius || 0) / width) * 100}cqw`,
                          border:
                            layer.strokeColor && (layer.strokeWidth ?? 0) > 0
                              ? `${layer.strokeWidth}px solid ${layer.strokeColor}`
                              : undefined,
                          boxShadow: shadowCss,
                        }}
                      />
                    )}
                    {layer.type === 'image' &&
                      (layer.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={mediaUrl(layer.src)}
                          alt=""
                          draggable={false}
                          decoding="async"
                          className={`h-full w-full pointer-events-none ${
                            layer.imageFit === 'contain' ? 'object-contain' : 'object-cover'
                          }`}
                          style={{
                            borderRadius: `${((layer.radius || 0) / width) * 100}cqw`,
                            boxShadow: shadowCss,
                            imageRendering: 'auto',
                          }}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center border border-dashed border-white/50 bg-black/20 text-[10px] text-white/80">
                          {layer.fillMode === 'dynamic'
                            ? `Dynamic image · ${layer.slot || layer.id}`
                            : 'Image URL required'}
                        </div>
                      ))}
                    {layer.type === 'text' && (
                      <div
                        className="flex h-full w-full overflow-hidden px-1 pointer-events-none"
                        style={{
                          color: layer.color || '#ffffff',
                          fontSize: `${((layer.fontSize || 36) / width) * 100}cqw`,
                          fontFamily: layer.fontFamily || 'system-ui',
                          fontWeight: layer.fontWeight || '600',
                          fontStyle: layer.fontStyle === 'italic' ? 'italic' : 'normal',
                          lineHeight: layer.lineHeight || 1.25,
                          letterSpacing: layer.letterSpacing
                            ? `${(layer.letterSpacing / width) * 100}cqw`
                            : undefined,
                          textShadow: shadowCss,
                          WebkitTextStroke:
                            layer.textStrokeColor && (layer.textStrokeWidth ?? 0) > 0
                              ? `${layer.textStrokeWidth}px ${layer.textStrokeColor}`
                              : undefined,
                          background: layer.highlight || undefined,
                          borderRadius: layer.highlightRadius
                            ? `${(layer.highlightRadius / width) * 100}cqw`
                            : undefined,
                          alignItems:
                            layer.valign === 'top'
                              ? 'flex-start'
                              : layer.valign === 'bottom'
                                ? 'flex-end'
                                : 'center',
                          justifyContent:
                            layer.align === 'left'
                              ? 'flex-start'
                              : layer.align === 'right'
                                ? 'flex-end'
                                : 'center',
                          textAlign: layer.align || 'center',
                          // Match renderer: wrap by default; single_line keeps one line (may shrink visually via overflow hidden)
                          whiteSpace:
                            (layer.textFit || 'fit') === 'single_line' ? 'nowrap' : 'pre-wrap',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {transformPreview(layer.text || `[${layer.slot || layer.id}]`, layer.textTransform)}
                      </div>
                    )}

                    {active && !layer.locked &&
                      HANDLES.map((handle) => (
                        <button
                          key={handle.id}
                          type="button"
                          aria-label={`Resize ${handle.id}`}
                          className={`absolute ${handle.className} h-2.5 w-2.5 border border-white bg-brand-600 shadow`}
                          style={{ cursor: handle.cursor }}
                          onPointerDown={(event) => beginPointer(event, layer, 'resize', handle.id)}
                        />
                      ))}
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="max-h-[50vh] overflow-y-auto overscroll-contain border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 lg:max-h-none lg:h-full lg:border-l lg:border-t-0">
            <div className="mb-3 space-y-2 border-b border-[hsl(var(--border))] pb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Canvas
              </p>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Width" value={width} min={240} max={4096} onChange={(v) => resizeCanvas(v, height)} />
                <NumberField label="Height" value={height} min={240} max={4096} onChange={(v) => resizeCanvas(width, v)} />
              </div>
              <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-[hsl(var(--border))] text-[10px]">
                {(['static', 'dynamic'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`px-2 py-1.5 capitalize ${
                      (canvas.backgroundMode || 'static') === mode
                        ? mode === 'dynamic'
                          ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300'
                          : 'bg-[hsl(var(--muted))]'
                        : ''
                    }`}
                    onClick={() =>
                      commit({ ...canvasRef.current, backgroundMode: mode })
                    }
                  >
                    {mode} background
                  </button>
                ))}
              </div>
              <label className="space-y-1 block">
                <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Plate fitting</span>
                <select
                  className="input min-h-[44px] md:!min-h-[34px] text-[11px]"
                  value={canvas.backgroundFit || 'cover'}
                  onChange={(event) =>
                    commit({
                      ...canvasRef.current,
                      backgroundFit: event.target.value as EditorCanvas['backgroundFit'],
                    })
                  }
                >
                  <option value="cover">Cover — crop to fill</option>
                  <option value="contain">Contain — show full design</option>
                  <option value="stretch">Stretch — fill exactly</option>
                </select>
              </label>
              {canvas.background?.type === 'color' && (
                <ColorField
                  label="Background color"
                  value={canvas.background.value}
                  fallback="#0f172a"
                  onChange={(value) =>
                    commit({ ...canvasRef.current, background: { type: 'color', value } })
                  }
                />
              )}
            </div>

            {!selected ? (
              <div className="py-16 text-center text-xs text-[hsl(var(--muted-foreground))]">
                Select a layer to edit its exact properties.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-1">
                  <IconToggle title="Duplicate" onClick={duplicateSelected}><Copy size={13} /></IconToggle>
                  <IconToggle title="Move layer up" onClick={() => reorder(1)}><ArrowUp size={13} /></IconToggle>
                  <IconToggle title="Move layer down" onClick={() => reorder(-1)}><ArrowDown size={13} /></IconToggle>
                  <IconToggle
                    title={selected.hidden ? 'Show' : 'Hide'}
                    onClick={() => patchLayer(selected.id, { hidden: !selected.hidden })}
                  >
                    {selected.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </IconToggle>
                  <IconToggle
                    title={selected.locked ? 'Unlock position' : 'Lock position'}
                    active={selected.locked}
                    onClick={() => patchLayer(selected.id, { locked: !selected.locked })}
                  >
                    {selected.locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </IconToggle>
                  <button
                    type="button"
                    title="Delete"
                    className="ml-auto inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-red-300 p-2 text-red-500 md:min-h-0 md:min-w-0 md:rounded md:p-1.5"
                    onClick={removeSelected}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {selected.locked && (
                  <button
                    type="button"
                    className="w-full rounded-lg border border-amber-300 bg-amber-500/10 px-2 py-1.5 text-left text-[10px] text-amber-800 dark:text-amber-200"
                    onClick={() => patchLayer(selected.id, { locked: false })}
                  >
                    Position is locked. Click to unlock and drag/resize.
                  </button>
                )}

                <label className="space-y-1 block">
                  <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Layer name</span>
                  <input
                    className="input min-h-[44px] md:!min-h-[36px] text-xs"
                    value={layerNameDraft}
                    onChange={(event) => {
                      setLayerNameDraft(event.target.value.replace(/[^a-zA-Z0-9_-]/g, '_'));
                    }}
                    onBlur={() => {
                      if (!selected) return;
                      const id = layerNameDraft.trim();
                      if (!id || id === selected.id) {
                        setLayerNameDraft(selected.id);
                        return;
                      }
                      if (layers.some((layer) => layer.id === id && layer.id !== selected.id)) {
                        setLayerNameDraft(selected.id);
                        return;
                      }
                      const oldId = selected.id;
                      commit({
                        ...canvas,
                        layers: layers.map((layer) =>
                          layer.id === oldId
                            ? { ...layer, id, slot: layer.slot === oldId ? id : layer.slot }
                            : layer,
                        ),
                      });
                      setSelectedId(id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        (event.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                </label>

                <InspectorSection title="Position & size">
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField label="X" value={selected.x} min={0} max={width} onChange={(v) => patchLayer(selected.id, { x: clamp(v, 0, width - selected.w) })} />
                    <NumberField label="Y" value={selected.y} min={0} max={height} onChange={(v) => patchLayer(selected.id, { y: clamp(v, 0, height - selected.h) })} />
                    <NumberField label="Width" value={selected.w} min={24} max={width} onChange={(v) => patchLayer(selected.id, { w: clamp(v, 24, width - selected.x) })} />
                    <NumberField label="Height" value={selected.h} min={24} max={height} onChange={(v) => patchLayer(selected.id, { h: clamp(v, 24, height - selected.y) })} />
                    <NumberField label="Opacity %" value={selected.opacity ?? 100} min={0} max={100} onChange={(v) => patchLayer(selected.id, { opacity: clamp(v, 0, 100) })} />
                    <NumberField label="Rotation °" value={selected.rotation || 0} min={0} max={359} onChange={(v) => patchLayer(selected.id, { rotation: clamp(v, 0, 359) })} />
                  </div>
                </InspectorSection>

                {selected.type !== 'rect' && selected.type !== 'ellipse' && (
                  <InspectorSection title="Content mode">
                    <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-[hsl(var(--border))] text-xs">
                      {(['static', 'dynamic'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`px-2 py-2.5 ${
                            (selected.fillMode || 'static') === mode
                              ? mode === 'dynamic'
                                ? 'bg-brand-500/10 font-medium text-brand-700 dark:text-brand-300'
                                : 'bg-[hsl(var(--muted))] font-medium'
                              : ''
                          }`}
                          onClick={() =>
                            patchLayer(selected.id, {
                              fillMode: mode,
                              editable: mode === 'dynamic',
                              slot: mode === 'dynamic' ? selected.slot || selected.id : selected.slot,
                            })
                          }
                        >
                          {mode === 'static' ? (
                            <Lock size={11} className="inline mr-1" />
                          ) : (
                            <Unlock size={11} className="inline mr-1" />
                          )}
                          {mode === 'static' ? 'Fixed' : 'Dynamic'}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-relaxed">
                      {(selected.fillMode || 'static') === 'dynamic'
                        ? 'AI Assistant fills this zone each post.'
                        : 'Stays as designed — logo, brand chrome, fixed copy.'}
                    </p>
                    {selected.fillMode === 'dynamic' && (
                      <>
                        <label className="space-y-1 block">
                          <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Dynamic slot name</span>
                          <input
                            className="input min-h-[44px] md:!min-h-[36px] text-xs"
                            value={selected.slot || ''}
                            onChange={(event) => patchLayer(selected.id, { slot: event.target.value }, false)}
                          />
                        </label>
                        <label className="space-y-1 block">
                          <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Fill type sent to the model</span>
                          <select
                            className="input min-h-[44px] md:!min-h-[36px] text-xs"
                            value={selected.fillType || (selected.type === 'image' ? 'image_prompt' : 'custom_text')}
                            onChange={(event) => patchLayer(selected.id, { fillType: event.target.value as EditorFillType })}
                          >
                            {FILL_TYPES.filter((item) => item.for.includes(selected.type as 'text' | 'image')).map((item) => (
                              <option key={item.id} value={item.id}>{item.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1 block">
                          <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">AI instruction</span>
                          <textarea
                            className="input min-h-[62px] text-xs"
                            value={selected.fillHint || ''}
                            onChange={(event) => patchLayer(selected.id, { fillHint: event.target.value }, false)}
                          />
                        </label>
                      </>
                    )}
                  </InspectorSection>
                )}

                {selected.type === 'text' && (
                  <>
                    <InspectorSection title="Text">
                      <label className="space-y-1 block">
                        <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                          {selected.fillMode === 'dynamic' ? 'Fallback text' : 'Fixed text'}
                        </span>
                        <textarea
                          className="input min-h-[62px] text-xs"
                          value={selected.text || ''}
                          onChange={(event) => patchLayer(selected.id, { text: event.target.value }, false)}
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Font</span>
                        <select
                          className="input min-h-[44px] md:!min-h-[36px] text-xs"
                          value={selected.fontFamily || FONT_STACKS[0].id}
                          onChange={(event) => patchLayer(selected.id, { fontFamily: event.target.value })}
                        >
                          {FONT_STACKS.map((font) => (
                            <option key={font.id} value={font.id}>{font.label}</option>
                          ))}
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <NumberField label="Font size" value={selected.fontSize || 36} min={8} max={400} onChange={(v) => patchLayer(selected.id, { fontSize: clamp(v, 8, 400) })} />
                        <label className="space-y-1">
                          <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Weight</span>
                          <select
                            className="input min-h-[44px] md:!min-h-[36px] text-xs"
                            value={selected.fontWeight || '600'}
                            onChange={(event) => patchLayer(selected.id, { fontWeight: event.target.value })}
                          >
                            {FONT_WEIGHTS.map((weight) => (
                              <option key={weight} value={weight}>{weight}</option>
                            ))}
                          </select>
                        </label>
                        <ColorField label="Color" value={selected.color} fallback="#ffffff" onChange={(v) => patchLayer(selected.id, { color: v })} />
                        <NumberField label="Line height" value={selected.lineHeight ?? 1.25} min={0.8} max={3} step={0.05} onChange={(v) => patchLayer(selected.id, { lineHeight: clamp(v, 0.8, 3) })} />
                        <NumberField label="Letter spacing" value={selected.letterSpacing ?? 0} min={-20} max={60} onChange={(v) => patchLayer(selected.id, { letterSpacing: clamp(v, -20, 60) })} />
                        <label className="space-y-1">
                          <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Case</span>
                          <select
                            className="input min-h-[44px] md:!min-h-[36px] text-xs"
                            value={selected.textTransform || 'none'}
                            onChange={(event) => patchLayer(selected.id, { textTransform: event.target.value as EditorLayer['textTransform'] })}
                          >
                            <option value="none">As typed</option>
                            <option value="uppercase">UPPERCASE</option>
                            <option value="lowercase">lowercase</option>
                            <option value="capitalize">Capitalize</option>
                          </select>
                        </label>
                      </div>

                      <div className="flex items-center gap-1">
                        <div className="grid flex-1 grid-cols-3 overflow-hidden rounded-lg border border-[hsl(var(--border))]">
                          {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(
                            ([align, Icon]) => (
                              <button
                                key={align}
                                type="button"
                                title={`Align ${align}`}
                                className={`flex min-h-[44px] items-center justify-center py-2 md:min-h-0 ${
                                  (selected.align || 'center') === align ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : ''
                                }`}
                                onClick={() => patchLayer(selected.id, { align })}
                              >
                                <Icon size={13} />
                              </button>
                            ),
                          )}
                        </div>
                        <IconToggle
                          title="Italic"
                          active={selected.fontStyle === 'italic'}
                          onClick={() =>
                            patchLayer(selected.id, {
                              fontStyle: selected.fontStyle === 'italic' ? 'normal' : 'italic',
                            })
                          }
                        >
                          <Italic size={13} />
                        </IconToggle>
                      </div>

                      <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-[hsl(var(--border))] text-[10px]">
                        {(['top', 'middle', 'bottom'] as const).map((valign) => (
                          <button
                            key={valign}
                            type="button"
                            className={`min-h-[44px] py-2 capitalize md:min-h-0 ${
                              (selected.valign || 'top') === valign ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : ''
                            }`}
                            onClick={() => patchLayer(selected.id, { valign })}
                          >
                            {valign}
                          </button>
                        ))}
                      </div>

                      <label className="space-y-1 block">
                        <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Text fitting</span>
                        <select
                          className="input min-h-[44px] md:!min-h-[36px] text-xs"
                          value={selected.textFit || 'fit'}
                          onChange={(event) => patchLayer(selected.id, { textFit: event.target.value as EditorLayer['textFit'] })}
                        >
                          <option value="fit">Shrink to fit box</option>
                          <option value="wrap">Wrap at font size</option>
                          <option value="single_line">Force single line</option>
                        </select>
                      </label>

                      {selected.fillMode === 'dynamic' && (
                        <>
                          <NumberField
                            label="Exact AI lines"
                            value={selected.lineCount || 1}
                            min={1}
                            max={8}
                            onChange={(value) => {
                              const count = clamp(value, 1, 8);
                              patchLayer(selected.id, {
                                lineCount: count,
                                fillType: count > 1 ? 'json' : selected.fillType,
                                jsonSchema: count > 1 ? schemaForLines(count) : selected.jsonSchema,
                              });
                            }}
                          />
                          {(selected.fillType === 'json' || (selected.lineCount || 1) > 1) && (
                            <label className="space-y-1 block">
                              <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">JSON line contract</span>
                              <textarea
                                className="input min-h-[120px] font-mono text-[10px]"
                                value={selected.jsonSchema || schemaForLines(selected.lineCount || 2)}
                                onChange={(event) => patchLayer(selected.id, { jsonSchema: event.target.value, fillType: 'json' }, false)}
                              />
                            </label>
                          )}
                        </>
                      )}
                    </InspectorSection>

                    <InspectorSection title="Text effects">
                      <div className="grid grid-cols-2 gap-2">
                        <ColorField label="Outline color" value={selected.textStrokeColor} fallback="#000000" onChange={(v) => patchLayer(selected.id, { textStrokeColor: v })} />
                        <NumberField label="Outline width" value={selected.textStrokeWidth ?? 0} min={0} max={20} onChange={(v) => patchLayer(selected.id, { textStrokeWidth: clamp(v, 0, 20) })} />
                        <ColorField label="Highlight box" value={selected.highlight} fallback="#111827" onChange={(v) => patchLayer(selected.id, { highlight: v })} />
                        <NumberField label="Highlight radius" value={selected.highlightRadius ?? 0} min={0} max={200} onChange={(v) => patchLayer(selected.id, { highlightRadius: clamp(v, 0, 200) })} />
                      </div>
                      {selected.highlight && (
                        <button
                          type="button"
                          className="text-[10px] text-red-500 underline"
                          onClick={() => patchLayer(selected.id, { highlight: undefined })}
                        >
                          Remove highlight box
                        </button>
                      )}
                    </InspectorSection>
                  </>
                )}

                {selected.type === 'image' && (
                  <InspectorSection title="Image">
                    <label className="block cursor-pointer rounded-lg border border-dashed border-[hsl(var(--border))] px-2 py-2 text-center text-[11px] hover:border-brand-500">
                      <ImageIcon size={12} className="inline mr-1" />
                      {uploadingLayer ? 'Uploading…' : 'Upload layer image'}
                      <input type="file" accept="image/*" className="sr-only" disabled={uploadingLayer} onChange={uploadLayerImage} />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                        {selected.fillMode === 'dynamic' ? 'Fallback image URL' : 'Fixed image URL'}
                      </span>
                      <input
                        className="input min-h-[44px] md:!min-h-[36px] text-xs"
                        value={selected.src || ''}
                        onChange={(event) => patchLayer(selected.id, { src: event.target.value }, false)}
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Fitting</span>
                        <select
                          className="input min-h-[44px] md:!min-h-[36px] text-xs"
                          value={selected.imageFit || 'cover'}
                          onChange={(event) => patchLayer(selected.id, { imageFit: event.target.value as EditorLayer['imageFit'] })}
                        >
                          <option value="cover">Cover box</option>
                          <option value="contain">Contain in box</option>
                        </select>
                      </label>
                      <NumberField label="Corner radius" value={selected.radius ?? 0} min={0} max={400} onChange={(v) => patchLayer(selected.id, { radius: clamp(v, 0, 400) })} />
                    </div>
                  </InspectorSection>
                )}

                {(selected.type === 'rect' || selected.type === 'ellipse') && (
                  <InspectorSection title="Shape">
                    <div className="grid grid-cols-2 gap-2">
                      <ColorField label="Fill" value={selected.fill} fallback="#6366f1" onChange={(v) => patchLayer(selected.id, { fill: v })} />
                      {selected.type === 'rect' && (
                        <NumberField label="Corner radius" value={selected.radius ?? 0} min={0} max={400} onChange={(v) => patchLayer(selected.id, { radius: clamp(v, 0, 400) })} />
                      )}
                      <ColorField label="Gradient from" value={selected.gradientFrom} fallback="#6366f1" onChange={(v) => patchLayer(selected.id, { gradientFrom: v })} />
                      <ColorField label="Gradient to" value={selected.gradientTo} fallback="#a855f7" onChange={(v) => patchLayer(selected.id, { gradientTo: v })} />
                      <NumberField label="Gradient angle" value={selected.gradientAngle ?? 90} min={0} max={359} onChange={(v) => patchLayer(selected.id, { gradientAngle: clamp(v, 0, 359) })} />
                      <ColorField label="Border color" value={selected.strokeColor} fallback="#ffffff" onChange={(v) => patchLayer(selected.id, { strokeColor: v })} />
                      <NumberField label="Border width" value={selected.strokeWidth ?? 0} min={0} max={40} onChange={(v) => patchLayer(selected.id, { strokeWidth: clamp(v, 0, 40) })} />
                    </div>
                    {(selected.gradientFrom || selected.gradientTo) && (
                      <button
                        type="button"
                        className="text-[10px] text-red-500 underline"
                        onClick={() => patchLayer(selected.id, { gradientFrom: undefined, gradientTo: undefined })}
                      >
                        Remove gradient (use solid fill)
                      </button>
                    )}
                  </InspectorSection>
                )}

                <InspectorSection title="Drop shadow">
                  <label className="flex items-center gap-2 text-[11px]">
                    <input
                      type="checkbox"
                      checked={Boolean(selected.shadow)}
                      onChange={(event) => patchLayer(selected.id, { shadow: event.target.checked })}
                    />
                    Enable shadow
                  </label>
                  {selected.shadow && (
                    <div className="grid grid-cols-2 gap-2">
                      <ColorField label="Shadow color" value={selected.shadowColor} fallback="#000000" onChange={(v) => patchLayer(selected.id, { shadowColor: v })} />
                      <NumberField label="Blur" value={selected.shadowBlur ?? 6} min={0} max={80} onChange={(v) => patchLayer(selected.id, { shadowBlur: clamp(v, 0, 80) })} />
                      <NumberField label="Offset X" value={selected.shadowX ?? 0} min={-60} max={60} onChange={(v) => patchLayer(selected.id, { shadowX: clamp(v, -60, 60) })} />
                      <NumberField label="Offset Y" value={selected.shadowY ?? 4} min={-60} max={60} onChange={(v) => patchLayer(selected.id, { shadowY: clamp(v, -60, 60) })} />
                    </div>
                  )}
                </InspectorSection>
              </div>
            )}
          </aside>
        </div>
      </div>
      <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
        Shortcuts: arrows move 1px · Shift+arrows 10px · ⌘/Ctrl+D duplicate · ⌘/Ctrl+C/V copy-paste · Delete removes ·
        ⌘/Ctrl+Z undo · ⌘/Ctrl+S save.
      </p>
    </section>
  );
}
