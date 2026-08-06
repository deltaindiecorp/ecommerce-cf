import { Link, useLocation, useRouteLoaderData } from "@remix-run/react";
import type { loader as rootLoader } from "~/root";

// Fixed bottom nav, mobile only. "Wishlist" sengaja tidak ada — fitur itu
// belum ada di aplikasi ini, jadi tidak ditampilkan seolah-olah sudah ada.
const ITEMS = [
  { to: "/",     icon: "🏠", label: "Home" },
  { to: "/?category=all", icon: "🔍", label: "Cari" },
  { to: "/cart", icon: "🛍️", label: "Cart" },
  { to: "/auth/login", icon: "👤", label: "Akun" },
];

export function MobileBottomNav() {
  const rootData = useRouteLoaderData<typeof rootLoader>("root");
  const cartCount = rootData?.cartItemCount ?? 0;
  const location  = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t shadow-[0_-2px_10px_rgba(0,0,0,0.05)] md:hidden">
      <div className="flex justify-around items-center h-16">
        {ITEMS.map((item) => {
          const isActive = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to.split("?")[0]);
          return (
            <Link
              key={item.label}
              to={item.to}
              className={`relative flex flex-col items-center justify-center gap-0.5 w-full h-full text-xs ${
                isActive ? "text-blue-600 font-semibold" : "text-gray-500"
              }`}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label === "Cart" && cartCount > 0 && (
                <span className="absolute top-1.5 right-[calc(50%-18px)] bg-red-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {cartCount > 9 ? "9+" : cartCount}
                </span>
              )}
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
