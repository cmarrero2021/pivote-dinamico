<template>
  <div class="datasource-admin-panel q-pa-md">
    <!-- Header -->
    <div class="row items-center justify-between q-mb-md">
      <div class="row items-center q-gutter-sm">
        <q-icon name="dataset" size="26px" class="text-primary" />
        <div>
          <div class="text-h6 text-weight-bold">Fuentes de Datos del Dashboard</div>
          <div class="text-caption text-grey-6">
            Registra tablas y vistas (de cualquier esquema) y habilita sus columnas para el generador de consultas
          </div>
        </div>
      </div>
      <div class="row items-center q-gutter-sm">
        <q-btn flat dense icon="refresh" :loading="loading" @click="loadDatasources">
          <q-tooltip>Recargar fuentes</q-tooltip>
        </q-btn>
        <q-btn color="primary" icon="add" label="Nueva Fuente" unelevated class="text-weight-bold" @click="openNewDialog" />
      </div>
    </div>

    <!-- Data sources table -->
    <q-table
      :rows="datasources"
      :columns="dsColumns"
      row-key="id"
      flat bordered
      class="bg-white"
      :loading="loading"
      :pagination="{ rowsPerPage: 0 }"
      hide-bottom
    >
      <template #body-cell-table_ref="props">
        <q-td :props="props">
          <q-chip dense color="grey-3" text-color="grey-9" icon="schema" class="q-mr-xs">
            {{ props.row.schema_name }}
          </q-chip>
          <span class="text-weight-medium">{{ props.row.table_name }}</span>
        </q-td>
      </template>

      <template #body-cell-table_type="props">
        <q-td :props="props">
          <q-badge :color="typeBadge(props.row.table_type)" :label="props.row.table_type" />
        </q-td>
      </template>

      <template #body-cell-is_active="props">
        <q-td auto-width>
          <q-toggle dense v-model="props.row.is_active" color="green-8" @update:model-value="toggleActive(props.row)" />
        </q-td>
      </template>

      <template #body-cell-actions="props">
        <q-td auto-width class="text-right">
          <q-btn flat round dense size="sm" icon="view_column" color="primary" @click="fieldsDs = props.row; showFieldsDialog = true">
            <q-tooltip>Habilitar / etiquetar columnas</q-tooltip>
          </q-btn>
          <q-btn flat round dense size="sm" icon="fact_check" color="teal-8" @click="validateSource(props.row)">
            <q-tooltip>Validar columnas contra la tabla fisica</q-tooltip>
          </q-btn>
        </q-td>
      </template>

      <template #no-data>
        <div class="full-width column items-center q-pa-xl text-grey-6">
          <q-icon name="dataset" size="56px" class="opacity-3 q-mb-sm" />
          <div class="text-weight-medium">Aun no hay fuentes de datos registradas</div>
          <div class="text-caption">Registra una tabla o vista para empezar a construir reportes</div>
        </div>
      </template>
    </q-table>

    <!-- New datasource dialog -->
    <q-dialog v-model="showNewDialog" persistent>
      <q-card style="min-width: 460px; max-width: 560px;">
        <q-card-section class="bg-primary text-white q-py-md row items-center">
          <q-icon name="add_circle" class="q-mr-sm" size="22px" />
          <span class="text-h6 text-weight-bold">Registrar Fuente de Datos</span>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-input v-model="newDs.source_key" outlined dense label="Clave (source_key) *"
            hint="Clave tecnica usada por el frontend. Ej: ventas" />
          <q-input v-model="newDs.display_name" outlined dense label="Nombre visible *" />
          <div class="row q-col-gutter-sm">
            <div class="col-6">
              <q-input v-model="newDs.schema_name" outlined dense label="Esquema *" placeholder="public" />
            </div>
            <div class="col-6">
              <q-input v-model="newDs.table_name" outlined dense label="Tabla / Vista *" placeholder="v_ventas" />
            </div>
          </div>
          <q-select v-model="newDs.table_type" outlined dense label="Tipo"
            :options="typeOptions" emit-value map-options />
        </q-card-section>

        <q-card-actions align="right" class="q-pa-md bg-grey-1">
          <q-btn flat label="Cancelar" v-close-popup />
          <q-btn color="primary" label="Registrar" unelevated class="text-weight-bold"
            :disable="!newDs.source_key || !newDs.schema_name || !newDs.table_name"
            :loading="savingDs" @click="createDatasource" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Fields editor -->
    <FieldsEditorDialog
      v-model="showFieldsDialog"
      :datasource="fieldsDs"
      @saved="loadDatasources"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { pivotAdminApi } from '../../admin/adminApi';
import FieldsEditorDialog from './FieldsEditorDialog.vue';

const $q = useQuasar();

// ─── Data sources table ──────────────────────────────────────────────────────
const loading = ref(false);
const datasources = ref([]);
const showFieldsDialog = ref(false);
const fieldsDs = ref(null);

const dsColumns = [
  { name: 'source_key', label: 'Clave', field: 'source_key', align: 'left' },
  { name: 'display_name', label: 'Nombre', field: 'display_name', align: 'left' },
  { name: 'table_ref', label: 'Objeto', field: 'table_name', align: 'left' },
  { name: 'table_type', label: 'Tipo', field: 'table_type', align: 'center' },
  { name: 'active_fields', label: 'Campos activos', field: 'active_fields', align: 'center' },
  { name: 'is_active', label: 'Activa', field: 'is_active', align: 'center' },
  { name: 'actions', label: '', field: () => '', align: 'right' },
];

const typeOptions = [
  { label: 'Tabla', value: 'table' },
  { label: 'Vista', value: 'view' },
  { label: 'Tabla foranea', value: 'foreign' },
];

function notifyError(msg, err) {
  $q.notify({ type: 'negative', message: msg, caption: errMessage(err) });
}
function errMessage(err) {
  return err?.response?.data?.detail || err?.message || 'Error desconocido';
}
function typeBadge(t) {
  return { table: 'blue-8', view: 'teal-8', foreign: 'indigo-8' }[t] || 'grey-7';
}

async function loadDatasources() {
  loading.value = true;
  try {
    const { data } = await pivotAdminApi.listDatasources();
    datasources.value = data;
  } catch (err) {
    notifyError('No se pudieron cargar las fuentes de datos', err);
  } finally {
    loading.value = false;
  }
}

// New datasource dialog
const showNewDialog = ref(false);
const savingDs = ref(false);
const newDs = ref(emptyDs());

function emptyDs() {
  return { source_key: '', display_name: '', schema_name: 'public', table_name: '', table_type: 'table' };
}
function openNewDialog() {
  newDs.value = emptyDs();
  showNewDialog.value = true;
}

async function createDatasource() {
  savingDs.value = true;
  try {
    await pivotAdminApi.createDatasource(newDs.value);
    $q.notify({ type: 'positive', message: 'Fuente registrada. Ahora detecta y habilita sus columnas.' });
    showNewDialog.value = false;
    await loadDatasources();
  } catch (err) {
    notifyError('No se pudo registrar la fuente', err);
  } finally {
    savingDs.value = false;
  }
}

async function toggleActive(row) {
  try {
    await pivotAdminApi.updateDatasource(row.id, { is_active: row.is_active });
    $q.notify({ type: 'positive', message: `Fuente ${row.source_key} ${row.is_active ? 'activada' : 'desactivada'}` });
  } catch (err) {
    row.is_active = !row.is_active;
    notifyError('No se pudo cambiar el estado', err);
  }
}

async function validateSource(row) {
  try {
    const { data } = await pivotAdminApi.validateSource(row.source_key);
    if (!data.staleFields.length) {
      $q.notify({ type: 'positive', message: 'Todas las columnas activas existen en la tabla fisica.' });
    } else {
      $q.notify({
        type: 'warning',
        message: `${data.staleFields.length} campo(s) ya no existen en la tabla: ${data.staleFields.join(', ')}`,
        timeout: 6000,
      });
    }
  } catch (err) {
    notifyError('Error al validar la fuente', err);
  }
}

onMounted(loadDatasources);
</script>

