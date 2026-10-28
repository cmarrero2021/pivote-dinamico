// src/frontend/stores/dynamicQueryStore.js
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { getHttp as http, getBasePath as _basePath } from '../http';

// The HTTP client is configured by the host application through
// configurePivotApi() (see ../http.js). Re-exported here for convenience.
export { configurePivotApi } from '../http';

// ─── Catálogo de operadores de filtro ─────────────────────────────────────────
// `kind`: 'text' | 'numeric' | 'date' — determina qué operadores mostrar según
// el tipo de campo. `arity`: 1 (solo value) | 2 (value + value2) | 0 (sin value)
export const FILTER_OPERATORS = [
  { value: 'eq',       label: 'Igual a',                    kind: 'all',     arity: 1 },
  { value: 'neq',      label: 'Diferente de',               kind: 'all',     arity: 1 },
  { value: 'like',     label: 'Contiene',                   kind: 'text',    arity: 1 },
  { value: 'nlike',    label: 'No contiene',                kind: 'text',    arity: 1 },
  { value: 'sw',       label: 'Comienza con',               kind: 'text',    arity: 1 },
  { value: 'nsw',      label: 'No comienza con',            kind: 'text',    arity: 1 },
  { value: 'ew',       label: 'Termina con',                kind: 'text',    arity: 1 },
  { value: 'new',      label: 'No termina con',             kind: 'text',    arity: 1 },
  { value: 'gt',       label: 'Mayor que',                  kind: 'numeric', arity: 1 },
  { value: 'lt',       label: 'Menor que',                  kind: 'numeric', arity: 1 },
  { value: 'gte',      label: 'Mayor o igual que',          kind: 'numeric', arity: 1 },
  { value: 'lte',      label: 'Menor o igual que',          kind: 'numeric', arity: 1 },
  { value: 'between',  label: 'Entre (rango)',             kind: 'numeric', arity: 2 },
  { value: 'nbetween', label: 'No entre (rango)',           kind: 'numeric', arity: 2 },
  { value: 'in',       label: 'En la lista (CSV)',          kind: 'all',     arity: 1 },
  { value: 'nin',      label: 'No en la lista (CSV)',       kind: 'all',     arity: 1 },
  { value: 'isnull',   label: 'Está vacío (NULL)',          kind: 'all',     arity: 0 },
  { value: 'notnull',  label: 'No está vacío (NOT NULL)',   kind: 'all',     arity: 0 },
  { value: 'regex',    label: 'Expresión regular (~)',      kind: 'text',    arity: 1 },
];

const OP_BY_VALUE = Object.fromEntries(FILTER_OPERATORS.map(o => [o.value, o]));

function getOperatorsForField(field) {
  if (field?.numeric) {
    return FILTER_OPERATORS.filter(o => o.kind === 'all' || o.kind === 'numeric');
  }
  if (field?.date) {
    return FILTER_OPERATORS.filter(o => o.kind === 'all' || o.kind === 'numeric');
  }
  return FILTER_OPERATORS.filter(o => o.kind === 'all' || o.kind === 'text');
}

export const useDynamicQueryStore = defineStore('dynamicQuery', dynamicQuerySetup);

// ─── Factory para instancias aisladas ─────────────────────────────────────────
// Permite renderizar simultáneamente varias consultas fijadas (pins) en el
// dashboard de Registros, cada una con su propio estado (rows/columns/values/
// rawData/…) sin compartir nada entre sí. Cada llamada con `id` distinto genera
// un store Pinia independiente. Se cachean las definiciones para no re-registrar
// el mismo id (evita warnings de Pinia al recargar la lista de pines).
const pinnedStoreCache = new Map();

export function createDynamicQueryStore(id) {
  if (!pinnedStoreCache.has(id)) {
    pinnedStoreCache.set(id, defineStore(`dynamicQuery_${id}`, dynamicQuerySetup));
  }
  return pinnedStoreCache.get(id);
}

function dynamicQuerySetup() {
  // ─── State ────────────────────────────────────────────────────────────────
  const availableFields = ref([]);
  const loading = ref(false);
  const dataLoading = ref(false);

  // Pivot config
  const pivotRows = ref([]);
  const pivotColumns = ref([]);
  const pivotValues = ref([]);
  const pivotFilters = ref([]);

  // Chart config
  const chartType = ref('bar');
  const chartStacked = ref(false);
  const chartShowLabels = ref(false);
  const chartShowSeriesLabel = ref(false);
  const chartValueLabelColor = ref('');
  const chartSeriesLabelColor = ref('');
  const chartFill = ref(false);
  const chartCustomColors = ref({});
  // Transpone los ejes del gráfico: las filas pasan a series y las series a etiquetas
  const chartSwapAxes = ref(false);
  // Mapa rename persistente: { 'header::estado': 'Estado Venezolano', 'series::Femenino': 'Mujeres' }
  const customLabels = ref({});
  // Vista de la tabla: 'values' | 'pct' | 'both'
  const pivotDisplayMode = ref('values');
  // Encabezado editable de la tabla (vacío = usa currentQueryName como fallback)
  const pivotTableTitle = ref('');
  // Encabezado editable del gráfico (vacío = usa currentQueryName como fallback)
  const chartTitle = ref('');

  // Data
  const rawData = ref([]);
  const dataColumns = ref([]);
  const totalRows = ref(0);

  // Saved queries
  const savedQueries = ref([]);
  const currentQueryId = ref(null);
  const currentQueryName = ref('');

  // Fuente de datos de la consulta dinámica. Cada host registra sus propias
  // fuentes (pivot_datasources); el valor por defecto es vacío y debe apuntar
  // a un source_key registrado.
  const dataSource = ref('');

  // Pin (Fijar) — consulta guardada cuyo Tabla / Gráfica se muestra por defecto
  // en el dashboard de Registros. Persiste en columnas `pin_table`/`pin_chart`
  // de `saved_queries`; también se espeja dentro de `chart_config` para
  // hidratación rápida desde el payload completo de la query.
  const pinTable = ref(false);
  const pinChart = ref(false);

  // Desagregación automática de columnas de selección múltiple (multivalor)
  const splitMultiValue = ref(true);

  // Ranking (Top N de mayor incidencia)
  const enableRanking = ref(false);
  const rankingCount = ref(10);

  // ─── Computed ─────────────────────────────────────────────────────────────
  const fieldsByCategory = computed(() => {
    const categories = {};
    for (const field of availableFields.value) {
      if (!categories[field.category]) {
        categories[field.category] = [];
      }
      categories[field.category].push(field);
    }
    return categories;
  });

  const hasConfig = computed(() =>
    pivotRows.value.length > 0 || pivotColumns.value.length > 0 || pivotValues.value.length > 0
  );

  const pivotConfig = computed(() => ({
    rows: pivotRows.value.map(f => f.key),
    columns: pivotColumns.value.map(f => f.key),
    values: pivotValues.value.map(f => ({ field: f.key, aggregation: f.aggregation || 'COUNT' })),
    filters: pivotFilters.value,
    splitMultiValue: splitMultiValue.value,
    enableRanking: enableRanking.value,
    rankingCount: rankingCount.value,
  }));

  // ─── Pivot table computed data ────────────────────────────────────────────
  const pivotTableData = computed(() => {
    if (!rawData.value.length) return { headers: [], bodyRows: [], grandTotals: {} };
    return computePivotTable();
  });

  // ─── Actions ──────────────────────────────────────────────────────────────
  async function loadAvailableFields() {
    try {
      loading.value = true;
      const res = await http().post('/graphql', {
        query: `query AvailableFields($source: String) { availableFields(source: $source) }`,
        variables: { source: dataSource.value }
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/graphql-response+json, application/json'
        }
      });
      const data = res.data?.data?.availableFields;
      if (data) {
        availableFields.value = JSON.parse(data);
      }
    } catch (err) {
      console.error('Error loading fields:', err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchData() {
    if (!hasConfig.value) return;
    try {
      dataLoading.value = true;
      const groupBy = [...pivotRows.value, ...pivotColumns.value].map(f => f.key);
      const values = pivotValues.value.map(f => ({
        field: f.key,
        aggregation: f.aggregation || 'COUNT',
      }));
      const fields = groupBy.length === 0
        ? [...pivotRows.value, ...pivotColumns.value, ...pivotValues.value].map(f => f.key)
        : undefined;

      // Aplana los grupos AND/OR: cada condición se envía como un FilterInput individual,
      // conservando `combine` para que el backend reconstruya las agrupaciones.
      // Se omiten condiciones vacías y operadores sin valor (isnull/notnull no requieren value).
      const filters = [];
      pivotFilters.value.forEach(group => {
        group.conditions.forEach((c, idx) => {
          const arity = operatorArity(c.operator);
          // Si la condición requiere valor y está vacío, se omite
          if (arity >= 1 && (c.value === undefined || c.value === null || c.value === '')) return;
          // Between requiere ambos valores
          if (arity === 2 && (c.value2 === undefined || c.value2 === null || c.value2 === '')) return;
          filters.push({
            field: group.field,
            operator: c.operator || 'eq',
            value: arity >= 1 ? String(c.value) : undefined,
            value2: arity === 2 ? String(c.value2) : undefined,
            combine: idx === 0 ? 'AND' : (c.combine || 'AND'),
          });
        });
      });

      const query = `
        query DashboardData($source: String, $fields: [String], $filters: [FilterInput], $groupBy: [String], $values: [FieldConfigInput], $limit: Int, $splitMultiValue: Boolean, $topN: Int) {
          dashboardData(source: $source, fields: $fields, filters: $filters, groupBy: $groupBy, values: $values, limit: $limit, splitMultiValue: $splitMultiValue, topN: $topN) {
            columns
            rows
            totalRows
          }
        }
      `;

      const res = await http().post('/graphql', {
        query,
        variables: {
          source: dataSource.value,
          fields,
          filters,
          groupBy: groupBy.length > 0 ? groupBy : undefined,
          values: values.length > 0 ? values : undefined,
          limit: 5000,
          splitMultiValue: splitMultiValue.value,
          topN: enableRanking.value && rankingCount.value > 0 ? Number(rankingCount.value) : undefined,
        }
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/graphql-response+json, application/json'
        }
      });

      const result = res.data?.data?.dashboardData;
      if (result) {
        dataColumns.value = result.columns || [];
        rawData.value = JSON.parse(result.rows || '[]');
        totalRows.value = result.totalRows || 0;
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      dataLoading.value = false;
    }
  }

  function computePivotTable() {
    const rows = rawData.value;
    if (!rows.length) return { headers: [], bodyRows: [], grandTotals: {} };

    const rowKeys = pivotRows.value.map(f => f.key.replace('.', '_'));
    const colKeys = pivotColumns.value.map(f => f.key.replace('.', '_'));
    const valKeys = pivotValues.value.map(f => {
      const agg = (f.aggregation || 'COUNT').toLowerCase();
      return `${f.key.replace('.', '_')}_${agg}`;
    });

    // If no column pivoting, return flat table
    if (colKeys.length === 0) {
      const headers = [
        ...pivotRows.value.map(f => ({
          key: f.key.replace('.', '_'),
          label: resolveLabel('header', `${f.key.replace('.', '_')}`, f.label),
          rawLabel: f.label,
        })),
        ...pivotValues.value.map(f => {
          const key = `${f.key.replace('.', '_')}_${(f.aggregation || 'COUNT').toLowerCase()}`;
          return {
            key,
            label: resolveLabel('header', key, `${f.label} (${f.aggregation || 'COUNT'})`),
            rawLabel: `${f.label} (${f.aggregation || 'COUNT'})`,
          };
        }),
      ];

      // Aplicar orden y límite de ranking si está activo
      let finalBodyRows = rows;
      if (enableRanking.value && rankingCount.value > 0 && valKeys.length > 0) {
        const metricKey = valKeys[0];
        const sorted = [...rows].sort((a, b) => (Number(b[metricKey]) || 0) - (Number(a[metricKey]) || 0));
        finalBodyRows = sorted.slice(0, Number(rankingCount.value));
      }

      const grandTotals = {};
      valKeys.forEach(vk => { grandTotals[vk] = 0; });
      finalBodyRows.forEach(row => {
        valKeys.forEach(vk => {
          grandTotals[vk] += Number(row[vk]) || 0;
        });
      });
      return { headers, bodyRows: finalBodyRows, grandTotals, hasPivotColumns: false };
    }

    // With column pivoting: need to cross-tab
    const colValuesSet = new Set();
    rows.forEach(row => {
      const colVal = colKeys.map(ck => row[ck] || '(vacío)').join(' | ');
      colValuesSet.add(colVal);
    });
    const colValuesRaw = [...colValuesSet].sort();
    // Mapa raw → resolved (la serie renombrada se muestra en headers del cross-tab)
    // Se conserva el valor raw como `key` para que el binding con rowGroups siga válido.
    const colValues = colValuesRaw.map(cv => ({
      raw: cv,
      display: resolveLabel('series', cv, cv),
    }));

    // Build headers
    const headers = [
      ...pivotRows.value.map(f => ({
        key: f.key.replace('.', '_'),
        label: resolveLabel('header', `${f.key.replace('.', '_')}`, f.label),
        rawLabel: f.label,
        isRowHeader: true,
      })),
    ];
    colValues.forEach(cv => {
      pivotValues.value.forEach(f => {
        headers.push({
          key: `${cv.raw}__${f.key}`,
          label: cv.display,
          subLabel: `${f.label} (${f.aggregation || 'COUNT'})`,
          isValue: true,
        });
      });
    });

    // Build cross-tab rows
    const rowGroups = {};
    rows.forEach(row => {
      const rowKey = rowKeys.map(rk => row[rk] || '(vacío)').join('|||');
      if (!rowGroups[rowKey]) {
        rowGroups[rowKey] = { _rowValues: {} };
        rowKeys.forEach(rk => { rowGroups[rowKey][rk] = row[rk]; });
      }
      const colVal = colKeys.map(ck => row[ck] || '(vacío)').join(' | ');
      valKeys.forEach((vk, vi) => {
        const hKey = `${colVal}__${pivotValues.value[vi].key}`;
        rowGroups[rowKey]._rowValues[hKey] = Number(row[vk]) || 0;
      });
    });

    const bodyRows = Object.values(rowGroups).map(group => {
      const row = {};
      rowKeys.forEach(rk => { row[rk] = group[rk]; });
      headers.filter(h => h.isValue).forEach(h => {
        row[h.key] = group._rowValues[h.key] || 0;
      });
      return row;
    });

    // Aplicar orden y límite de ranking en modo cruzado si está activo
    let finalBodyRows = bodyRows;
    if (enableRanking.value && rankingCount.value > 0) {
      const valHeaders = headers.filter(h => h.isValue);
      const sorted = [...bodyRows].sort((a, b) => {
        const sumA = valHeaders.reduce((s, h) => s + (Number(a[h.key]) || 0), 0);
        const sumB = valHeaders.reduce((s, h) => s + (Number(b[h.key]) || 0), 0);
        return sumB - sumA;
      });
      finalBodyRows = sorted.slice(0, Number(rankingCount.value));
    }

    // Grand totals
    const grandTotals = {};
    headers.filter(h => h.isValue).forEach(h => {
      grandTotals[h.key] = finalBodyRows.reduce((sum, r) => sum + (Number(r[h.key]) || 0), 0);
    });

    return { headers, bodyRows: finalBodyRows, grandTotals, hasPivotColumns: true, colValues };
  }

  // ─── Field drag & drop ────────────────────────────────────────────────────
  function addFieldToZone(field, zone) {
    const fieldCopy = { ...field, aggregation: field.numeric ? 'SUM' : 'COUNT' };

    switch (zone) {
      case 'rows':
        if (!pivotRows.value.some(f => f.key === field.key)) {
          pivotRows.value.push(fieldCopy);
        }
        break;
      case 'columns':
        if (!pivotColumns.value.some(f => f.key === field.key)) {
          pivotColumns.value.push(fieldCopy);
        }
        break;
      case 'values':
        if (!pivotValues.value.some(f => f.key === field.key)) {
          pivotValues.value.push(fieldCopy);
        }
        break;
      case 'filters':
        // Cada campo genera un grupo que puede contener múltiples condiciones AND/OR
        if (!pivotFilters.value.some(g => g.field === field.key)) {
          pivotFilters.value.push({
            field: field.key,
            label: field.label,
            numeric: !!field.numeric,
            date: !!field.date,
            conditions: [
              {
                operator: (field.numeric || field.date) ? 'eq' : 'like',
                value: '',
                value2: '',
                combine: 'AND',
              },
            ],
          });
        }
        break;
    }
  }

  function removeFieldFromZone(fieldKey, zone) {
    switch (zone) {
      case 'rows': pivotRows.value = pivotRows.value.filter(f => f.key !== fieldKey); break;
      case 'columns': pivotColumns.value = pivotColumns.value.filter(f => f.key !== fieldKey); break;
      case 'values': pivotValues.value = pivotValues.value.filter(f => f.key !== fieldKey); break;
      case 'filters': pivotFilters.value = pivotFilters.value.filter(f => f.field !== fieldKey); break;
    }
  }

  function removeFieldFromAllZones(fieldKey) {
    pivotRows.value = pivotRows.value.filter(f => f.key !== fieldKey);
    pivotColumns.value = pivotColumns.value.filter(f => f.key !== fieldKey);
    pivotValues.value = pivotValues.value.filter(f => f.key !== fieldKey);
    pivotFilters.value = pivotFilters.value.filter(f => f.field !== fieldKey);
  }

  function changeAggregation(fieldKey, aggregation) {
    const field = pivotValues.value.find(f => f.key === fieldKey);
    if (field) field.aggregation = aggregation;
  }

  // ─── CRUD de Filtros Avanzados (grupos AND/OR por campo) ─────────────────────
  function addFilterCondition(groupField) {
    const g = pivotFilters.value.find(it => it.field === groupField);
    if (!g) return;
    g.conditions.push({
      operator: (g.numeric || g.date) ? 'eq' : 'like',
      value: '',
      value2: '',
      combine: g.conditions.length > 0 ? 'AND' : 'AND',
    });
  }

  function updateFilterCondition(groupField, condIndex, patch) {
    const g = pivotFilters.value.find(it => it.field === groupField);
    if (!g) return;
    const c = g.conditions[condIndex];
    if (!c) return;
    Object.assign(c, patch);
    // Si el nuevo operador no necesita valor, limpiar value/value2 para no enviarlo
    const opDef = OP_BY_VALUE[patch.operator];
    if (opDef) {
      if (opDef.arity === 0) { c.value = ''; c.value2 = ''; }
      if (opDef.arity === 1) c.value2 = '';
    }
  }

  function removeFilterCondition(groupField, condIndex) {
    const g = pivotFilters.value.find(it => it.field === groupField);
    if (!g) return;
    g.conditions.splice(condIndex, 1);
    // Si el grupo queda sin condiciones, elimínalo del array (UI lo refleja solo)
    if (g.conditions.length === 0) {
      removeFieldFromZone(groupField, 'filters');
    }
  }

  // Resuelve qué operadores puede mostrar el selector para un grupo
  function operatorsForGroup(groupField) {
    const g = pivotFilters.value.find(it => it.field === groupField);
    return getOperatorsForField(g);
  }

  function getOperatorLabel(op) {
    return OP_BY_VALUE[op]?.label || op;
  }

  // Devuelve cuántos valores (0, 1 o 2) necesita el operador
  function operatorArity(op) {
    return OP_BY_VALUE[op]?.arity ?? 1;
  }

  // ─── Etiquetas personalizadas (customLabels) ─────────────────────────────────
  function setCustomLabel(kind, key, label) {
    const mapKey = `${kind}::${key}`;
    if (!label || label === '') {
      delete customLabels.value[mapKey];
      // Forzar reactividad de objeto (Vue no detecta delete directo en some casos)
      customLabels.value = { ...customLabels.value };
    } else {
      customLabels.value = { ...customLabels.value, [mapKey]: label };
    }
  }

  function resolveLabel(kind, key, fallback) {
    return customLabels.value[`${kind}::${key}`] || fallback;
  }

  function resetCustomLabels() {
    customLabels.value = {};
  }

  function clearConfig() {
    pivotRows.value = [];
    pivotColumns.value = [];
    pivotValues.value = [];
    pivotFilters.value = [];
    rawData.value = [];
    dataColumns.value = [];
    totalRows.value = 0;
    // Nota: dataSource no se resetea aquí; lo fija el prop `data-source` del
    // panel o la consulta guardada cargada (pivot_config.source).
    // Reset chart visual config so previous styling doesn't bleed into new sessions
    chartType.value = 'bar';
    chartStacked.value = false;
    chartShowLabels.value = false;
    chartShowSeriesLabel.value = false;
    chartValueLabelColor.value = '';
    chartSeriesLabelColor.value = '';
    chartFill.value = false;
    chartSwapAxes.value = false;
    chartCustomColors.value = {};
    customLabels.value = {};
    pivotDisplayMode.value = 'values';
    pivotTableTitle.value = '';
    chartTitle.value = '';
    pinTable.value = false;
    pinChart.value = false;
    splitMultiValue.value = true;
    enableRanking.value = false;
    rankingCount.value = 10;
    currentQueryId.value = null;
    currentQueryName.value = '';
  }

  // ─── Saved queries ────────────────────────────────────────────────────────
  async function loadSavedQueries() {
    try {
      const res = await http().get(`${_basePath()}/saved-queries`, {
        params: { source: dataSource.value }
      });
      savedQueries.value = res.data || [];
    } catch (err) {
      console.error('Error loading saved queries:', err);
    }
  }

  async function saveCurrentQuery(name, description, visibility = 'private') {
    const data = {
      name,
      description,
      graphql_query: '',
      pivot_config: {
        source: dataSource.value,
        rows: pivotRows.value,
        columns: pivotColumns.value,
        values: pivotValues.value,
        filters: pivotFilters.value,
        splitMultiValue: splitMultiValue.value,
        enableRanking: enableRanking.value,
        rankingCount: rankingCount.value,
      },
      chart_config: {
        type: chartType.value,
        stacked: chartStacked.value,
        showLabels: chartShowLabels.value,
        showSeriesLabel: chartShowSeriesLabel.value,
        valueLabelColor: chartValueLabelColor.value,
        seriesLabelColor: chartSeriesLabelColor.value,
        fill: chartFill.value,
        customColors: chartCustomColors.value,
        customLabels: customLabels.value,
        displayMode: pivotDisplayMode.value,
        tableTitle: pivotTableTitle.value,
        chartTitle: chartTitle.value,
        swapAxes: chartSwapAxes.value,
        pinTable: pinTable.value,
        pinChart: pinChart.value,
      },
      visibility,
    };

    try {
      if (currentQueryId.value) {
        await http().put(`${_basePath()}/saved-queries/${currentQueryId.value}`, data);
      } else {
        const res = await http().post(`${_basePath()}/saved-queries`, data);
        currentQueryId.value = res.data.id;
      }
      currentQueryName.value = name;
      await loadSavedQueries();
      return true;
    } catch (err) {
      console.error('Error saving query:', err);
      return false;
    }
  }

  // Migra filtros con formato legacy (flat: { field, operator, value }) al
  // nuevo formato de grupos AND/OR: { field, label, numeric, date, conditions: [...] }.
  // Detecta ambos formatos y es idempotente.
  function migrateLegacyFilters(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(item => {
      if (item && Array.isArray(item.conditions)) {
        // Ya es formato nuevo: normaliza campos opcionales y borra claves legacy
        return {
          field: item.field,
          label: item.label || item.field,
          numeric: !!item.numeric,
          date: !!item.date,
          conditions: item.conditions.map(c => ({
            operator: c.operator || 'eq',
            value: c.value || '',
            value2: c.value2 || '',
            combine: c.combine || 'AND',
          })),
        };
      }
      // Legacy plano → grupo con 1 condición
      return {
        field: item.field,
        label: item.label || item.field,
        numeric: !!item.numeric,
        date: !!item.date,
        conditions: [{
          operator: item.operator || 'eq',
          value: item.value || '',
          value2: '',
          combine: 'AND',
        }],
      };
    });
  }

  async function loadSavedQuery(query) {
    currentQueryId.value = query.id;
    currentQueryName.value = query.name;
    const config = typeof query.pivot_config === 'string'
      ? JSON.parse(query.pivot_config) : query.pivot_config;
    const chart = typeof query.chart_config === 'string'
      ? JSON.parse(query.chart_config) : (query.chart_config || {});

    pivotRows.value = config.rows || [];
    pivotColumns.value = config.columns || [];
    pivotValues.value = config.values || [];
    pivotFilters.value = migrateLegacyFilters(config.filters || []);
    splitMultiValue.value = typeof config.splitMultiValue !== 'undefined' ? !!config.splitMultiValue : true;
    enableRanking.value = typeof config.enableRanking !== 'undefined' ? !!config.enableRanking : false;
    rankingCount.value = typeof config.rankingCount !== 'undefined' ? Number(config.rankingCount) : 10;
    dataSource.value = config.source || '';
    await loadAvailableFields();
    chartType.value = chart.type || 'bar';
    chartStacked.value = chart.stacked || false;
    chartShowLabels.value = chart.showLabels || false;
    chartShowSeriesLabel.value = chart.showSeriesLabel || false;
    chartValueLabelColor.value = chart.valueLabelColor || '';
    chartSeriesLabelColor.value = chart.seriesLabelColor || '';
    chartFill.value = chart.fill || false;
    chartCustomColors.value = chart.customColors || {};
    customLabels.value = chart.customLabels || {};
    pivotDisplayMode.value = chart.displayMode || 'values';
    pivotTableTitle.value = chart.tableTitle || '';
    chartTitle.value = chart.chartTitle || '';
    chartSwapAxes.value = chart.swapAxes || false;
    // Pin flags: prioridad a las columnas dedicadas de la BD (query.pin_table /
    // query.pin_chart); fallback al espejo dentro de chart_config.
    pinTable.value = typeof query.pin_table !== 'undefined' ? !!query.pin_table : !!chart.pinTable;
    pinChart.value = typeof query.pin_chart !== 'undefined' ? !!query.pin_chart : !!chart.pinChart;

    await fetchData();
  }
  async function deleteSavedQuery(id) {
    try {
      await http().delete(`${_basePath()}/saved-queries/${id}`);
      if (currentQueryId.value === id) {
        clearConfig();
      }
      await loadSavedQueries();
      return true;
    } catch (err) {
      console.error('Error deleting query:', err);
      return false;
    }
  }

  // ─── Pin (Fijar) ────────────────────────────────────────────────────────
  // Alterna pin_table / pin_chart de la consulta actual. Requiere que la
  // consulta esté guardada (tiene id). Actualiza el estado local y re-sincroniza
  // la lista de savedQueries para que los flags reflejen el cambio.
  async function togglePin(target) {
    if (!currentQueryId.value) return false;
    try {
      const next = target === 'table' ? !pinTable.value : !pinChart.value;
      const res = await http().put(`${_basePath()}/saved-queries/${currentQueryId.value}/pin`, {
        target,
        value: next,
      });
      if (target === 'table') pinTable.value = !!res.data.pin_table;
      else pinChart.value = !!res.data.pin_chart;
      await loadSavedQueries();
      return true;
    } catch (err) {
      console.error('Error toggling pin:', err);
      return false;
    }
  }

  return {
    // State
    availableFields, loading, dataLoading,
    pivotRows, pivotColumns, pivotValues, pivotFilters,
    chartType, chartStacked, chartShowLabels, chartShowSeriesLabel, chartValueLabelColor, chartSeriesLabelColor, chartFill, chartSwapAxes, chartCustomColors, customLabels, pivotDisplayMode, pivotTableTitle, chartTitle,
    rawData, dataColumns, totalRows,
    savedQueries, currentQueryId, currentQueryName,
    pinTable, pinChart, dataSource, splitMultiValue, enableRanking, rankingCount,
    // Computed
    fieldsByCategory, hasConfig, pivotConfig, pivotTableData,
    // Actions
    loadAvailableFields, fetchData,
    addFieldToZone, removeFieldFromZone, removeFieldFromAllZones,
    changeAggregation,
    addFilterCondition, updateFilterCondition, removeFilterCondition,
    operatorsForGroup, getOperatorLabel, operatorArity,
    setCustomLabel, resolveLabel, resetCustomLabels,
    clearConfig,
    loadSavedQueries, saveCurrentQuery, loadSavedQuery, deleteSavedQuery,
    togglePin,
  };
}
