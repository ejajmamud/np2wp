export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NewPages → WordPress</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui;color:#17202a;background:#f4f7fb}
    *{box-sizing:border-box}body{margin:0}.shell{max-width:1180px;margin:auto;padding:28px}
    header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
    h1{margin:0;font-size:28px}.tag{background:#111827;color:white;padding:7px 11px;border-radius:999px;font-size:12px}
    .grid{display:grid;grid-template-columns:360px 1fr;gap:22px}.card{background:white;border:1px solid #dce4ee;border-radius:16px;padding:20px;box-shadow:0 8px 30px #17202a0a}
    label{display:block;font-size:12px;font-weight:700;margin:13px 0 6px}input,select{width:100%;padding:10px 12px;border:1px solid #c9d5e2;border-radius:9px}
    button{margin-top:16px;border:0;border-radius:9px;padding:11px 15px;background:#e11d48;color:white;font-weight:750;cursor:pointer}
    table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px;border-bottom:1px solid #edf1f5;font-size:13px}
    .status{font-weight:700}.muted{color:#637083}.error{color:#b91c1c;max-width:280px}.empty{padding:50px;text-align:center;color:#637083}
    @media(max-width:850px){.grid{grid-template-columns:1fr}.shell{padding:16px}}
  </style>
</head>
<body><div class="shell">
  <header><div><h1>NewPages → WordPress</h1><div class="muted">Migration control plane</div></div><span class="tag">MVP</span></header>
  <div class="grid">
    <form class="card" id="create">
      <h2>New migration</h2>
      <label>Name</label><input name="name" required placeholder="Client website">
      <label>Public website</label><input name="publicUrl" type="url" required placeholder="https://example.com">
      <label>Newpages login URL</label><input name="cmsLoginUrl" type="url" placeholder="https://www.newpages.com.my/v2/en/login.html">
      <label>Newpages username</label><input name="username">
      <label>Newpages password</label><input name="password" type="password">
      <label>WordPress URL (optional)</label><input name="wordpressUrl" type="url" placeholder="https://staging.example.com">
      <label>Receiver token (optional)</label><input name="receiverToken" type="password">
      <button>Create migration</button>
      <div id="form-message" class="muted"></div>
    </form>
    <section class="card"><h2>Migrations</h2><div id="list" class="empty">Loading…</div></section>
  </div>
</div>
<script>
const token=localStorage.np2wpToken||prompt('API token','local-development-token')||'';
localStorage.np2wpToken=token;
const headers={'content-type':'application/json','authorization':'Bearer '+token,'x-tenant-id':'default'};
async function load(){
 const r=await fetch('/api/migrations',{headers});const items=await r.json();
 const el=document.querySelector('#list');
 if(!items.length){el.className='empty';el.textContent='No migrations yet.';return}
 el.className='';el.innerHTML='<table><thead><tr><th>Name</th><th>Source</th><th>Status</th><th>Step</th><th></th></tr></thead><tbody>'+
 items.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.source.publicUrl)+'</td><td class="status">'+x.status+'</td><td>'+esc(x.currentStep||'—')+'</td><td><button onclick="start(\\''+x.id+'\\')">Run</button></td></tr><tr><td colspan="5" class="error">'+esc(x.error||'')+'</td></tr>').join('')+'</tbody></table>';
}
async function start(id){await fetch('/api/migrations/'+id+'/start',{method:'POST',headers});load()}
document.querySelector('#create').addEventListener('submit',async e=>{
 e.preventDefault();const f=new FormData(e.currentTarget);const body={
  name:f.get('name'),source:{publicUrl:f.get('publicUrl'),cmsLoginUrl:f.get('cmsLoginUrl')||undefined,username:f.get('username')||undefined,password:f.get('password')||undefined,mode:f.get('username')?'authenticated':'public'},
  destination:f.get('wordpressUrl')?{baseUrl:f.get('wordpressUrl'),receiverToken:f.get('receiverToken')||undefined,publishMode:'draft'}:undefined
 };
 const r=await fetch('/api/migrations',{method:'POST',headers,body:JSON.stringify(body)});
 document.querySelector('#form-message').textContent=r.ok?'Migration created.':await r.text();
 if(r.ok){e.currentTarget.reset();load()}
});
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
load();setInterval(load,5000);
</script></body></html>`;
