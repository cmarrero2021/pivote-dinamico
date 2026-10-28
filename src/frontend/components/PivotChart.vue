<template>
  <div class="pivot-chart-wrapper">

    <!-- ─── Chart Title ──────────────────────────────────────────────────────── -->
    <div v-if="chartData" class="pivot-title-bar q-px-sm q-pt-sm q-pb-xs bg-grey-1 border-bottom">
      <div class="text-subtitle2 text-blue-grey-9 cursor-pointer row items-center inline pivot-title-text">
        {{ chartTitleDisplay }}
        <q-icon name="edit" size="14px" class="q-ml-sm edit-icon" />
        <q-popup-edit v-slot="scope" v-model="editableChartTitle" auto-save anchor="bottom left">
          <q-input v-model="scope.value" dense autofocus placeholder="Título del gráfico" @keyup.enter="scope.set" />
        </q-popup-edit>
      </div>
    </div>

    <!-- ─── Controls bar ─────────────────────────────────────────────────────── -->
    <div v-if="chartData" class="pivot-controls-bar">
      <!-- Dataset count + mode -->
      <div class="row items-center q-gutter-xs text-caption text-grey-7">
        <q-icon :name="chartTypeIcon" size="14px" />
        <span><strong>{{ chartData.datasets.length }}</strong> {{ chartData.datasets.length === 1 ? 'serie' : 'series' }}</span>
        <span><strong>{{ chartData.labels.length }}</strong> {{ chartData.labels.length === 1 ? 'categoría' : 'categorías' }}</span>
        <span v-if="tableData.hasPivotColumns" class="pivot-mode-chip">Modo cruzado</span>
      </div>

      <div class="row items-center q-gutter-sm">
        <!-- Display mode toggle (values / % / both) -->
        <q-btn-toggle
          v-model="displayMode"
          dense flat
          toggle-color="primary"
          class="mode-toggle"
          :options="[
            { label: 'Valores', value: 'values' },
            { label: '%',       value: 'pct'    },
            { label: 'Ambos',   value: 'both'   },
          ]"
        />

        <q-separator vertical inset class="q-mx-xs" />

        <!-- Toggle Valores -->
        <q-toggle
          v-model="store.chartShowLabels"
          label="Valores"
          dense size="xs"
          color="primary"
          class="text-caption text-weight-medium text-grey-8"
        >
          <q-tooltip>Mostrar valores numéricos o porcentajes en la gráfica</q-tooltip>
        </q-toggle>

        <!-- Color texto para Valores (solo si Valores está activo) -->
        <q-btn
          v-if="store.chartShowLabels"
          flat round dense size="sm"
          icon="palette"
          :style="{ color: store.chartValueLabelColor || '#e11d48' }"
        >
          <q-tooltip>Color de texto de los valores / porcentajes</q-tooltip>
          <q-popup-proxy cover transition-show="scale" transition-hide="scale">
            <q-color v-model="store.chartValueLabelColor" no-header-tabs default-view="palette" />
          </q-popup-proxy>
        </q-btn>

        <!-- Toggle mostrar etiqueta de la serie (solo si no es torta ni dona) -->
        <q-toggle
          v-if="store.chartType !== 'pie' && store.chartType !== 'doughnut'"
          v-model="store.chartShowSeriesLabel"
          label="Etiqueta serie"
          dense size="xs"
          color="primary"
          class="text-caption text-weight-medium text-grey-8"
        >
          <q-tooltip>Mostrar el nombre de la serie/categoría en cada punto de la gráfica</q-tooltip>
        </q-toggle>

        <!-- Color texto para Etiqueta serie (solo si Etiqueta serie está activa y no es torta ni dona) -->
        <q-btn
          v-if="store.chartType !== 'pie' && store.chartType !== 'doughnut' && store.chartShowSeriesLabel"
          flat round dense size="sm"
          icon="format_color_text"
          :style="{ color: store.chartSeriesLabelColor || '#1e3b8b' }"
        >
          <q-tooltip>Color de texto de la etiqueta de serie</q-tooltip>
          <q-popup-proxy cover transition-show="scale" transition-hide="scale">
            <q-color v-model="store.chartSeriesLabelColor" no-header-tabs default-view="palette" />
          </q-popup-proxy>
        </q-btn>

        <!-- Chart height selector -->
        <div class="row items-center q-gutter-xs no-wrap">
          <q-icon name="height" size="13px" class="text-grey-6" />
          <q-select
            v-model="chartHeightOption"
            :options="heightOptions"
            dense outlined emit-value map-options
            class="rows-select"
            behavior="menu"
          />
        </div>
      </div>
    </div>

    <!-- ─── Scroll container ──────────────────────────────────────────────────── -->
    <div ref="canvasHost" class="pivot-chart-scroll" :style="chartScrollStyle">
      <!-- Inner wrapper with explicit height: Chart.js respeta este alto y el
           contenedor externo hace scroll cuando el contenido excede el viewport. -->
      <div v-if="chartData" class="pivot-chart-inner" :style="innerStyle">
        <canvas ref="chartCanvas"></canvas>
      </div>

      <!-- Empty state -->
      <div v-else class="pivot-empty text-center text-grey-5 q-pa-xl">
        <q-icon name="bar_chart" size="48px" class="q-mb-sm" />
        <div class="text-body2">Ejecuta una consulta para ver el gráfico aquí</div>
      </div>
    </div>

    <!-- ─── Inline rename series dialog ─────────────────────────────────────── -->
    <q-dialog v-model="renamePopup" persistent>
      <q-card style="min-width: 320px;">
        <q-card-section class="row items-center q-pb-none">
          <span class="text-weight-medium">Renombrar {{ renameKind === 'header' ? 'columna' : 'serie' }}</span>
          <q-space /><q-btn flat round dense icon="close" size="sm" @click="cancelRename" />
        </q-card-section>
        <q-card-section>
          <div class="text-caption text-grey-6 q-mb-sm">Original: "{{ renameOriginal }}"</div>
          <q-input
            ref="renameInput"
            v-model="renameValue"
            dense outlined autofocus
            placeholder="Nuevo nombre (vacío = restaurar)"
            @keyup.enter="commitRename"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat dense label="Cancelar" color="grey-7" size="sm" @click="cancelRename" />
          <q-btn flat dense label="Restaurar" color="warning" size="sm" @click="restoreRename" />
          <q-btn unelevated dense label="Aplicar" color="primary" size="sm" @click="commitRename" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, onBeforeUnmount, nextTick } from 'vue';
import { useDynamicQueryStore } from '../stores/dynamicQueryStore';
import {
  Chart, BarController, LineController, PieController, DoughnutController,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';

// Registrar controladores, elementos y plugins necesarios
Chart.register(
  BarController, LineController, PieController, DoughnutController,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
  ChartDataLabels
);

const props = defineProps({
  store: { type: Object, default: null },
});

const store = props.store || useDynamicQueryStore();
const chartCanvas = ref(null);
const canvasHost = ref(null);
let chartInstance = null;
const renameInput = ref(null);

// ─── Height presets ──────────────────────────────────────────────────────────
// Valores en px aplicados a la altura del inner wrapper. "fit" rellena la
// altura del contenedor padre (viewport-bound).
const heightOptions = [
  { label: 'Bajo',     value: 360  },
  { label: 'Normal',   value: 480  },
  { label: 'Alto',     value: 620  },
  { label: 'Muy alto', value: 820  },
  { label: 'Pantalla', value: 'fit' },
];
const chartHeightOption = ref(480);

// ─── Dynamic height for horizontal bar charts ────────────────────────────────
// En barras horizontales, Chart.js dibuja una barra por categoría en el eje Y;
// si el canvas es demasiado bajo, las barras se apelotan. Calculamos un mínimo
// según el número de categorías para que cada barra tenga ~28–36 px.
const HBAR_ROW_H = 32;     // px por categoría
const HBAR_BASE_H = 220;   // leyenda + márgenes mínimos
const HBAR_MAX_AUTOGROW = 2400; // tope para no hacer scroll infinito

// Altura lógica (px) del wrapper interno. Es lo que Chart.js usará como
// contenedor (gracias a maintainAspectRatio:false). Cuando supera la altura
// visible del host, el scroll vertical del contenedor externo entra en juego.
const innerHeight = computed(() => {
  if (!chartData.value) return null;
  const opt = chartHeightOption.value;
  if (opt === 'fit') return null;          // sin altura: el CSS fija 100%
  const isHbar = store.chartType === 'hbar';
  const preset = Number(opt) || 480;
  if (!isHbar) return preset;

  // Auto-grow según # de categorías
  const catCount = chartData.value.labels?.length || 1;
  const stacked = store.chartStacked;
  const denom = stacked ? 1 : Math.max(1, chartData.value.datasets.length);
  const derived = HBAR_BASE_H + catCount * HBAR_ROW_H * (stacked ? 1 : Math.min(denom, 3));
  return Math.max(preset, Math.min(derived, HBAR_MAX_AUTOGROW));
});

// Estilo inline del inner wrapper: fija la altura lógica del chart.
const innerStyle = computed(() => {
  if (innerHeight.value == null) {
    // "fit": rellena 100% del contenedor (Chart.js lo limita al viewport)
    return { height: '100%', minHeight: '320px' };
  }
  return { height: `${innerHeight.value}px` };
});

const chartScrollStyle = computed(() => {
  // El host siempre es viewport-bound; el inner crece y activa el scroll.
  if (chartHeightOption.value === 'fit') {
    return { maxHeight: 'calc(100vh - 220px)', minHeight: '320px' };
  }
  // Preset: limitamos el host a ~preset+chrome para que el scroll aparezca
  // cuando el inner (auto-grow en hbar) supera ese tamaño.
  const preset = Number(chartHeightOption.value) || 480;
  return { maxHeight: `${Math.max(preset, 480)}px`, minHeight: '320px' };
});

const chartTypeIcon = computed(() => {
  return ({
    bar: 'bar_chart',
    hbar: 'align_horizontal_left',
    line: 'show_chart',
    pie: 'pie_chart',
    doughnut: 'donut_large',
  })[store.chartType] || 'bar_chart';
});

// ─── Display mode (mirrors PivotTable) ────────────────────────────────────────
const displayMode = computed({
  get: () => store.pivotDisplayMode,
  set: (v) => { store.pivotDisplayMode = v; },
});

// ─── Editable chart title (mirrors PivotTable) ────────────────────────────────
const chartTitleDisplay = computed(() => {
  return store.chartTitle || store.currentQueryName || 'Gráfico Dinámico';
});
const editableChartTitle = computed({
  get: () => store.chartTitle,
  set: (v) => { store.chartTitle = (v || '').trim(); },
});

// ─── Color palette inspired by Excel ─────────────────────────────────────────
const COLORS = [
  '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5',
  '#70AD47', '#264478', '#9B57A2', '#636363', '#BDD7EE',
  '#F4B183', '#C9C9C9', '#FFE599', '#9DC3E6', '#A9D18E',
];

// ─── Shared number formatter (matches PivotTable style) ──────────────────────
const numberFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
function formatNum(val) {
  const n = Number(val);
  if (!isFinite(n)) return '';
  return numberFmt.format(n);
}

// ─── Normalize hex color (returns #RRGGBB if input is #RGB or #RRGGBB) ──────
function normalizeHex(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  const m = s.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
  return `#${hex}`;
}
function withAlpha(color, alpha) {
  const base = normalizeHex(color);
  if (!base) return color; // can't safely append alpha — keep as-is
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255).toString(16).padStart(2, '0');
  return `${base}${a}`;
}

// ─── Chart dataset construction ──────────────────────────────────────────────
const tableData = computed(() => store.pivotTableData);

// ─── Intercambio de ejes (filas ↔ series) ─────────────────────────────────────
// Cuando chartSwapAxes está activo, cada etiqueta (fila) se convierte en una
// serie y cada serie original pasa a ser una etiqueta. Solo tiene sentido en
// gráficos con 2+ series o categorías; en pie/dona se mantiene tal cual.
function maybeSwapAxes(chart, type, isPie) {
  if (!store.chartSwapAxes || isPie) return chart;
  const { labels, datasets } = chart;
  if (!datasets?.length || !labels?.length) return chart;
  const newLabels = datasets.map(ds => ds.label);
  const newDatasets = labels.map((label, li) => {
    const baseColor = store.chartCustomColors[label] || COLORS[li % COLORS.length];
    return {
      label,
      data: datasets.map(ds => ds.data[li] ?? 0),
      backgroundColor: withAlpha(baseColor, 1.0),
      borderColor: baseColor,
      borderWidth: type === 'line' ? 2 : 1,
      fill: type === 'line' ? store.chartFill : undefined,
      tension: 0.3,
    };
  });
  return { labels: newLabels, datasets: newDatasets };
}

const chartData = computed(() => {
  const td = store.pivotTableData;
  if (!td.bodyRows?.length) return null;

  const type = store.chartType;
  const isPie = type === 'pie' || type === 'doughnut';
  const pctMode = displayMode.value === 'pct';
  const grandSum = Object.values(td.grandTotals || {}).reduce((s, v) => s + (Number(v) || 0), 0);

  // Apply 100% normalization in pct mode for non-pie charts (stacked-like)
  const norm = (val) => {
    if (!pctMode || grandSum === 0) return Number(val) || 0;
    return (Number(val) || 0) / grandSum * 100;
  };

  if (td.hasPivotColumns) {
    // Cross-tab: labels = row values, datasets = column groups
    const rowKeys = td.headers.filter(h => h.isRowHeader).map(h => h.key);
    const labels = td.bodyRows.map(row =>
      store.resolveLabel('series', rowKeys.map(k => row[k] || '').join(' | '),
        rowKeys.map(k => row[k] || '').join(' | '))
    );
    const valueHeaders = td.headers.filter(h => h.isValue);

    if (isPie) {
      if (store.pivotRows.length === 0) {
        // No rows: each value (column+field combo) is a slice
        const sliceLabels = valueHeaders.map(h => `${h.label} - ${h.subLabel}`);
        const data = valueHeaders.map(h => td.bodyRows.reduce((sum, row) => sum + (Number(row[h.key]) || 0), 0));
        return {
          labels: sliceLabels.map(l => store.resolveLabel('series', l, l)),
          datasets: [{
            data: pctMode ? data.map(norm) : data,
            backgroundColor: valueHeaders.map((h, i) => store.chartCustomColors[`${h.label} - ${h.subLabel}`] || COLORS[i % COLORS.length]),
          }],
        };
      }
      // Pie: use SUM per row
      const data = td.bodyRows.map(row => valueHeaders.reduce((sum, h) => sum + (Number(row[h.key]) || 0), 0));
      return {
        labels,
        datasets: [{
          data: pctMode ? data.map(norm) : data,
          backgroundColor: labels.map((label, i) => store.chartCustomColors[label] || COLORS[i % COLORS.length]),
        }],
      };
    }

    // Group datasets by column value
    const colValuesSet = [...new Set(valueHeaders.map(h => h.label))];
    const baseAlpha = 1.0;
    const datasets = colValuesSet.map((cv, i) => {
      const colHeaders = valueHeaders.filter(h => h.label === cv);
      const baseColor = store.chartCustomColors[cv] || COLORS[i % COLORS.length];
      return {
        label: store.resolveLabel('series', cv, cv),
        data: td.bodyRows.map(row => norm(colHeaders.reduce((sum, h) => sum + (Number(row[h.key]) || 0), 0))),
        backgroundColor: withAlpha(baseColor, baseAlpha),
        borderColor: baseColor,
        borderWidth: 1,
      };
    });
    return maybeSwapAxes({ labels, datasets }, type, isPie);
  }

  // Simple table: labels from row fields, values from value fields
  const rowHeaderKeys = td.headers.filter((_, i) => i < store.pivotRows.length).map(h => h.key);
  const valueHeaderKeys = td.headers.filter((_, i) => i >= store.pivotRows.length);
  const labels = td.bodyRows.map(row =>
    store.resolveLabel('series', rowHeaderKeys.map(k => row[k] || '').join(' | '),
      rowHeaderKeys.map(k => row[k] || '').join(' | '))
  );

  if (isPie) {
    if (store.pivotRows.length === 0) {
      // No rows: each value field is a slice
      const data = valueHeaderKeys.map(h => td.bodyRows.reduce((sum, row) => sum + (Number(row[h.key]) || 0), 0));
      return {
        labels: valueHeaderKeys.map(h => store.resolveLabel('header', h.key, h.label)),
        datasets: [{
          data: pctMode ? data.map(norm) : data,
          backgroundColor: valueHeaderKeys.map((h, i) => store.chartCustomColors[h.label] || COLORS[i % COLORS.length]),
        }],
      };
    }
    // With rows: each slice = a row, value = SUM of measurement fields
    const data = td.bodyRows.map(row => valueHeaderKeys.reduce((sum, h) => sum + (Number(row[h.key]) || 0), 0));
    return {
      labels,
      datasets: [{
        data: pctMode ? data.map(norm) : data,
        backgroundColor: labels.map((label, i) => store.chartCustomColors[label] || COLORS[i % COLORS.length]),
      }],
    };
  }

  const baseAlpha = 1.0;
  const datasets = valueHeaderKeys.map((h, i) => {
    const baseColor = store.chartCustomColors[h.label] || COLORS[i % COLORS.length];
    return {
      label: store.resolveLabel('header', h.key, h.label),
      data: td.bodyRows.map(row => norm(Number(row[h.key]) || 0)),
      backgroundColor: withAlpha(baseColor, baseAlpha),
      borderColor: baseColor,
      borderWidth: type === 'line' ? 2 : 1,
      fill: type === 'line' ? store.chartFill : undefined,
      tension: 0.3,
    };
  });

  let result = { labels, datasets };
  return maybeSwapAxes(result, type, isPie);
});

// ─── Build the full Chart.js options object ──────────────────────────────────
function buildOptions() {
  const type = store.chartType;
  const isPie = type === 'pie' || type === 'doughnut';
  const isHorizontal = type === 'hbar';
  const pctMode = displayMode.value === 'pct';
  const bothMode = displayMode.value === 'both';
  const pctSuffix = pctMode ? '%' : '';
  // En 'both' los ejes usan valores reales; solo tooltip/datalabels muestran el %
  const grandSum = Object.values(store.pivotTableData.grandTotals || {}).reduce((s, v) => s + (Number(v) || 0), 0);

  // Formatea un valor del gráfico según el modo:
  //  - values: "12.345"
  //  - pct:    "34,6%"
  //  - both:   "12.345 (34,6%)"
  const fmtTick = (num) => formatNum(num) + pctSuffix;
  const fmtPoint = (num) => {
    if (bothMode) {
      const pct = grandSum ? ((num / grandSum) * 100).toFixed(1).replace('.', ',') : '';
      return `${formatNum(num)} (${pct}%)`;
    }
    return formatNum(num) + pctSuffix;
  };

  return {
    indexAxis: isHorizontal ? 'y' : 'x',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: isPie ? 'right' : 'top',
        labels: {
          font: { size: 12 },
          // En torta/dona: si el botón Valores está activo, los valores/porcentajes
          // se colocan horizontalmente junto al nombre de la serie en la leyenda.
          generateLabels: isPie ? (chart) => {
            const data = chart.data;
            const options = chart.legend?.options?.labels || {};
            if (data.labels?.length && data.datasets?.length) {
              const dataset = data.datasets[0];
              return data.labels.map((label, i) => {
                const meta = chart.getDatasetMeta(0);
                const style = meta?.controller?.getStyle ? meta.controller.getStyle(i) : {};
                const num = Number(dataset.data?.[i]) || 0;
                let text = label;
                if (store.chartShowLabels) {
                  text = `${label} - ${fmtPoint(num)}`;
                }
                return {
                  text,
                  fillStyle: style.backgroundColor || dataset.backgroundColor?.[i],
                  fontColor: options.color || '#334155',
                  hidden: !chart.getDataVisibility(i),
                  lineDash: style.borderDash,
                  lineDashOffset: style.borderDashOffset,
                  lineJoin: style.borderJoinStyle,
                  lineWidth: style.borderWidth,
                  strokeStyle: style.borderColor || dataset.borderColor?.[i],
                  textAlign: options.textAlign,
                  pointStyle: options.pointStyle,
                  borderRadius: options.useBorderRadius && (options.borderRadius || style.borderRadius),
                  index: i,
                };
              });
            }
            return [];
          } : undefined,
        },
      },
      title: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const val = isHorizontal ? ctx.parsed?.x : (ctx.parsed?.y ?? ctx.parsed ?? ctx.raw);
            const num = Number(val);
            if (!isFinite(num)) return '';
            return `${ctx.dataset.label || ctx.label}: ${fmtPoint(num)}`;
          },
        },
      },
      datalabels: {
        labels: {
          // ── Etiqueta de serie (nombre del dataset / categoría) ─────────────
          // En torta/dona se desactiva (el nombre va en la leyenda).
          // En barras/líneas funciona con su separación normal.
          seriesName: {
            display: () => isPie ? false : !!store.chartShowSeriesLabel,
            anchor: isHorizontal ? 'end' : 'end',
            align: (() => {
              const both = store.chartShowLabels && store.chartShowSeriesLabel;
              if (isHorizontal) return both ? 'top' : 'right';
              return 'top';
            })(),
            offset: (() => {
              const both = store.chartShowLabels && store.chartShowSeriesLabel;
              if (isHorizontal) return both ? 0 : 4;
              return both ? 18 : 4;
            })(),
            formatter: (val, ctx) => {
              if (!store.chartShowSeriesLabel) return '';
              const num = Number(val);
              if (isNaN(num) || num === 0) return '';
              if (ctx.chart.data.datasets?.length > 1) return ctx.dataset?.label || '';
              return ctx.chart.data.labels?.[ctx.dataIndex] || ctx.dataset?.label || '';
            },
            font: { weight: 'bold', size: 10 },
            color: () => store.chartSeriesLabelColor || '#1e3b8b',
            textStrokeColor: 'rgba(255,255,255,0.85)',
            textStrokeWidth: 2,
          },
          // ── Valor numérico ────────────────────────────────────────────────
          // En torta/dona se desactiva en el canvas (se muestra en la leyenda).
          // En barras/líneas sigue funcionando como lo hace actualmente.
          valueText: {
            display: () => isPie ? false : !!store.chartShowLabels,
            anchor: isHorizontal ? 'end' : 'end',
            align: (() => {
              const both = store.chartShowLabels && store.chartShowSeriesLabel;
              if (isHorizontal) return both ? 'bottom' : 'right';
              return 'top';
            })(),
            offset: (() => {
              const both = store.chartShowLabels && store.chartShowSeriesLabel;
              if (isHorizontal) return both ? 1 : 4;
              return both ? 4 : 4;
            })(),
            formatter: (val) => {
              if (!store.chartShowLabels) return '';
              const num = Number(val);
              if (isNaN(num) || num === 0) return '';
              return fmtPoint(num);
            },
            font: { weight: 'bold', size: 10 },
            color: () => store.chartValueLabelColor || '#334155',
            textStrokeColor: 'rgba(255,255,255,0.85)',
            textStrokeWidth: 2,
          }
        }
      },
    },
    scales: isPie ? {} : {
      x: {
        stacked: store.chartStacked,
        beginAtZero: isHorizontal,
        grid: { display: !isHorizontal },
        ticks: isHorizontal ? {
          callback: val => fmtTick(Number(val)),
        } : {},
      },
      y: {
        stacked: store.chartStacked,
        beginAtZero: !isHorizontal,
        grid: { display: isHorizontal },
        ticks: !isHorizontal ? {
          callback: val => fmtTick(Number(val)),
        } : {},
      },
    },
  };
}

// ─── Recreate vs. update decision ────────────────────────────────────────────
// Properties requiring full destroy+create. Changes to data, options, colors
// or label visibility can be applied via `chartInstance.update()`.
function shouldRecreate(prev, next) {
  if (!prev || !next) return true;
  if (prev.type !== next.type) return true;
  if ((prev.type === 'hbar') !== (next.type === 'hbar')) return true;
  if (!!prev.pivotMode !== !!next.pivotMode) return true;
  if (prev.stacked !== next.stacked) return true;
  if (prev.displayMode !== next.displayMode) return true;
  if (prev.showLabels !== next.showLabels) return true;
  if (prev.showSeriesLabel !== next.showSeriesLabel) return true;
  if (prev.valueLabelColor !== next.valueLabelColor) return true;
  if (prev.seriesLabelColor !== next.seriesLabelColor) return true;
  return false;
}

let lastSignature = null;

function buildSignature() {
  const td = store.pivotTableData;
  return {
    type: store.chartType,
    pivotMode: !!td.hasPivotColumns && store.pivotRows.length === 0,
    stacked: store.chartStacked,
    displayMode: store.pivotDisplayMode,
    showLabels: store.chartShowLabels,
    showSeriesLabel: store.chartShowSeriesLabel,
    valueLabelColor: store.chartValueLabelColor,
    seriesLabelColor: store.chartSeriesLabelColor,
  };
}

function renderChart() {
  if (!chartCanvas.value) return;
  if (!chartData.value) {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    lastSignature = null;
    return;
  }

  const sig = buildSignature();
  const recreate = shouldRecreate(lastSignature, sig);
  lastSignature = sig;

  if (recreate || !chartInstance) {
    if (chartInstance) chartInstance.destroy();
    const type = store.chartType;
    const chartJsType = type === 'hbar' ? 'bar' : type;
    chartInstance = new Chart(chartCanvas.value, {
      type: chartJsType,
      data: chartData.value,
      options: buildOptions(),
    });
  } else {
    // Light update: mutate existing instance in place.
    chartInstance.data = chartData.value;
    chartInstance.options = buildOptions();
    chartInstance.update();
  }
}

// ─── Export functions ────────────────────────────────────────────────────────
function exportPNG() {
  if (!chartCanvas.value) return;
  const url = chartCanvas.value.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = 'grafico-dashboard.png'; a.click();
}

async function exportPDF() {
  if (!chartCanvas.value) return;
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF('landscape', 'mm', 'a4');
  const imgData = chartCanvas.value.toDataURL('image/png');
  // Use rendered size for accurate aspect ratio
  const rect = chartCanvas.value.getBoundingClientRect();
  const w = pdf.internal.pageSize.getWidth() - 20;
  const ratio = rect.width > 0 ? rect.height / rect.width : 0.6;
  const h = w * ratio;
  pdf.addImage(imgData, 'PNG', 10, 10, w, h);
  pdf.save('grafico-dashboard.pdf');
}

defineExpose({ exportPNG, exportPDF, startRename });

// ─── Watchers ────────────────────────────────────────────────────────────────
// Shallow watch on chartData (computed returns a fresh ref when its deps change).
// For reactive *objects* (chartCustomColors, customLabels) we snapshot via a
// spreading arrow so mutations of inner properties actually trigger renders.
watch(
  [
    chartData,
    () => store.chartType,
    () => store.chartStacked,
    () => store.chartShowLabels,
    () => store.chartShowSeriesLabel,
    () => store.chartValueLabelColor,
    () => store.chartSeriesLabelColor,
    () => store.chartFill,
    () => store.chartSwapAxes,
    () => ({ ...store.chartCustomColors }),
    () => ({ ...store.customLabels }),
    () => store.pivotDisplayMode,
  ],
  () => { nextTick(renderChart); }
);

onMounted(() => { if (chartData.value) nextTick(renderChart); });
onBeforeUnmount(() => {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  lastSignature = null;
});
onUnmounted(() => {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
});

// ─── Inline rename (mirrors PivotTable) ──────────────────────────────────────
const renamePopup    = ref(false);
const renameKind     = ref('header');
const renameKey      = ref('');
const renameOriginal = ref('');
const renameValue    = ref('');

function startRename(header, kind = 'header') {
  renameKind.value     = kind;
  renameKey.value      = header.key;
  renameOriginal.value = header.label || '';
  renameValue.value    = store.customLabels[`${kind}::${header.key}`] || '';
  renamePopup.value    = true;
}
function commitRename() {
  store.setCustomLabel(renameKind.value, renameKey.value, (renameValue.value || '').trim());
  renamePopup.value = false;
}
function restoreRename() {
  store.setCustomLabel(renameKind.value, renameKey.value, '');
  renamePopup.value = false;
}
function cancelRename() { renamePopup.value = false; }
</script>

<style scoped>
/* ─── Wrapper ────────────────────────────────────────────────────────────────── */
.pivot-chart-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: 'Roboto', 'Segoe UI', -apple-system, sans-serif;
}

/* ─── Title bar (mirrors PivotTable) ─────────────────────────────────────────── */
.pivot-title-bar { border-bottom: 1px solid #e0e0e0; }
.pivot-title-text .edit-icon { opacity: 0.3; transition: opacity 0.2s; }
.pivot-title-text:hover .edit-icon { opacity: 1; color: #1976d2; }

/* ─── Controls bar ───────────────────────────────────────────────────────────── */
.pivot-controls-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  padding: 5px 10px;
  background: #fafafa;
  border-bottom: 1px solid #e0e0e0;
  font-size: 12px;
}

.pivot-mode-chip {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 10px;
  background: #e3f2fd;
  color: #1565c0;
  font-size: 10.5px;
  font-weight: 600;
}

/* Compact select */
.rows-select { min-width: 105px; }
.rows-select :deep(.q-field__control) { height: 26px; min-height: 26px; padding: 0 8px; font-size: 11.5px; }
.rows-select :deep(.q-field__native)  { font-size: 11.5px; padding: 0; min-height: unset; }
.rows-select :deep(.q-field__append)  { height: 26px; }

.mode-toggle { border: 1px solid #e0e0e0; border-radius: 4px; background: #f5f5f5; font-size: 11.5px; }
.mode-toggle :deep(.q-btn) { padding: 0 8px; height: 24px; font-size: 11.5px; min-height: unset; }

/* ─── Scroll area ───────────────────────────────────────────────────────────── */
.pivot-chart-scroll {
  flex: 1;
  position: relative;
  overflow-y: auto;
  overflow-x: hidden;
  display: block;
  padding: 10px;
  background: #fafafa;
  min-height: 320px;
}

/* Inner wrapper: altura lógica (preset o auto-grow). El canvas la rellena. */
.pivot-chart-inner {
  width: 100%;
}
.pivot-chart-inner canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
}

/* ── Empty state ─────────────────────────────────────────────────────────────── */
.pivot-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  color: #9e9e9e;
  position: absolute;
  inset: 0;
  background: #fafafa;
}
</style>
