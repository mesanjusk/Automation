// A tiny, self-contained website used ONLY as a local end-to-end fixture for
// the "Demo Website Data Extraction" automation. Never point automations at
// real third-party sites in tests — this exists so that guidance is easy to
// follow.
import express from "express";

const PORT = Number(process.env.TEST_SITE_PORT ?? 4100);
const app = express();
app.use(express.urlencoded({ extended: true }));

const PRODUCTS = [
  { id: "P001", name: "Widget A", price: "$12.00", stock: "42" },
  { id: "P002", name: "Widget B", price: "$18.50", stock: "0" },
  { id: "P003", name: "Widget C", price: "$7.25", stock: "17" },
];

function page(title, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; color: #1a1a1a; }
  input, button { font-size: 14px; padding: 8px; margin: 4px 0; }
  button { cursor: pointer; background: #2563eb; color: white; border: none; border-radius: 4px; padding: 8px 16px; }
  table { border-collapse: collapse; width: 100%; margin-top: 16px; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  .error { color: #dc2626; }
  .success { color: #16a34a; font-weight: 600; }
</style></head>
<body><h1>${title}</h1>${body}</body></html>`;
}

function isLoggedIn(req) {
  return req.headers.cookie?.includes("test_site_session=demo-user");
}

function requireLogin(req, res, next) {
  if (!isLoggedIn(req)) return res.redirect("/login");
  next();
}

app.get("/", (_req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  const error = req.query.error ? `<p class="error">Invalid username or password.</p>` : "";
  res.send(
    page(
      "Sign in",
      `${error}
      <form method="POST" action="/login">
        <div><label for="username">Username</label><br/><input id="username" name="username" data-testid="username-input" /></div>
        <div><label for="password">Password</label><br/><input id="password" name="password" type="password" data-testid="password-input" /></div>
        <button type="submit" data-testid="login-button">Log in</button>
      </form>
      <p style="color:#666;font-size:12px">demo credentials: <b>demo</b> / <b>demo123</b></p>`
    )
  );
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === "demo" && password === "demo123") {
    res.setHeader("Set-Cookie", "test_site_session=demo-user; Path=/; HttpOnly");
    return res.redirect("/search");
  }
  res.redirect("/login?error=1");
});

app.get("/search", requireLogin, (req, res) => {
  const q = req.query.q || "";
  const results = q
    ? PRODUCTS.filter((p) => p.id.toLowerCase().includes(String(q).toLowerCase()) || p.name.toLowerCase().includes(String(q).toLowerCase()))
    : [];

  const rows = results
    .map(
      (p) => `<tr data-testid="row-${p.id}">
        <td>${p.id}</td><td>${p.name}</td><td>${p.price}</td><td>${p.stock}</td>
        <td><a href="/download/${p.id}" data-testid="download-${p.id}">Download Invoice</a></td>
      </tr>`
    )
    .join("");

  res.send(
    page(
      "Search products",
      `<form method="GET" action="/search">
        <input name="q" placeholder="Product ID or name" value="${escapeHtml(String(q))}" data-testid="search-input" aria-label="Search products" />
        <button type="submit" data-testid="search-button">Search</button>
      </form>
      ${
        q
          ? `<table data-testid="results-table"><thead><tr><th>ID</th><th>Name</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="5">No results</td></tr>`}</tbody></table>`
          : ""
      }
      <p><a href="/form">Go to order form</a></p>`
    )
  );
});

app.get("/download/:id", requireLogin, (req, res) => {
  const product = PRODUCTS.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).send("Not found");
  res.setHeader("Content-Disposition", `attachment; filename="invoice-${product.id}.csv"`);
  res.setHeader("Content-Type", "text/csv");
  res.send(`id,name,price,stock\n${product.id},${product.name},${product.price},${product.stock}\n`);
});

app.get("/form", requireLogin, (_req, res) => {
  res.send(
    page(
      "Place an order",
      `<form method="POST" action="/form">
        <div><label for="productId">Product ID</label><br/><input id="productId" name="productId" data-testid="order-product-input" /></div>
        <div><label for="quantity">Quantity</label><br/><input id="quantity" name="quantity" type="number" data-testid="order-quantity-input" /></div>
        <button type="submit" data-testid="order-submit">Submit order</button>
      </form>`
    )
  );
});

app.post("/form", requireLogin, (req, res) => {
  const { productId, quantity } = req.body;
  res.redirect(`/success?productId=${encodeURIComponent(productId ?? "")}&quantity=${encodeURIComponent(quantity ?? "")}`);
});

app.get("/success", requireLogin, (req, res) => {
  res.send(
    page(
      "Order confirmed",
      `<p class="success" data-testid="success-message">Order placed for ${escapeHtml(String(req.query.quantity ?? ""))}x ${escapeHtml(
        String(req.query.productId ?? "")
      )}.</p>
      <p><a href="/search">Back to search</a></p>`
    )
  );
});

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

app.listen(PORT, () => {
  console.log(`[test-site] listening on http://localhost:${PORT}`);
});
