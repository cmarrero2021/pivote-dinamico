<template>
  <div class="filter-editor-root column q-gutter-md">
    <!-- Empty state -->
    <div v-if="!store.pivotFilters.length" class="text-grey-6 text-center q-pa-lg text-italic">
      <q-icon name="filter_alt_off" size="40px" class="q-mb-sm opacity-4" />
      <div>No hay filtros definidos. Arrastra campos a la zona de Filtros para empezar.</div>
    </div>

    <!-- Grupos -->
    <div
v-for="group in store.pivotFilters" :key="group.field"
      class="filter-group-card q-pa-md rounded-borders shadow-light">
      <!-- Group header -->
      <div class="row items-center justify-between q-mb-sm">
        <div class="row items-center q-gutter-sm">
          <q-icon
            :name="group.numeric ? 'tag' : group.date ? 'event' : 'text_fields'"
            size="18px"
            class="text-primary" />
          <span class="text-weight-bold text-grey-9">{{ group.label }}</span>
          <q-badge
            v-if="group.conditions.length > 1"
            :label="`${group.conditions.length} condiciones`"
            color="blue-1" text-color="blue-10" class="q-py-xs" />
        </div>
        <div class="row items-center q-gutter-xs">
          <q-btn
            flat dense round size="sm" icon="add" color="primary"
            @click="store.addFilterCondition(group.field)">
            <q-tooltip>Añadir condición</q-tooltip>
          </q-btn>
          <q-btn
            flat dense round size="sm" icon="delete" color="negative"
            @click="store.removeFieldFromZone(group.field, 'filters')">
            <q-tooltip>Eliminar grupo</q-tooltip>
          </q-btn>
        </div>
      </div>

      <q-separator class="q-mb-sm" />

      <!-- Conditions -->
      <div class="column q-gutter-sm">
        <div
v-for="(cond, idx) in group.conditions" :key="idx"
          class="condition-row row items-center q-gutter-sm">
          <!-- Conector (AND/OR) para condiciones 2+ -->
          <div v-if="idx > 0" class="connector-box">
            <q-btn-toggle
              :model-value="cond.combine"
              dense flat no-caps
              :options="[
                { label: 'Y', value: 'AND' },
                { label: 'O', value: 'OR' },
              ]"
              toggle-color="primary"
              @update:model-value="(v) => store.updateFilterCondition(group.field, idx, { combine: v })" />
          </div>
          <div v-else class="connector-placeholder text-center text-grey-6 text-xs">
            <q-icon name="filter_alt" size="14px" />
          </div>

          <!-- Operador -->
          <q-select
            :model-value="cond.operator"
            dense outlined
            :options="operatorsFor(group)"
            option-value="value" option-label="label"
            emit-value map-options
            style="min-width: 200px;"
            @update:model-value="(v) => store.updateFilterCondition(group.field, idx, { operator: v })">
            <template #prepend>
              <q-icon name="compare_arrows" size="16px" class="text-grey-6" />
            </template>
          </q-select>

          <!-- Value 1 -->
          <q-input
            v-if="arity(cond.operator) >= 1"
            :model-value="cond.value"
            dense outlined
            :type="group.date ? 'date' : 'text'"
            :placeholder="group.numeric ? 'Valor numérico' : (group.date ? 'Fecha' : 'Texto')"
            style="min-width: 180px;"
            @update:model-value="(v) => store.updateFilterCondition(group.field, idx, { value: v })" />

          <!-- Value 2 (between) -->
          <template v-if="arity(cond.operator) === 2">
            <span class="text-grey-6 text-weight-medium">y</span>
            <q-input
              :model-value="cond.value2"
              dense outlined
              :type="group.date ? 'date' : 'text'"
              :placeholder="group.numeric ? 'Máximo' : 'Límite'"
              style="min-width: 180px;"
              @update:model-value="(v) => store.updateFilterCondition(group.field, idx, { value2: v })" />
          </template>
          <div v-else-if="arity(cond.operator) === 0" class="text-grey-6 text-italic text-xs q-ml-sm">
            Sin valor requerido
          </div>

          <!-- Ayuda de operador -->
          <q-icon
            v-if="cond.operator === 'regex'"
            name="help_outline" size="16px" class="text-amber-8 cursor-pointer">
            <q-tooltip>
              Expresión regular PostgreSQL (~). Ej: `^[MV]-` para valores que comienzan con M- o V-.
            </q-tooltip>
          </q-icon>

          <!-- Botón eliminar condición -->
          <q-btn
            flat dense round size="sm" icon="close" color="grey-6"
            @click="store.removeFilterCondition(group.field, idx)">
            <q-tooltip>Eliminar condición</q-tooltip>
          </q-btn>
        </div>
      </div>

      <!-- Summary preview -->
      <div class="condition-preview q-mt-sm q-pa-xs text-xs text-grey-7">
        <q-icon name="code" size="12px" class="q-mr-xs" />
        {{ humanReadable(group) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { useDynamicQueryStore } from '../stores/dynamicQueryStore';

const props = defineProps({
  store: { type: Object, default: null },
});
const store = props.store || useDynamicQueryStore();

function operatorsFor(group) {
  return store.operatorsForGroup(group.field);
}

function arity(op) {
  return store.operatorArity(op);
}

// Human-friendly preview del grupo: "Edad (≥ 60 Y ≤ 75)"
function humanReadable(group) {
  return group.conditions.map((c, i) => {
    const op = store.getOperatorLabel(c.operator);
    const conn = i > 0 ? ` ${c.combine} ` : '';
    let valText = '';
    const ar = arity(c.operator);
    if (ar === 0) valText = '';
    else if (ar === 2) valText = ` ${c.value} y ${c.value2}`;
    else valText = ` ${c.value}`;
    return `${conn}${op}${valText}`;
  }).join('');
}
</script>

<style scoped>
.filter-editor-root {
  min-width: 560px;
  max-width: 720px;
}

.filter-group-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.shadow-light {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.03);
}

.condition-row {
  flex-wrap: wrap;
  align-items: center;
}

.connector-box {
  min-width: 70px;
}

.connector-placeholder {
  min-width: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.condition-preview {
  background: #f8fafc;
  border-radius: 6px;
  border-left: 3px solid #3b82f6;
  font-family: 'Consolas', 'Monaco', monospace;
  color: #64748b;
}
</style>
