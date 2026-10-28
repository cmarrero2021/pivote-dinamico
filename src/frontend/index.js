// src/frontend/index.js
// Package entry point for the host Vue 3 + Quasar application.
//
//   import {
//     configurePivotApi,        // inject your axios instance (REQUIRED)
//     useDynamicQueryStore,     // Pinia singleton store
//     createDynamicQueryStore,  // factory for isolated store instances
//     DynamicQueryPanel,        // main pivot builder UI
//   } from 'dash-pivot/frontend';
//
//   // 1. Configure (e.g. in a Quasar boot file):
//   import { api } from 'boot/axios';
//   configurePivotApi(api, { basePath: '/api/pivot' });
//
//   // 2. Use anywhere:
//   <DynamicQueryPanel :data-source="'ventas'" />

import DynamicQueryPanel from './components/DynamicQueryPanel.vue';
import PivotTable from './components/PivotTable.vue';
import PivotChart from './components/PivotChart.vue';
import FilterEditorPanel from './components/FilterEditorPanel.vue';
import DataSourceAdminPanel from './components/admin/DataSourceAdminPanel.vue';
import FieldsEditorDialog from './components/admin/FieldsEditorDialog.vue';
import { configurePivotApi, useDynamicQueryStore, createDynamicQueryStore, FILTER_OPERATORS } from './stores/dynamicQueryStore';
import { pivotAdminApi } from './admin/adminApi';

export {
  DynamicQueryPanel,
  PivotTable,
  PivotChart,
  FilterEditorPanel,
  DataSourceAdminPanel,
  FieldsEditorDialog,
  configurePivotApi,
  useDynamicQueryStore,
  createDynamicQueryStore,
  FILTER_OPERATORS,
  pivotAdminApi,
};
