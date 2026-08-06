export type Env = {
  // D1
  DB: D1Database;

  // KV
  CART_KV:    KVNamespace;
  SESSION_KV: KVNamespace;
  CACHE_KV:   KVNamespace;

  // R2
  STORAGE: R2Bucket;

  // Queues
  NOTIFICATION_QUEUE: Queue;
  RESI_POLL_QUEUE:    Queue;

  // Durable Objects
  CART_DO:       DurableObjectNamespace;
  STOCK_LOCK_DO: DurableObjectNamespace;

  // Vars
  ENVIRONMENT:          string;
  APP_URL:              string;
  CORS_ORIGINS:         string; // comma-separated, ganti per klien
  EMAIL_FROM_NAME:      string; // nama toko untuk pengirim email, ganti per klien
  EMAIL_FROM_ADDRESS:   string;
  RAJAONGKIR_API_KEY:   string;
  BINDERBYTE_API_KEY:   string;
  MIDTRANS_SERVER_KEY:  string;
  MIDTRANS_CLIENT_KEY:  string;
  MIDTRANS_IS_PROD:     string;
  XENDIT_SECRET_KEY:    string;
  XENDIT_WEBHOOK_TOKEN: string;
  RESEND_API_KEY:       string;
  JWT_SECRET:           string;
  ADMIN_BOOTSTRAP_SECRET: string; // sekali pakai untuk /api/auth/bootstrap-admin
};
