export type LoginLocale = "en" | "zh-CN";

const STRINGS = {
  en: {
    title: "Roamgate login",
    heading: "Welcome back",
    intro: "Log in to access your workspaces.",
    passwordLabel: "Password or token",
    showPassword: "Show password",
    hidePassword: "Hide password",
    show: "Show",
    hide: "Hide",
    logIn: "Log in",
    loggingIn: "Logging in...",
    note: "Use the password or token configured on your server.",
    noscript: "Enable JavaScript to log in to Roamgate.",
    footer: "Your workspace, wherever you are.",
    wrongPassword: "Wrong password or token. Try again.",
    loginFailed: "Unable to log in. Please try again.",
    unreachable:
      "Cannot reach the server. Check your connection and try again.",
  },
  "zh-CN": {
    title: "登录 Roamgate",
    heading: "欢迎回来",
    intro: "登录以访问你的工作区。",
    passwordLabel: "密码或令牌",
    showPassword: "显示密码",
    hidePassword: "隐藏密码",
    show: "显示",
    hide: "隐藏",
    logIn: "登录",
    loggingIn: "正在登录…",
    note: "请使用服务器上配置的密码或令牌。",
    noscript: "请启用 JavaScript 以登录 Roamgate。",
    footer: "你的工作区，随你而行。",
    wrongPassword: "密码或令牌错误，请重试。",
    loginFailed: "无法登录，请重试。",
    unreachable: "无法连接到服务器。请检查网络连接后重试。",
  },
} satisfies Record<LoginLocale, Record<string, string>>;

/** Chinese when the highest-weighted Accept-Language entry is any zh variant. */
export function loginLocale(
  acceptLanguage: string | null | undefined,
): LoginLocale {
  let best: { tag: string; q: number } | null = null;
  for (const entry of (acceptLanguage ?? "").split(",")) {
    const [rawTag, ...params] = entry.trim().split(";");
    const tag = rawTag?.trim() ?? "";
    if (!tag || tag === "*") continue;
    const qParam = params.find((param) => /^\s*q\s*=/i.test(param));
    const q = qParam ? Number(qParam.split("=")[1]) : 1;
    if (!Number.isFinite(q) || q <= 0) continue;
    if (!best || q > best.q) best = { tag, q };
  }
  return best && /^zh\b/i.test(best.tag) ? "zh-CN" : "en";
}

/** A JSON string literal that is safe inside an inline script. */
function scriptString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderLoginHtml(locale: LoginLocale = "en"): string {
  const s = STRINGS[locale];
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>${s.title}</title>
<link rel="icon" type="image/svg+xml" href="/roamgate-icon.svg">
<link rel="icon" type="image/png" href="/roamgate-icon-192.png">
<style>
  *{box-sizing:border-box}
  :root{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#eeeef0;
    background:#141516;color-scheme:dark;--panel:#1c1d1f;--border:#383a3d;--muted:#a9abb0;
    --input:#141516;--accent:#a8c5ff;--error:#ffaaaa}
  body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;
    padding:32px 20px;background:radial-gradient(ellipse at 50% 0%,#a8c5ff0d,transparent 65%)}
  main{width:100%;max-width:400px}
  .brand{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:28px;
    font-size:24px;font-weight:650;letter-spacing:-.7px}
  .brand img{width:48px;height:48px}
  .card{padding:32px;border:1px solid var(--border);border-radius:20px;background:var(--panel);
    box-shadow:0 16px 48px #00000014}
  h1{margin:0 0 8px;font-size:24px;font-weight:650;letter-spacing:-.6px}
  p{margin:0;color:var(--muted);font-size:14px;line-height:1.6}
  form{margin-top:28px}
  label{display:block;margin-bottom:8px;font-size:13px;font-weight:600}
  .password{position:relative}
  input{width:100%;min-height:48px;padding:12px 64px 12px 14px;border-radius:10px;
    border:1px solid var(--border);background:var(--input);color:inherit;font:inherit;font-size:16px}
  input::placeholder{color:var(--muted);opacity:.8}
  button{font:inherit;cursor:pointer}
  :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
  input:focus-visible{outline-offset:1px}
  .reveal{position:absolute;right:4px;top:4px;min-width:52px;min-height:40px;padding:0 8px;
    border:0;border-radius:7px;background:transparent;color:var(--muted);font-size:12px;font-weight:600}
  .reveal:hover{color:var(--accent)}
  .submit{width:100%;min-height:48px;padding:12px;margin-top:4px;border:1px solid transparent;
    border-radius:10px;background:#ececee;color:#202124;font-size:14px;font-weight:650}
  .submit:hover:not(:disabled){background:#fff}
  .submit:disabled{opacity:.65;cursor:wait}
  .err{color:var(--error);font-size:13px;line-height:1.5;min-height:24px;margin:10px 0 6px}
  .note{margin-top:24px;text-align:center;font-size:12px}
  footer{margin-top:24px;text-align:center;color:var(--muted);font-size:12px;line-height:1.6}
  @media(prefers-color-scheme:light){
    :root{background:#f5f5f3;color:#252629;color-scheme:light;--panel:#fff;--border:#dcdde0;
      --muted:#64666d;--input:#fafafa;--accent:#315fb4;--error:#b42332}
    .submit{background:#292a2c;color:#fff}.submit:hover:not(:disabled){background:#414245}
  }
  @media(max-width:380px){.card{padding:24px}body{padding:24px 16px}}
</style>
</head>
<body>
<main>
  <div class="brand"><img src="/roamgate-icon-192.png" alt="" width="48" height="48"><span>Roamgate</span></div>
  <section class="card" aria-labelledby="heading">
    <h1 id="heading">${s.heading}</h1>
    <p>${s.intro}</p>
    <form id="login">
      <label for="pw">${s.passwordLabel}</label>
      <div class="password">
        <input id="pw" name="password" type="password" placeholder="${s.passwordLabel}"
          autocomplete="current-password" autocapitalize="none" spellcheck="false" required autofocus aria-describedby="err">
        <button class="reveal" id="reveal" type="button" aria-label="${s.showPassword}" aria-controls="pw" aria-pressed="false">${s.show}</button>
      </div>
      <div class="err" id="err" role="alert" aria-live="polite"></div>
      <button class="submit" id="btn" type="submit">${s.logIn}</button>
    </form>
    <p class="note">${s.note}</p>
    <noscript><p class="err">${s.noscript}</p></noscript>
  </section>
  <footer>${s.footer}</footer>
</main>
<script>
  const form=document.getElementById('login'),pw=document.getElementById('pw'),btn=document.getElementById('btn'),err=document.getElementById('err'),reveal=document.getElementById('reveal');
  reveal.onclick=()=>{
    const show=pw.type==='password';
    pw.type=show?'text':'password';
    reveal.textContent=show?${scriptString(s.hide)}:${scriptString(s.show)};
    reveal.setAttribute('aria-label',show?${scriptString(s.hidePassword)}:${scriptString(s.showPassword)});
    reveal.setAttribute('aria-pressed',String(show));
  };
  form.onsubmit=async event=>{
    event.preventDefault();
    if(btn.disabled)return;
    err.textContent='';
    pw.removeAttribute('aria-invalid');
    btn.disabled=true;btn.textContent=${scriptString(s.loggingIn)};
    try{
      const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw.value})});
      if(r.ok){location.replace('/'+location.hash);return;}
      if(r.status===401){
        err.textContent=${scriptString(s.wrongPassword)};
        pw.setAttribute('aria-invalid','true');pw.value='';pw.focus();
      }else{err.textContent=${scriptString(s.loginFailed)};}
    }catch{err.textContent=${scriptString(s.unreachable)};}
    finally{btn.disabled=false;btn.textContent=${scriptString(s.logIn)};}
  };
</script>
</body>
</html>`;
}
