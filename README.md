# dash-pivot

Motor de dashboard dinámico reutilizable (tablas y gráficos pivot + consultas guardadas) para **Vue 3 + Quasar** (frontend) y **Node/Express + PostgreSQL** (backend).

El paquete es **agnóstico del dominio**: no conoce ninguna tabla, esquema ni vista de tu negocio. Cada aplicación anfitriona registra sus propias fuentes de datos (tablas/vistas de cualquier esquema) y sus columnas desde una API de administración, y el motor se encarga de todo lo demás: drag & drop de campos, filtros avanzados AND/OR, agregaciones, tabla pivot cruzada, gráficos, consultas guardadas, fijado (pins) y exportación.

> Español | English docs coming soon

---

## Características

- 🧩 **Panel de consultas dinámicas** estilo tabla dinámica de Excel: zonas Filas / Columnas / Valores / Filtros con drag & drop.
- 📊 Tabla pivot cruzada + gráficos (barras, barras horizontales, línea, torta, dona) con Chart.js.
- 🔎 Filtros avanzados por campo con grupos AND/OR y 19 operadores (eq, like, between, in, regex, isnull…).
- 🧮 Agregaciones SUM / COUNT / AVG / MIN / MAX.
- 💾 Consultas guardadas por usuario, visibilidad privada/pública, compartición por usuario o rol, y **pins** (fijar tabla/gráfica por defecto).
- 📤 Exportación: Excel, CSV, JSON (tabla, gráfico y datos crudos), PNG y PDF del gráfico.
- 🔐 Seguridad desacoplada: el anfitrión inyecta su propio modelo de permisos mediante un *hook*.
- 🗄️ **Sin tablas de negocio hardcodeadas**: las fuentes de datos se registran en tiempo de ejecución y las columnas se **autodetectan** desde `information_schema`.
- 🧩 Extensible a otros motores de BD mediante la capa de dialectos (hoy: PostgreSQL).

---

## Arquitectura

```
┌────────────────────── PAQUETE (genérico) ─────────────────────┐
│ FRONTEND (Vue 3 + Quasar)                                     │
│   DynamicQueryPanel · PivotTable · PivotChart · FilterEditor  │
│   Store Pinia (singleton o instancias aisladas)               │
│ BACKEND                                                       │
│   GraphQL: dashboardData / availableFields (schema genérico)  │
│   Constructor SQL dinámico + capa de dialectos                │
│   Autodetección de columnas (information_schema)              │
│   REST: saved queries + admin API de metadatos                │
└───────────────────────────────────────────────────────────────┘
          ▲                                   ▲
          │ pool de conexión                  │ hook de permisos
┌─────────┴───────────────────────────────────┴───────────────┐
│  APLICACIÓN ANFITRIONA (su BD, sus tablas, sus roles)        │
│  Tablas de metadatos: pivot_datasources · pivot_fields ·     │
│  pivot_saved_queries · pivot_saved_query_access              │
└──────────────────────────────────────────────────────────────┘
```

El paquete **no conoce ninguna tabla de negocio**. Todo se define en tiempo de ejecución:

1. Se registran las tablas/vistas a exponer (`pivot_datasources`).
2. Se autodetectan sus columnas y se habilitan con etiqueta y categoría (`pivot_fields`).
3. La UI del componente trabaja únicamente con ese catálogo.

---

## Instalación

```bash
npm install dash-pivot
```

Requisitos del anfitrión: `pg`, `graphql`, `graphql-http`, `express` y un frontend Vue 3 + Quasar (Pinia, axios).

---

## Integración — Backend (Node/Express)

```js
const { createPivotBackend } = require('dash-pivot');

// `pool` es tu Pool de pg (UNA base de datos por proyecto).
const pivot = createPivotBackend({ pool });

// 1) Seguridad — inyecta TU modelo de permisos (roles, RLS, multi-tenant…).
//    El hook devuelve la cláusula WHERE obligatoria que se antepone a los
//    filtros del usuario. `t` es el alias de la tabla registrada.
pivot.setPermissionHook(async ({ userId, roleId, source }) => {
  if (await isAdmin(userId)) return { clause: '', params: [], nextParamIndex: 1 };
  return {
    clause: 'WHERE t.owner_id = $1',
    params: [userId],
    nextParamIndex: 2, // primer $n libre tras la cláusula
  };
});

// 2) Consultas guardadas (REST) — protegido por TU middleware de auth.
//    Requiere req.user = { id, roleId }.
app.use('/api/pivot', requireAuth, pivot.savedQueriesRouter);

// 3) API de administración — protege con TU middleware de administradores.
app.use('/api/pivot/admin', requireAdmin, pivot.adminRouter);

// 4) GraphQL
app.all('/graphql', requireAuth, (req, res, next) =>
  pivot.graphql.mountGraphQL /* ver ejemplo abajo */);
```

Montaje directo de GraphQL con el helper incluido:

```js
// dentro de createPivotBackend devuelve también:
pivot.graphql.mountGraphQL(app, { path: '/graphql', requireAuth: requireAuthMiddleware });
```

### Migración inicial

Ejecuta `src/database/migrations/0001_init.sql` en tu base de datos. Crea:

| Tabla | Propósito |
|---|---|
| `pivot_datasources` | Esquemas/tablas/vistas expuestas (`source_key` → `schema.table`) |
| `pivot_fields` | Columnas habilitadas: etiqueta, categoría, tipo, multivalor |
| `pivot_saved_queries` | Consultas guardadas + pins + visibilidad |
| `pivot_saved_query_access` | Compartición por usuario/rol |

### Registrar fuentes de datos (API de administración)

```http
POST /api/pivot-admin/datasources
{ "source_key": "ventas", "display_name": "Ventas", "schema_name": "public", "table_name": "ventas" }

GET  /api/pivot-admin/datasources/1/columns   # autodetección de columnas
POST /api/pivot-admin/datasources/1/fields
{ "fields": [ { "column_name": "region", "display_label": "Región", "category": "Ubicación", "field_type": "text" } ] }
```

`field_type` ∈ `text | numeric | date`. `is_multivalue: true` activa la desagregación automática de columnas con valores separados por comas.

---

## Integración — Frontend (Vue 3 + Quasar)

```js
// boot/pivot.js (Quasar)
import { boot } from 'quasar/wrappers';
import { configurePivotApi } from 'dash-pivot/frontend';
import { api } from 'boot/axios';

export default () => {
  configurePivotApi(api, { basePath: '/api/pivot' });
};
```

```vue
<template>
  <DynamicQueryPanel :data-source="'ventas'" />
</template>

<script setup>
import { DynamicQueryPanel } from 'dash-pivot/frontend';
</script>
```

Para varias instancias aisladas (cada tab con su propia configuración):

```vue
<DynamicQueryPanel :store="myStoreInstance" data-source="ventas" />
```

> Nota: agrega el paquete a `transpileDependencies`/`build.transpileDependencies` de Quasar para que Vite/webpack transpile los `.vue` incluidos.

---

## Seguridad (hook de permisos)

El paquete **no** trae modelo de usuarios: tú inyectas tu lógica.

```js
pivot.setPermissionHook(async ({ userId, roleId, source }) => {
  if (roleId === ADMIN_ROLE) return { clause: '', params: [], nextParamIndex: 1 };
  return {
    clause: 'WHERE t.company_id = $1',
    params: [userId],
    nextParamIndex: 2,
  };
});
```

- `clause` se antepone a los filtros del usuario y no puede ser eludido desde la UI.
- Los usuarios/roles de `pivot_saved_queries` y `pivot_saved_query_access` son los IDs de **tu** aplicación.

---

## Estado del proyecto

| Fase | Estado |
|------|--------|
| 1. Extraccion del nucleo generico (frontend + backend) | ✅ |
| 2. Metadatos: autodeteccion de columnas + resolvers genericos | ✅ |
| 3. UI de administracion de fuentes y campos | ✅ |
| 4. Migracion del proyecto original como consumidor | 🔜 |
| 5. Publicacion npm + guia para proyectos nuevos | 🔜 |

## Uso del panel de administracion

```vue
<template>
  <!-- Solo administradores -->
  <DataSourceAdminPanel />
</template>

<script setup>
import { DataSourceAdminPanel } from 'dash-pivot/frontend';
</script>
```

El panel permite:
- Registrar nuevas tablas/vistas (el backend verifica que existan fisicamente).
- Detectar automaticamente todas sus columnas desde `information_schema`.
- Habilitar columnas con etiqueta visible, categoria y tipo (text/numeric/date).
- Marcar columnas como multivalor (valores separados por coma).
- Validar que las columnas activas sigan existiendo en la tabla.

## Licencia

MIT
