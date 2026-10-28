<template>
  <q-dialog
    :model-value="modelValue"
    persistent maximized
    transition-show="slide-up" transition-hide="slide-down"
    @update:model-value="v => emit('update:modelValue', v)"
  >
    <q-card class="column no-wrap" style="min-height: 90vh">
      <!-- Header -->
      <q-card-section class="bg-primary text-white row items-center q-py-md">
        <q-icon name="view_column" class="q-mr-sm" size="22px" />
        <div>
          <div class="text-h6 text-weight-bold">Campos — {{ datasource?.display_name }}</div>
          <div class="text-caption opacity-8">{{ datasource?.schema_name }}.{{ datasource?.table_name }}</div>
        </div>
        <q-space />
        <q-btn flat round dense icon="close" @click="close" />
      </q-card-section>

      <!-- Toolbar -->
      <q-card-section class="row items-center q-gutter-sm bg-grey-1 q-py-sm">
        <q-btn color="primary" icon="refresh" label="Detectar columnas" unelevated dense
          :loading="detecting" @click="detectColumns" />
        <q-input v-model="search" outlined dense clearable placeholder="Filtrar..."
          bg-color="white" style="max-width: 240px;" />
        <q-space />
        <q-btn color="primary" icon="save" label="Guardar" unelevated
          :disable="!enabledRows.length" :loading="saving" @click="save" />
      </q-card-section>

      <q-separator />

      <!-- Fields table -->
      <q-card-section class="col overflow-auto">
        <p class="text-caption text-grey-7 q-mb-sm">
          Marca las columnas que estaran disponibles en el generador de consultas. Asigna etiqueta, categoria y tipo.
        </p>
        <q-table
          :rows="filteredRows"
          :columns="fieldColumns"
          row-key="columnName"
          flat bordered dense
          :pagination="{ rowsPerPage: 0 }"
          class="bg-white"
        >
          <template #body-cell-enabled="props">
            <q-td auto-width>
              <q-toggle dense v-model="props.row.enabled" color="green-8" />
            </q-td>
          </template>
          <template #body-cell-column="props">
            <q-td>
              <div class="text-weight-medium row items-center q-gutter-xs">
                {{ props.row.columnName }}
                <q-icon v-if="props.row.stale" name="warning" color="orange-9" size="14px">
                  <q-tooltip>La columna ya no existe en la tabla fisica</q-tooltip>
                </q-icon>
              </div>
              <q-badge dense outline color="grey-7" :label="props.row.sqlType" />
            </q-td>
          </template>
          <template #body-cell-displayLabel="props">
            <q-td>
              <q-input v-model="props.row.displayLabel" dense outlined :disable="!props.row.enabled" />
            </q-td>
          </template>
          <template #body-cell-category="props">
            <q-td>
              <q-select
                v-model="props.row.category" dense outlined use-input hide-selected fill-input
                input-debounce="0" :options="categoryOptions" :disable="!props.row.enabled"
                new-value-mode="add" />
            </q-td>
          </template>
          <template #body-cell-fieldType="props">
            <q-td>
              <q-select v-model="props.row.fieldType" dense outlined
                :options="['text', 'numeric', 'date']" :disable="!props.row.enabled" />
            </q-td>
          </template>
          <template #body-cell-isMultivalue="props">
            <q-td auto-width>
              <q-toggle dense v-model="props.row.isMultivalue" :disable="props.row.fieldType !== 'text'" />
            </q-td>
          </template>
        </q-table>
      </q-card-section>

      <q-separator />
      <q-card-actions align="right" class="q-pa-md bg-grey-1">
        <q-btn flat label="Cerrar" @click="close" />
        <q-btn color="primary" icon="save" label="Guardar campos" unelevated
          :disable="!enabledRows.length" :loading="saving" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useQuasar } from 'quasar';
import { pivotAdminApi } from '../../admin/adminApi';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  datasource: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue', 'saved']);

const $q = useQuasar();

const rows = ref([]);
const search = ref('');
const detecting = ref(false);
const saving = ref(false);

const fieldColumns = [
  { name: 'enabled', label: 'Usar', field: 'enabled', align: 'center', style: 'width: 60px' },
  { name: 'column', label: 'Columna fisica', field: 'columnName', align: 'left', sortable: true },
  { name: 'displayLabel', label: 'Etiqueta visible', field: 'displayLabel', align: 'left' },
  { name: 'category', label: 'Categoria', field: 'category', align: 'left' },
  { name: 'fieldType', label: 'Tipo', field: 'fieldType', align: 'center', style: 'width: 110px' },
  { name: 'isMultivalue', label: 'Multivalor', field: 'isMultivalue', align: 'center', style: 'width: 90px' },
];

const filteredRows = computed(() => {
  const q = (search.value || '').toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter(r =>
    r.columnName.toLowerCase().includes(q) ||
    (r.displayLabel || '').toLowerCase().includes(q) ||
    (r.category || '').toLowerCase().includes(q)
  );
});
const enabledRows = computed(() => rows.value.filter(r => r.enabled));

const categoryOptions = computed(() => {
  const s = new Set(rows.value.map(r => r.category).filter(Boolean));
  return [...s].sort();
});

watch(() => props.modelValue, async (open) => {
  if (open && props.datasource?.id) await reload();
});

async function reload() {
  if (!props.datasource?.id) return;
  try {
    const [savedResult, detectedResult] = await Promise.allSettled([
      pivotAdminApi.listFields(props.datasource.id),
      pivotAdminApi.detectColumns(props.datasource.id),
    ]);
    const saved = savedResult.status === 'fulfilled' ? savedResult.value.data : [];
    const detected = detectedResult.status === 'fulfilled' ? detectedResult.value.data : [];

    const savedByCol = new Map(saved.map(f => [f.column_name, f]));
    const merged = [];

    for (const f of saved) {
      merged.push({
        id: f.id,
        columnName: f.column_name,
        sqlType: '(guardado)',
        fieldKey: f.field_key,
        displayLabel: f.display_label,
        category: f.category,
        fieldType: f.field_type,
        isMultivalue: !!f.is_multivalue,
        enabled: !!f.is_active,
        stale: detected.length > 0 && !detected.some(d => d.columnName === f.column_name),
      });
    }
    for (const d of detected) {
      if (savedByCol.has(d.columnName)) continue;
      merged.push({
        id: null,
        columnName: d.columnName,
        sqlType: d.sqlType,
        fieldKey: d.columnName,
        displayLabel: d.suggestedLabel,
        category: 'General',
        fieldType: d.suggestedType,
        isMultivalue: false,
        enabled: false,
        stale: false,
      });
    }
    rows.value = merged;
  } catch (err) {
    $q.notify({ type: 'negative', message: 'Error cargando columnas', caption: errMsg(err) });
  }
}

async function detectColumns() {
  if (!props.datasource?.id) return;
  detecting.value = true;
  try {
    const { data: detected } = await pivotAdminApi.detectColumns(props.datasource.id);
    const known = new Set(rows.value.map(r => r.columnName));
    let added = 0;
    for (const d of detected) {
      if (!known.has(d.columnName)) {
        rows.value.push({
          id: null,
          columnName: d.columnName,
          sqlType: d.sqlType,
          fieldKey: d.columnName,
          displayLabel: d.suggestedLabel,
          category: 'General',
          fieldType: d.suggestedType,
          isMultivalue: false,
          enabled: false,
          stale: false,
        });
        added++;
      }
    }
    $q.notify({ type: 'positive', message: `${added} columna(s) nueva(s) detectada(s)` });
  } catch (err) {
    $q.notify({ type: 'negative', message: 'Error detectando columnas', caption: errMsg(err) });
  } finally {
    detecting.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    const payload = enabledRows.value.map(r => ({
      field_key: r.fieldKey || r.columnName,
      column_name: r.columnName,
      display_label: r.displayLabel || r.columnName,
      category: r.category || 'General',
      field_type: r.fieldType,
      is_multivalue: !!r.isMultivalue,
    }));
    await pivotAdminApi.saveFields(props.datasource.id, payload);

    for (const row of rows.value.filter(r => r.id && !r.enabled)) {
      await pivotAdminApi.updateField(row.id, { is_active: false });
    }

    $q.notify({ type: 'positive', message: `Campos guardados para "${props.datasource?.source_key}"` });
    emit('saved');
    close();
  } catch (err) {
    $q.notify({ type: 'negative', message: 'No se pudieron guardar los campos', caption: errMsg(err) });
  } finally {
    saving.value = false;
  }
}

function close() {
  emit('update:modelValue', false);
}

function errMsg(err) {
  return err?.response?.data?.detail || err?.message || '';
}
</script>
