export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box}
    body{font-family:"Vazirmatn",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;min-height:100vh;margin:0;color:#e2e8f0;background:linear-gradient(140deg,#6d28d9,#2563eb);display:flex;flex-direction:column;align-items:center;padding:120px 24px 48px;line-height:1.8}
    a{color:inherit;text-decoration:none}
    nav.app-nav{position:sticky;top:24px;z-index:20;width:min(960px,calc(100% - 48px));display:flex;flex-wrap:wrap;justify-content:center;gap:12px;padding:12px 24px;background:rgba(15,23,42,.35);border:1px solid rgba(148,163,184,.35);border-radius:999px;backdrop-filter:blur(18px);box-shadow:0 20px 45px rgba(15,23,42,.35)}
    nav.app-nav a{color:#f8fafc;padding:8px 16px;border-radius:999px;font-weight:600;letter-spacing:.01em;transition:color .3s ease,background .3s ease,transform .3s ease,box-shadow .3s ease}
    nav.app-nav a:hover,nav.app-nav a:focus-visible{background:rgba(248,250,252,.8);color:#1e293b;transform:translateY(-2px);box-shadow:0 12px 20px rgba(15,23,42,.2)}
    .page-content{width:min(960px,100%);display:flex;flex-direction:column;gap:24px;margin-top:32px}
    .surface,.card{background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);border-radius:24px;padding:24px;box-shadow:0 24px 60px rgba(15,23,42,.25);backdrop-filter:blur(22px);color:#0f172a}
    .card + .card{margin-top:16px}
    .tabs a{margin-right:12px;color:inherit;border-bottom:2px solid transparent;padding-bottom:4px;font-weight:500;transition:border-color .3s ease,color .3s ease}
    .tabs a:hover,.tabs a:focus-visible,.tabs a[aria-current="page"]{border-color:rgba(99,102,241,.9);color:#312e81}
    .muted{color:rgba(15,23,42,.6)}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 20px;border-radius:999px;border:1px solid transparent;font-weight:600;font-size:0.95rem;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,background .3s ease,color .3s ease;text-decoration:none}
    .btn:hover,.btn:focus-visible{transform:translateY(-1px);box-shadow:0 14px 30px rgba(15,23,42,.25)}
    .btn-primary{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#f8fafc;box-shadow:0 18px 38px rgba(79,70,229,.35)}
    .btn-primary:hover,.btn-primary:focus-visible{background:linear-gradient(135deg,#4f46e5,#7c3aed)}
    .btn-outline{background:transparent;color:#1e293b;border-color:rgba(30,41,59,.4);backdrop-filter:blur(18px)}
    .btn-outline:hover,.btn-outline:focus-visible{background:rgba(148,163,184,.25)}
    .btn-ghost{background:transparent;color:#334155}
    .btn-ghost:hover,.btn-ghost:focus-visible{background:rgba(255,255,255,.25)}
    .link{color:#38bdf8;border-bottom:1px solid transparent;transition:border-color .3s ease,color .3s ease}
    .link:hover,.link:focus-visible{color:#0ea5e9;border-bottom-color:currentColor}
    .form-control{display:flex;flex-direction:column;gap:8px}
    .form-control label{font-weight:600;color:inherit}
    input,textarea,select{font-family:"Vazirmatn",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;border-radius:16px;border:1px solid rgba(148,163,184,.35);padding:12px 16px;background:rgba(255,255,255,.75);color:#0f172a;backdrop-filter:blur(12px);transition:border-color .3s ease,box-shadow .3s ease,background .3s ease}
    input:focus,textarea:focus,select:focus{outline:none;border-color:rgba(99,102,241,.9);box-shadow:0 0 0 3px rgba(99,102,241,.25);background:rgba(255,255,255,.95)}
    table{width:100%;border-collapse:collapse;overflow:hidden;border-radius:20px}
    th,td{padding:12px 16px;text-align:right}
    tbody tr:nth-child(even){background:rgba(255,255,255,.25)}
  </style>
</head>
<body>
  <nav class="app-nav">
    <a href="/">خانه</a>
    <a href="/admin">ادمین</a>
    <a href="/student">دانشجو</a>
    <a href="/management">مدیریت</a>
  </nav>
  <main class="page-content">
    ${body}
  </main>
</body>
</html>`;
}

export function html(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}
