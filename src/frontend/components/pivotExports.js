// src/components/dashboard/pivotExports.js
// Utilidades de exportación para tablas y gráficas pivot dinámicas.
// Todas reciben una instancia de store (dynamic-query-store) como argumento, de
// modo que tanto el Generador (DynamicQueryPanel) como el dashboard de pines
// (RegistrosDashboard) pueden reutilizarlas sin duplicar lógica.

export function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Helper: resolve aggregation label (value column) — mirrors PivotTable.vue aggLabel() */
function aggLabel(store, v) {
  return store.customLabels[`agg::${v.key}`] || v.aggregation || 'COUNT';
}
/** Helper: resolve aggregation pct label — mirrors PivotTable.vue aggPctLabel() */
function aggPctLabel(store, v) {
  return store.customLabels[`agg_pct::${v.key}`] || (aggLabel(store, v) + ' %');
}
/** Helper: resolve header/series custom label */
function headerLabel(store, h) {
  const custom = store.customLabels[`header::${h.key}`];
  if (custom) return custom;
  return h.subLabel ? `${h.label} - ${h.subLabel}` : h.label;
}

/**
 * Builds the export matrix that EXACTLY mirrors what is rendered in PivotTable.vue.
 * Respects: store.pivotDisplayMode (values/pct/both), custom labels (header/agg/agg_pct).
 * Returns: { cols: [{label, key, isPct, srcKey?}], rows: Array<Array>, totalRow: Array|null }
 */
export function buildPivotExportData(store) {
  const data = store.pivotTableData;
  if (!data.bodyRows?.length) return null;

  const mode = store.pivotDisplayMode || 'values';
  const cols = []; // { label, key, isPct, srcKey? }

  if (data.hasPivotColumns) {
    // ── Cross-tab mode ──────────────────────────────────────────────────────
    const rowHdrs = data.headers.filter(h => h.isRowHeader);
    rowHdrs.forEach(h => cols.push({ label: headerLabel(store, h), key: h.key, isPct: false }));

    (data.colValues || []).forEach(cv => {
      const colGroupLabel = store.customLabels[`series::${cv.raw}`] || cv.display;
      store.pivotValues.forEach(v => {
        const cellKey = `${cv.raw}__${v.key}`;
        if (mode !== 'pct') {
          cols.push({ label: `${colGroupLabel} - ${aggLabel(store, v)}`, key: cellKey, isPct: false });
        }
        if (mode !== 'values') {
          cols.push({ label: `${colGroupLabel} - ${aggPctLabel(store, v)}`, key: cellKey, isPct: true, srcKey: cellKey });
        }
      });
    });

    if (data.colValues?.length) {
      cols.push({ label: 'TOTAL', key: '__total__', isPct: false });
    }
  } else {
    // ── Simple mode ─────────────────────────────────────────────────────────
    const nDims = store.pivotRows.length;
    data.headers.forEach((h, i) => {
      if (i < nDims) {
        cols.push({ label: headerLabel(store, h), key: h.key, isPct: false });
      } else {
        const valIdx = i - nDims;
        const pf = store.pivotValues[valIdx];
        const valLabel = store.customLabels[`header::${h.key}`] || h.label;
        if (mode !== 'pct') {
          cols.push({ label: valLabel, key: h.key, isPct: false });
        }
        if (mode !== 'values') {
          const pctLabel = pf ? aggPctLabel(store, pf) : (valLabel + ' %');
          cols.push({ label: pctLabel, key: h.key, isPct: true, srcKey: h.key });
        }
      }
    });
  }

  const colGT = (col) => {
    if (col.isPct) return null;
    if (col.key === '__total__') return null;
    return data.grandTotals?.[col.key];
  };

  const rowTotalVal = (row) => {
    const valHdrs = data.headers.filter(h => h.isValue);
    return valHdrs.reduce((s, h) => s + (Number(row[h.key]) || 0), 0);
  };

  const calcPct = (val, key) => {
    const num = Number(val) || 0;
    const gt  = Number(data.grandTotals?.[key]) || 0;
    if (!gt) return '—';
    return (num / gt * 100).toFixed(1) + '%';
  };

  const rows = data.bodyRows.map(row => cols.map(col => {
    if (col.key === '__total__') return rowTotalVal(row);
    if (col.isPct) return calcPct(row[col.srcKey], col.srcKey);
    const v = row[col.key];
    return v === null || v === undefined ? '' : v;
  }));

  const nDims = data.hasPivotColumns ? data.headers.filter(h => h.isRowHeader).length : store.pivotRows.length;
  const totalRow = cols.map((col, i) => {
    if (i === 0) return 'TOTAL';
    if (i < nDims) return '';
    if (col.isPct) return '100.0%';
    if (col.key === '__total__') {
      return Object.values(data.grandTotals || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    }
    const gt = colGT(col);
    return gt !== null && gt !== undefined ? gt : '';
  });

  return { cols, rows, totalRow: Object.keys(data.grandTotals || {}).length ? totalRow : null };
}

/** Export the pivot table (as displayed) to CSV with UTF-8 BOM */
export function exportTableCSV(store) {
  const d = buildPivotExportData(store);
  if (!d) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  let csv = '\uFEFF';
  csv += d.cols.map(c => q(c.label)).join(',') + '\n';
  d.rows.forEach(row => { csv += row.map(q).join(',') + '\n'; });
  if (d.totalRow) csv += d.totalRow.map(q).join(',') + '\n';
  downloadFile(csv, `tabla-pivot-${store.currentQueryName || 'datos'}.csv`, 'text/csv;charset=utf-8');
}

/** Export pivot table as JSON (labeled keys) mirroring the rendered view */
export function exportTableJSON(store) {
  const d = buildPivotExportData(store);
  if (!d) return;
  const objects = d.rows.map(row => {
    const obj = {};
    d.cols.forEach((col, i) => { obj[col.label] = row[i] ?? null; });
    return obj;
  });
  if (d.totalRow) {
    const totObj = {};
    d.cols.forEach((col, i) => { totObj[col.label] = d.totalRow[i] ?? null; });
    objects.push(totObj);
  }
  downloadFile(JSON.stringify(objects, null, 2), `tabla-pivot-${store.currentQueryName || 'datos'}.json`, 'application/json');
}

/** Export raw unprocessed records as JSON */
export function exportRawJSON(store) {
  if (!store.rawData.length) return;
  downloadFile(JSON.stringify(store.rawData, null, 2), `datos-raw-${store.currentQueryName || 'datos'}.json`, 'application/json');
}

/** Export the pivot table to Excel (.xlsx) mirroring the rendered view */
export async function exportTableExcel(store) {
  const XLSX = await import('xlsx');
  const d = buildPivotExportData(store);
  if (!d) return;

  const toNum = v => {
    if (v === '' || v === null || v === undefined || typeof v === 'string') return v ?? '';
    const n = Number(v);
    return isNaN(n) ? v : n;
  };

  const dateObj = new Date();
  const pad = n => n.toString().padStart(2, '0');
  const dd = pad(dateObj.getDate());
  const mm = pad(dateObj.getMonth() + 1);
  const yyyy = dateObj.getFullYear();
  let hr = dateObj.getHours();
  const ampm = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12;
  hr = hr ? hr : 12;
  const mins = pad(dateObj.getMinutes());
  const formattedDate = `${dd}/${mm}/${yyyy} ${pad(hr)}:${mins} ${ampm}`;

  const titleText = store.pivotTableTitle || store.currentQueryName || 'Consulta Dinámica';
  const headerText = `${titleText} (Generado el: ${formattedDate})`;

  const wsData = [
    [headerText],
    d.cols.map(c => c.label),
    ...d.rows.map(row => row.map(toNum)),
    ...(d.totalRow ? [d.totalRow.map(toNum)] : []),
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  if (d.cols.length > 1) {
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: d.cols.length - 1 } }
    ];
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tabla Pivot');
  XLSX.writeFile(wb, `tabla-pivot-${store.currentQueryName || 'datos'}.xlsx`);
}

/**
 * Builds the chart's data matrix (labels + each dataset's values) for export.
 * Mirrors PivotChart.vue's chartData computed: cross-tab groups by column value,
 * simple mode has one dataset per value column. Returns { cols, rows } where
 * cols[0] is the category label and the rest are series names.
 */
/**
 * Transpone la matriz de exportación cuando el toggle "Intercambiar filas y
 * columnas" está activo. Estructura esperada: cols[0] = dimensión (categoría),
 * cols[1..n] = series; rows = una por categoría con clave dimKey y una clave por
 * serie. Devuelve cols = [serie] + [cada categoría] y rows = una por serie.
 */
function maybeSwapExportMatrix(store, cols, rows, dimKey) {
  if (!store.chartSwapAxes) return { cols, rows };
  const seriesCols = cols.slice(1);
  const categoryLabels = rows.map(row => row[dimKey] ?? '');
  const newCols = [
    { label: cols[0].label, key: '__series__' },
    ...categoryLabels.map((cl, i) => ({ label: cl, key: `__cat__${i}` })),
  ];
  const newRows = seriesCols.map((sc) => {
    const out = { __series__: sc.label };
    rows.forEach((row, i) => {
      out[`__cat__${i}`] = row[sc.key] ?? '';
    });
    return out;
  });
  return { cols: newCols, rows: newRows };
}

export function buildChartExportData(store) {
  const td = store.pivotTableData;
  if (!td.bodyRows?.length) return null;

  if (td.hasPivotColumns) {
    const rowHeaderKeys = td.headers.filter(h => h.isRowHeader).map(h => h.key);
    const valueHeaders = td.headers.filter(h => h.isValue);
    const colValuesSet = [...new Set(valueHeaders.map(h => h.label))];

    const dimKey = rowHeaderKeys[0];
    const cols = [{ label: store.resolveLabel('header', dimKey, dimKey), key: dimKey }];
    colValuesSet.forEach(cv => {
      cols.push({
        label: store.resolveLabel('series', cv, cv),
        key: `__cv__${cv}`,
      });
    });

    const rows = td.bodyRows.map(row => {
      const out = { [dimKey]: row[dimKey] ?? '' };
      colValuesSet.forEach(cv => {
        const colHeaders = valueHeaders.filter(h => h.label === cv);
        out[`__cv__${cv}`] = colHeaders.reduce((sum, h) => sum + (Number(row[h.key]) || 0), 0);
      });
      return out;
    });

    return maybeSwapExportMatrix(store, cols, rows, dimKey);
  }

  const rowHeaderKeys = td.headers.slice(0, store.pivotRows.length).map(h => h.key);
  const valueHeaderKeys = td.headers.slice(store.pivotRows.length);

  const dimKey = rowHeaderKeys[0];
  const cols = [{ label: dimKey, key: dimKey }];
  valueHeaderKeys.forEach(h => {
    cols.push({
      label: store.customLabels[`header::${h.key}`] || h.label,
      key: h.key,
    });
  });

  const rows = td.bodyRows.map(row => {
    const out = { [dimKey]: row[dimKey] ?? '' };
    valueHeaderKeys.forEach(h => { out[h.key] = Number(row[h.key]) || 0; });
    return out;
  });

  return maybeSwapExportMatrix(store, cols, rows, dimKey);
}

/** Export chart data to CSV (labels + series values). */
export function exportChartCSV(store) {
  const d = buildChartExportData(store);
  if (!d) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  let csv = '\uFEFF';
  csv += d.cols.map(c => q(c.label)).join(',') + '\n';
  d.rows.forEach(row => { csv += d.cols.map(c => q(row[c.key])).join(',') + '\n'; });
  downloadFile(csv, `grafico-${store.currentQueryName || 'datos'}.csv`, 'text/csv;charset=utf-8');
}

/** Export chart data to JSON (array of objects: category + series). */
export function exportChartJSON(store) {
  const d = buildChartExportData(store);
  if (!d) return;
  const objects = d.rows.map(row => {
    const obj = {};
    d.cols.forEach(c => { obj[c.label] = row[c.key] ?? null; });
    return obj;
  });
  downloadFile(JSON.stringify(objects, null, 2), `grafico-${store.currentQueryName || 'datos'}.json`, 'application/json');
}

/** Export chart data to Excel (.xlsx). */
export async function exportChartExcel(store) {
  const XLSX = await import('xlsx');
  const d = buildChartExportData(store);
  if (!d) return;
  const wsData = [
    d.cols.map(c => c.label),
    ...d.rows.map(row => d.cols.map(c => row[c.key])),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos Gráfico');
  XLSX.writeFile(wb, `grafico-${store.currentQueryName || 'datos'}.xlsx`);
}
