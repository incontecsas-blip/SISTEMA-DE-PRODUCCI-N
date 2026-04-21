// src/types/database.ts
// Tipos TypeScript generados desde el esquema de Supabase
// Actualizar con: npx supabase gen types typescript --project-id TU_PROJECT_ID > src/types/database.ts

export type UserRole = 'master' | 'admin' | 'vendedor' | 'bodega' | 'operario'
export type ProductType = 'MP' | 'PT'
export type OrderStatus =
  | 'borrador'
  | 'confirmado'
  | 'en_bodega'
  | 'en_produccion'
  | 'listo_entrega'
  | 'entregado'
  | 'anulado'
export type OpStatus =
  | 'pendiente'
  | 'en_proceso'
  | 'finalizada'
  | 'entregada_bodega'
  | 'anulada'
export type MovementType =
  | 'ENTRADA'
  | 'SALIDA_OP'
  | 'SALIDA_DESPACHO'
  | 'AJUSTE_ENTRADA'
  | 'AJUSTE_SALIDA'

// ── TABLAS ────────────────────────────────────────────────────

export interface Tenant {
  id: string
  nombre_sistema: string
  nombre_empresa: string
  logo_url: string | null
  activo: boolean
  licencias_total: number
  created_at: string
}

export interface User {
  id: string
  tenant_id: string
  nombre: string
  email: string
  rol: UserRole
  activo: boolean
  created_by: string | null
  ultimo_acceso: string | null
  created_at: string
}

export interface Cliente {
  id: string
  tenant_id: string
  ruc: string
  nombre: string
  nombre_comercial: string | null
  tipo: 'Nacional' | 'Exportador' | 'Industrial' | 'Distribuidor'
  contacto_nombre: string | null
  contacto_telefono: string | null
  contacto_email: string | null
  descuento_pct: number
  tiempo_entrega_dias: number
  direccion_entrega: string | null
  ciudad: string | null
  notas: string | null
  activo: boolean
  created_by: string | null
  created_at: string
}

export interface UnidadMedida {
  id: string
  tenant_id: string
  codigo: string
  nombre: string
  tipo: 'Peso' | 'Volumen' | 'Conteo'
  simbolo: string
}

export interface Producto {
  id: string
  tenant_id: string
  codigo: string
  nombre: string
  tipo: ProductType
  unidad_id: string
  costo_unitario: number
  stock_actual: number
  stock_minimo: number
  stock_maximo: number
  caducidad_dias: number | null
  manejo_lotes: boolean
  activo: boolean
  created_at: string
  // joins opcionales
  unidad?: UnidadMedida
}

export interface Lote {
  id: string
  tenant_id: string
  producto_id: string
  numero_lote: string
  proveedor: string | null
  cantidad_inicial: number
  cantidad_disponible: number
  costo_unitario: number | null
  fecha_ingreso: string
  fecha_vencimiento: string | null
  activo: boolean
  created_by: string | null
  created_at: string
  // joins opcionales
  producto?: Producto
}

export interface MovimientoInventario {
  id: string
  tenant_id: string
  producto_id: string
  lote_id: string | null
  tipo_movimiento: MovementType
  cantidad: number
  referencia_tipo: string | null
  referencia_id: string | null
  notas: string | null
  created_by: string | null
  created_at: string
  // joins opcionales
  producto?: Producto
  lote?: Lote
}

export interface Pedido {
  id: string
  tenant_id: string
  numero_pedido: string
  cliente_id: string
  vendedor_id: string
  estado: OrderStatus
  fecha_pedido: string
  fecha_entrega_solicitada: string
  fecha_entrega_real: string | null
  descuento_pct: number
  subtotal: number
  total: number
  observaciones: string | null
  oc_cliente_url: string | null
  created_at: string
  updated_at: string | null
  // joins opcionales
  cliente?: Cliente
  vendedor?: User
  lineas?: PedidoLinea[]
  historial?: PedidoHistorial[]
}

export interface PedidoLinea {
  id: string
  pedido_id: string
  producto_id: string
  cantidad: number
  unidad_id: string
  precio_unitario: number
  descuento_pct: number
  subtotal_linea: number
  notas: string | null
  // joins
  producto?: Producto
  unidad?: UnidadMedida
}

export interface PedidoHistorial {
  id: string
  pedido_id: string
  usuario_id: string
  estado_anterior: OrderStatus | null
  estado_nuevo: OrderStatus
  comentario: string | null
  created_at: string
  // joins
  usuario?: User
}

export interface Formula {
  id: string
  tenant_id: string
  producto_id: string
  version: number
  activa: boolean
  base_cantidad: number
  base_unidad_id: string
  notas: string | null
  created_by: string | null
  created_at: string
  // joins
  producto?: Producto
  lineas?: FormulaLinea[]
}

export interface FormulaLinea {
  id: string
  formula_id: string
  mp_id: string
  cantidad: number
  unidad_id: string
  es_semielaborado: boolean
  // joins
  mp?: Producto
  unidad?: UnidadMedida
}

export interface OrdenProduccion {
  id: string
  tenant_id: string
  numero_op: string
  pedido_id: string
  pedido_linea_id: string
  formula_id: string
  estado: OpStatus
  cantidad_a_producir: number
  cantidad_producida: number | null
  responsable_id: string | null
  fecha_inicio: string | null
  fecha_fin: string | null
  lote_pt: string | null
  notas: string | null
  created_at: string
  // joins
  pedido?: Pedido
  formula?: Formula
  responsable?: User
  consumos?: OpConsumo[]
}

export interface OpConsumo {
  id: string
  op_id: string
  mp_id: string
  lote_id: string | null
  cantidad_teorica: number
  cantidad_real: number | null
  merma: number
  merma_pct: number | null
  dentro_parametro: boolean | null
  // joins
  mp?: Producto
  lote?: Lote
}

export interface ParametrosSistema {
  id: string
  tenant_id: string
  merma_aceptable_pct: number
  dias_alerta_vencimiento: number
  moneda: string
  updated_by: string | null
  updated_at: string | null
}

// ── HELPERS ───────────────────────────────────────────────────

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  borrador:       'Borrador',
  confirmado:     'Confirmado',
  en_bodega:      'En Bodega',
  en_produccion:  'En Producción',
  listo_entrega:  'Listo para Entrega',
  entregado:      'Entregado',
  anulado:        'Anulado',
}

export const OP_STATUS_LABELS: Record<OpStatus, string> = {
  pendiente:        'Pendiente',
  en_proceso:       'En Proceso',
  finalizada:       'Finalizada',
  entregada_bodega: 'Entregada a Bodega',
  anulada:          'Anulada',
}

export const ORDER_STATUS_FLOW: OrderStatus[] = [
  'borrador',
  'confirmado',
  'en_bodega',
  'en_produccion',
  'listo_entrega',
  'entregado',
]

export const ROLE_LABELS: Record<UserRole, string> = {
  master:   'Admin Master',
  admin:    'Administrador',
  vendedor: 'Vendedor',
  bodega:   'Bodega',
  operario: 'Operario',
}
