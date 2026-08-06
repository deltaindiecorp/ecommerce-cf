import { Link } from "@remix-run/react";

export function ProductCard({ product: p }: { product: any }) {
  const isSale = p.comparePrice && p.comparePrice > p.price;
  const isNew  = p.createdAt && (Date.now() - new Date(p.createdAt).getTime()) < 14 * 24 * 60 * 60 * 1000;

  return (
    <Link to={`/products/${p.slug}`} className="group">
      <div className="bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow border border-gray-100 h-full flex flex-col">
        <div className="relative aspect-square bg-gray-50 overflow-hidden">
          {isSale && (
            <span className="absolute top-2 left-2 z-10 bg-red-600 text-white text-[10px] font-semibold px-2 py-1 rounded-full">Sale</span>
          )}
          {!isSale && isNew && (
            <span className="absolute top-2 left-2 z-10 bg-gray-800 text-white text-[10px] font-semibold px-2 py-1 rounded-full">Baru</span>
          )}
          {p.images?.[0] ? (
            <img
              src={p.images[0]}
              alt={p.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl">📦</div>
          )}
        </div>
        <div className="p-3 flex flex-col flex-1">
          <p className="text-sm text-gray-800 font-medium line-clamp-2 mb-1">{p.name}</p>
          <div className="mt-auto">
            <p className="text-blue-600 font-bold text-sm">Rp {p.price.toLocaleString("id-ID")}</p>
            {isSale && (
              <p className="text-gray-400 text-xs line-through">Rp {p.comparePrice.toLocaleString("id-ID")}</p>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
