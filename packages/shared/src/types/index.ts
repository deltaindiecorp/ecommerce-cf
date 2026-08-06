// ─── API Response ─────────────────────────────────────────────────────────────
export type ApiResponse<T> = {
  success: true;
  data: T;
  meta?: { page?: number; limit?: number; total?: number };
} | {
  success: false;
  error: string;
  code?: string;
};

// ─── Cart ─────────────────────────────────────────────────────────────────────
export type CartItem = {
  productId: string;
  variantId?: string;
  productName: string;
  variantName?: string;
  sku: string;
  imageUrl?: string;
  price: number;
  weight: number;
  qty: number;
  subtotal: number;
};

export type Cart = {
  id: string;           // cart session id
  userId?: string;      // null = guest
  items: CartItem[];
  subtotal: number;
  itemCount: number;
  createdAt: string;
  expiresAt: string;
};

// ─── Shipping ─────────────────────────────────────────────────────────────────
export type ShippingRate = {
  courier: string;
  courierName: string;
  service: string;
  serviceName: string;
  cost: number;
  etd: string;
};

export type AdminStatsOverview = {
  totalSalesToday:      number;
  totalSalesTrendPct:   number;  // vs kemarin, bisa negatif
  newOrdersToday:       number;
  newOrdersTrendPct:    number;
  newCustomersToday:    number;
  newCustomersTrendPct: number;
  weeklyRevenue: Array<{ date: string; label: string; revenue: number }>;
};

export type CityOption = {
  cityId:     number;
  cityName:   string;
  type:       string; // "Kota" | "Kabupaten"
  province:   string;
  postalCode: string;
};

export type ResiStatus = {
  trackingNo: string;
  courier: string;
  status: string;
  history: Array<{
    date: string;
    description: string;
    location?: string;
  }>;
  estimatedDelivery?: string;
};

// ─── Checkout ─────────────────────────────────────────────────────────────────
export type CheckoutPayload = {
  // Guest fields (required jika tidak login)
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;

  shippingAddress: {
    name: string;
    phone: string;
    address: string;
    district: string;
    city: string;
    province: string;
    postalCode: string;
    rajaongkirCityId: number;
  };

  courier: string;
  service: string;
  shippingCost: number;

  paymentMethod: "midtrans" | "xendit" | "cod";
  voucherCode?: string;
  note?: string;
};

// ─── Payment ──────────────────────────────────────────────────────────────────
export type PaymentMethod =
  | "va_bca" | "va_bni" | "va_bri" | "va_mandiri" | "va_permata"
  | "qris" | "gopay" | "shopeepay" | "ovo" | "dana" | "linkaja"
  | "credit_card" | "cod";

export type PaymentResult = {
  orderId: string;
  paymentId: string;
  gateway: "midtrans" | "xendit";
  method: PaymentMethod;
  amount: number;
  // Midtrans
  snapToken?: string;
  snapRedirectUrl?: string;
  // Xendit
  invoiceUrl?: string;
  vaNumber?: string;
  expiredAt?: string;
};
