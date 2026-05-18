import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../utils/api.js";
import { useAuth } from "../hooks/useAuth.jsx";

function formatPrice(cents) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

export default function Shop() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.getProducts()
      .then((data) => setProducts(data.products || []))
      .catch((err) => setMessage(err?.message || "Could not load products right now."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const status = searchParams.get("checkout");
    if (status === "success") setMessage("Payment successful. Your order is confirmed.");
    if (status === "cancelled") setMessage("Checkout cancelled. No payment was taken.");
  }, [searchParams]);

  async function buyProduct(product) {
    if (!user) {
      setMessage("Log in or create an account first, then you can check out.");
      return;
    }
    setBusyId(product.id);
    setMessage("");
    try {
      const data = await api.createProductCheckout(product.id, 1);
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setMessage(err?.message || "Could not start checkout for that item.");
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-5">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Konvict Artz Shop</h1>
            <p className="text-sm text-gray-400">Products added in inventory show here when stock is available.</p>
          </div>
          <Link to="/" className="text-sm font-semibold text-brand hover:text-brand-light">Back Home</Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {message && (
          <div className="mb-6 rounded-md border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-gray-100">
            {message}
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-gray-400">Loading products...</div>
        ) : products.length === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
            <h2 className="text-lg font-semibold">No products available yet</h2>
            <p className="mt-2 text-sm text-gray-400">Add items with stock in the admin inventory and they will appear here.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <article key={product.id} className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
                <div className="aspect-[4/3] bg-gray-800">
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-gray-800 to-gray-950 text-4xl font-black text-brand">
                      KA
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-white">{product.name}</h2>
                      <p className="text-xs uppercase tracking-wide text-gray-500">{product.category || "Product"}</p>
                    </div>
                    <p className="shrink-0 font-bold text-green-400">{formatPrice(product.price_cents)}</p>
                  </div>
                  {product.description && <p className="mb-4 text-sm text-gray-400">{product.description}</p>}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-500">{product.quantity} in stock</span>
                    <button
                      type="button"
                      onClick={() => buyProduct(product)}
                      disabled={busyId === product.id}
                      className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
                    >
                      {busyId === product.id ? "Opening..." : "Buy Now"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
