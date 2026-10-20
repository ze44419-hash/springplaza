export type Role = 'admin' | 'cashier' | 'waiter' | 'accountant' | 'hall_manager' | 'cafe_manager' | 'session_manager';
export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type OrderKind = 'standard' | 'employee' | 'hospitality';
export type OrderStatus = 'new' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type PayMethod = 'cash' | 'card';
export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'pcs';
export type InvTxType = 'purchase' | 'sale' | 'supplier_return' | 'adjustment' | 'waste';

export interface Profile { id: string; full_name: string; role: Role; is_active: boolean; created_at: string }
export interface CafeTable { id: string; label: string; sort_order: number; is_active: boolean }
export interface Category { id: string; name: string; sort_order: number; is_active: boolean }
export interface Product {
  id: string; category_id: string; name: string; price: number; cost_price?: number;
  image_url: string | null; is_available: boolean; sort_order: number;
}
export interface Modifier { id: string; name: string; price_delta: number; is_active: boolean }
export interface Ingredient {
  id: string; name: string; unit: Unit; stock_qty: number; min_threshold: number; supplier: string | null;
}
export interface RecipeLine { product_id: string; ingredient_id: string; qty_per_unit: number }
export interface InventoryTx {
  id: string; ingredient_id: string; type: InvTxType; qty_change: number;
  note: string | null; order_id: string | null; created_at: string;
}

export interface OrderItemMod { id: string; name: string; price_delta: number }
export interface OrderItem {
  id: string; order_id: string; product_id: string; name: string; unit_price: number; cost_price?: number;
  qty: number; modifiers: OrderItemMod[]; modifiers_total: number; note: string | null; position: number;
}
export interface Order {
  id: string; order_no: number | null; order_type: OrderType; /** undefined on rows cached before migration 009 = standard */ order_kind?: OrderKind; table_id: string | null;
  waiter_id: string | null; status: OrderStatus; notes: string | null;
  subtotal: number; discount: number; total: number;
  payment_method: PayMethod | null; amount_tendered: number | null; paid_at: string | null;
  shift_id: string | null; cashier_id: string | null; created_at: string; updated_at: string;
  /** Set by the admin when the order was edited after it was sent. */
  edited_at?: string | null;
}
/** Order as stored in IndexedDB: includes its lines and a flag while changes are still queued. */
export type LocalOrder = Order & { items: OrderItem[]; pending?: boolean; sync_error?: string };

export interface LocalShift {
  id: string; opened_at: string; opening_cash: number; status: 'open' | 'closed';
}

export interface Warehouse { id: string; name: string; sort_order: number; is_active: boolean }
export interface WarehouseStock { warehouse_id: string; ingredient_id: string; qty: number }

/** One ingredient line of a cashier withdrawal. Left with the barista = out − returned − used − variance. */
export interface WithdrawalItem {
  id: string; withdrawal_id: string; ingredient_id: string;
  qty_out: number; qty_returned: number; qty_used: number; qty_variance: number;
}
export interface Withdrawal {
  id: string; warehouse_id: string; cashier_id: string; shift_id: string | null; status: 'open' | 'closed';
  note: string | null; created_at: string; closed_at: string | null; closed_by: string | null;
  stock_withdrawal_items: WithdrawalItem[];
}

// ---------- القاعة (Hall) ----------
export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';
export type ServiceKind = 'dish' | 'extra';
export type ExpenseScope = 'cafe' | 'hall' | 'general';

export interface HallRate { id: string; name: string; price: number; is_active: boolean; sort_order: number }
export interface HallService {
  id: string; kind: ServiceKind; name: string; price: number; cost_price: number; unit_label: string | null; is_active: boolean; sort_order: number;
}
export interface BookingItem {
  id: string; booking_id: string; service_id: string | null; kind: ServiceKind; name: string;
  unit_price: number; cost_price: number; qty: number; line_total: number; position: number;
}
export interface HallBooking {
  id: string; booking_no: number; event_date: string; status: BookingStatus;
  customer_name: string; customer_phone: string | null; event_type: string | null; guests: number | null;
  rate_id: string | null; rate_name: string; hall_price: number;
  dishes_total: number; extras_total: number; discount: number; total: number; paid_amount: number;
  notes: string | null; created_at: string;
  hall_booking_items?: BookingItem[];
}
/** Result of the booking calculator (same shape from the server `hall_quote` RPC and from the client preview). */
export interface QuoteLine { service_id: string; kind: ServiceKind; name: string; unit_price: number; qty: number; line_total: number }
export interface Quote {
  hall_price: number; dishes_total: number; extras_total: number; subtotal: number; discount: number; total: number; lines: QuoteLine[];
}

// ---------- المحاسبة (Accounting) ----------
export type ExpenseType = 'operational' | 'establishment' | 'hospitality';
export interface Branch { id: string; type: 'cafe' | 'hall'; name: string; is_active?: boolean }
export interface BranchReportData {
  branch_id: string | null; revenue: number; orders: number; cogs: number; operational: number; hospitality: number; establishment: number;
  net_before_establishment: number; net: number; by_category: { expense_type: ExpenseType; category: string; total: number }[];
}
export interface Expense {
  id: string; expense_date: string; scope: ExpenseScope; category: string; description: string | null; amount: number; created_at: string;
  expense_type?: ExpenseType; branch_id?: string | null;
}
export interface Partner { id: string; name: string; share_pct: number; is_active: boolean }
export interface PartnerShare { partner_id: string; name: string; share_pct: number; amount: number }
export interface AccountingSummary {
  period: { from: string; to: string };
  cafe_revenue: number; cafe_orders: number; hall_revenue: number; hall_bookings: number;
  total_revenue: number; cafe_cogs: number; hall_cogs: number; cogs_total: number; gross_profit: number;
  expenses_total: number; net_profit: number;
  expenses_by_category: { category: string; total: number }[];
  expenses_by_scope: { scope: ExpenseScope; total: number }[];
  daily: { day: string; cafe: number; hall: number; expenses: number }[];
  partners: PartnerShare[]; shares_total: number; active_partners: number;
}
export interface ProfitDistribution {
  id: string; period_from: string; period_to: string; cafe_revenue: number; hall_revenue: number; cogs_total: number;
  expenses_total: number; net_profit: number; note: string | null; created_at: string;
  profit_distribution_lines: { id: string; partner_name: string; share_pct: number; amount: number }[];
}

// ---------- طلبات شخصية / ضيافة ----------
export interface EmployeeRequest {
  id: string; order_id: string; staff_id: string; staff_name: string | null; proxy: boolean; status: 'pending' | 'approved' | 'rejected';
  gross: number; discount_amount: number; amount: number; summary: string | null; created_at: string;
}
/** approved_by_admin: null = مستني الأدمن · true = اتوافق · false = اترفض */
export interface HospitalityRequest {
  id: string; order_id: string; approved_by_admin: boolean | null; amount: number; notes: string | null; created_at: string;
  orders?: { order_no: number; order_items: { name: string; qty: number }[] } | null;
}
export type SalaryType = 'monthly' | 'daily';
export interface StaffPayroll {
  id: string; name: string; kind: 'employee' | 'partner' | 'admin'; salary_type: SalaryType; base_salary: number; advances: number;
  is_active: boolean; discounts: number; orders: number; job_title?: 'nursery_worker' | null;
}

// ---------- المشتل (Nursery) ----------
export interface NurseryItem {
  id: string; name: string; kind: 'plant' | 'supply'; unit_label: string | null; cost_price: number; selling_price: number;
  quantity: number; low_stock_at: number; is_active: boolean;
}
export interface NurseryReportData {
  revenue: number; cogs: number; gross: number; purchases: number; expenses: number; net: number; sales_count: number;
  items: { name: string; kind: string; quantity: number; cost_price: number; selling_price: number; stock_value: number; sold_qty: number; revenue: number; cogs: number; purchased_qty: number; purchases: number }[];
  staff: { name: string; sales: number; txns: number; expenses: number }[];
  txns: { txn_date: string; txn_type: 'purchase' | 'sale'; item: string; qty: number; unit_price: number; total: number; cogs: number; staff: string | null; note: string | null }[];
  expense_rows: { expense_date: string; category: string; description: string | null; amount: number; staff: string | null }[];
}

// ---------- سيشن التصوير + الصلاحيات ----------
export type SessionStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';
export interface PhotoSession {
  id: string; session_no: number; session_date: string; session_time: string; customer_name: string; customer_phone: string | null;
  price: number; deposit: number; status: SessionStatus; notes: string | null; created_at: string;
}
export type Permission = 'hall' | 'sessions' | 'accounting';
