const state = {
  screen: 'create', step: 1, name: 'شومیز لینن تابستانه', category: 'پوشاک زنانه', price: '۱٬۲۸۰٬۰۰۰',
  stocks: [
    { name: 'کرم · ۳۶', count: 4 }, { name: 'کرم · ۳۸', count: 2 },
    { name: 'زرشکی · ۳۶', count: 0 }, { name: 'زرشکی · ۳۸', count: 6 }
  ]
};

const variants = {
  A: { name: 'تمرکز آرام', render: renderA },
  B: { name: 'گفت‌وگوی کوتاه', render: renderB },
  C: { name: 'پیش‌نمایش زنده', render: renderC }
};

const app = document.querySelector('#app');
let current = readVariant();

function readVariant() {
  const key = new URLSearchParams(location.search).get('variant')?.toUpperCase();
  return variants[key] ? key : 'A';
}

function icon(name) {
  const paths = {
    home:'<path d="M3 10.5 10 4l7 6.5v6a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z"/>',
    plus:'<path d="M10 4v12M4 10h12"/>',
    box:'<path d="m4 7 6-3 6 3-6 3zM4 7v7l6 3 6-3V7M10 10v7"/>',
    orders:'<path d="M5 3h10v14H5zM8 7h4M8 10h4M8 13h3"/>',
    store:'<path d="M4 8h12l-1-4H5zM5 8v8h10V8M8 16v-4h4v4"/>',
    arrow:'<path d="m7 4 6 6-6 6"/>',
    back:'<path d="m13 4-6 6 6 6"/>',
    check:'<path d="m4 10 4 4 8-9"/>',
    image:'<rect x="3" y="4" width="14" height="12" rx="2"/><path d="m5 14 4-4 3 3 2-2 3 3M7 8h.01"/>',
    bell:'<path d="M5 8a5 5 0 0 1 10 0c0 6 2 6 2 6H3s2 0 2-6M8 17h4"/>'
  };
  return `<svg viewBox="0 0 20 20" aria-hidden="true">${paths[name]}</svg>`;
}

function header() {
  return `<header class="bar"><div class="identity"><span class="mark">س</span><span>فروشگاه ماه‌رخ</span></div><div class="bar-actions">${state.screen !== 'home' ? `<button class="icon-button" data-nav="home" aria-label="خانه">${icon('home')}</button>` : ''}<button class="icon-button" aria-label="اعلان‌ها" data-toast="اعلانی ندارید">${icon('bell')}</button><span class="avatar">م</span></div></header>`;
}

function progress() {
  return `<div class="progress-line" aria-label="قدم ${state.step} از ۴">${[1,2,3,4].map(i=>`<i class="${i<state.step?'done':i===state.step?'active':''}"></i>`).join('')}</div>`;
}

function productStep(kind) {
  const number = kind === 'B' ? `<span class="b-number">${state.step}</span>` : `<p class="a-kicker">قدم ${state.step} از ۴</p>`;
  if (state.step === 1) return `${number}<h1>این کالا چه نام دارد؟</h1><p class="muted">همان نام کوتاهی که خریدار می‌بیند.</p><div class="field"><label>نام کالا</label><input data-model="name" value="${state.name}" autocomplete="off"></div>`;
  if (state.step === 2) return `${number}<h1>کالا در کدام دسته است؟</h1><p class="muted">با انتخاب دسته، فقط ویژگی‌های لازم نمایش داده می‌شوند.</p><div class="choice-list"><button class="choice ${state.category==='پوشاک زنانه'?'selected':''}" data-category="پوشاک زنانه"><span><strong>پوشاک زنانه</strong><small>رنگ و اندازه</small></span>${icon('arrow')}</button><button class="choice ${state.category==='اکسسوری'?'selected':''}" data-category="اکسسوری"><span><strong>اکسسوری</strong><small>رنگ و جنس</small></span>${icon('arrow')}</button><button class="choice ${state.category==='زیبایی'?'selected':''}" data-category="زیبایی"><span><strong>آرایشی و بهداشتی</strong><small>حجم و رنگ</small></span>${icon('arrow')}</button></div>`;
  if (state.step === 3) return `${number}<h1>یک تصویر روشن اضافه کنید</h1><p class="muted">تصویرهای بیشتر را بعداً می‌توانید اضافه کنید.</p><button class="upload" data-toast="انتخاب تصویر در نمونه شبیه‌سازی شد"><span class="mini-icon">${icon('image')}</span><span>انتخاب تصویر</span></button>`;
  return `${number}<h1>قیمت و موجودی اولیه</h1><p class="muted">گونه‌های بیشتر بعد از ساخت کالا اضافه می‌شوند.</p><div class="field-row"><div class="field"><label>قیمت (تومان)</label><input data-model="price" value="${state.price}" inputmode="numeric"></div><div class="field"><label>موجودی</label><input value="۱۲" inputmode="numeric"></div></div><div class="divider"></div><span class="pill"><span class="status-dot"></span> آمادهٔ نمایش در فروشگاه</span>`;
}

function flowActions() {
  return `<div class="actions"><button class="button secondary" data-prev ${state.step===1?'disabled':''}>قبلی</button><button class="button" data-next>${state.step===4?'ساخت کالا':'ادامه'}</button></div>`;
}

function homeTasks(layout='quick') {
  const items = [
    ['create','plus','کالای تازه','چهار قدم کوتاه'],
    ['orders','orders','سفارش‌ها','دو سفارش باز'],
    ['inventory','box','موجودی','یک گونه ناموجود']
  ];
  if (layout === 'quick') return `<div class="quick-tasks">${items.map(x=>`<button class="quick-task" data-nav="${x[0]}"><span class="mini-icon">${icon(x[1])}</span><strong>${x[2]}</strong><div class="tiny muted">${x[3]}</div></button>`).join('')}</div>`;
  return `<div class="c-home-list">${items.map(x=>`<button class="c-home-card" data-nav="${x[0]}"><span class="mini-icon">${icon(x[1])}</span><strong>${x[2]}</strong><p class="tiny muted">${x[3]}</p></button>`).join('')}</div>`;
}

function compactScreen() {
  if (state.screen === 'inventory') return `<p class="a-kicker">موجودی</p><h1>کدام گونه تغییر کرده؟</h1><p class="muted">تعداد قابل فروش را مستقیم اصلاح کنید.</p><div class="task-list">${state.stocks.map((s,i)=>`<div class="task-row"><span class="mini-icon">${icon('box')}</span><span><strong>${s.name}</strong><br><small>${state.name}</small></span><input class="field stock-edit" data-stock="${i}" value="${s.count}" inputmode="numeric"></div>`).join('')}</div><div class="actions"><button class="button secondary" data-nav="home">بستن</button><button class="button" data-toast="موجودی به‌روز شد">ذخیره</button></div>`;
  if (state.screen === 'orders') return `<p class="a-kicker">سفارش‌ها</p><h1>دو سفارش منتظر شماست</h1><p class="muted">هر سفارش مسیر جدا و روشن دارد.</p><div class="task-list"><button class="task-row" data-nav="order"><span class="mini-icon">${icon('orders')}</span><span><strong>سفارش ۱۰۴۲</strong><br><small>۲ کالا · پست پیشتاز</small></span><span class="order-status">آماده‌سازی</span></button><button class="task-row" data-nav="order"><span class="mini-icon">${icon('orders')}</span><span><strong>سفارش ۱۰۴۰</strong><br><small>۱ کالا · ارسال شده</small></span><span class="order-status">ثبت رهگیری</span></button></div>`;
  if (state.screen === 'order') return `<p class="a-kicker">سفارش ۱۰۴۲</p><h1>بسته را آماده کنید</h1><p class="muted">پس از تحویل به پست، کد رهگیری را در قدم بعد وارد می‌کنید.</p><div class="task-row"><span class="mini-icon">${icon('box')}</span><span><strong>${state.name}</strong><br><small>کرم · اندازه ۳۶ · یک عدد</small></span></div><div class="actions"><button class="button secondary" data-nav="orders">بازگشت</button><button class="button" data-toast="سفارش آماده شد">آماده شد</button></div>`;
}

function renderA() {
  if (state.screen === 'home') return `<main class="app">${header()}<section class="a-wrap a-home page-enter"><div class="soft-panel"><div class="success-mark">${icon('check')}</div><h1>فروشگاه آماده است</h1><p class="muted">هر بار فقط کاری را باز کنید که می‌خواهید انجام دهید.</p>${homeTasks()}</div></section></main>`;
  const content = state.screen === 'create' ? `${productStep('A')}${flowActions()}` : compactScreen();
  return `<main class="app">${header()}<section class="a-wrap page-enter"><div class="a-head"><div><span class="tiny muted">${state.screen==='create'?'ساخت کالای تازه':'فروشگاه من'}</span></div>${state.screen==='create'?progress():''}</div><div class="a-step"><div class="soft-panel a-step-card"><div class="step-content">${content}</div></div></div></section></main>`;
}

function renderB() {
  if (state.screen === 'home') return `<main class="app">${header()}<section class="b-wrap page-enter"><div class="b-home"><div class="orb">${icon('store')}</div><h1>چه کاری می‌خواهید انجام دهید؟</h1><p class="muted">فقط یکی را انتخاب کنید.</p><div class="b-home-actions"><button class="button" data-nav="create">کالای تازه</button><button class="button secondary" data-nav="orders">سفارش‌ها</button><button class="button secondary" data-nav="inventory">موجودی</button></div></div></section></main>`;
  const rail = state.screen === 'create' ? ['نام کالا','دسته','تصویر','قیمت'].map((x,i)=>`<button class="${i+1===state.step?'active':''}" data-step="${i+1}">${i+1}. ${x}</button>`).join('') : `<button class="active">${state.screen==='inventory'?'اصلاح موجودی':'رسیدگی به سفارش'}</button>`;
  const content = state.screen === 'create' ? `${productStep('B')}${flowActions()}` : compactScreen();
  return `<main class="app">${header()}<section class="b-wrap page-enter"><div class="b-stage"><nav class="b-rail">${rail}</nav><div class="soft-panel b-question"><div class="step-content">${content}</div></div></div></section></main>`;
}

function preview() {
  return `<aside class="preview-frame"><div class="phone"><div class="phone-top"></div><div class="product-image"><div class="cloth"></div></div><div class="phone-copy"><h3 data-preview-name>${state.name}</h3><p>${state.category}</p><span class="price" data-preview-price>${state.price} تومان</span><div class="swatches"><i></i><i></i><i></i></div></div></div></aside>`;
}

function renderC() {
  if (state.screen === 'home') return `<main class="app">${header()}<section class="c-wrap c-home page-enter"><div class="c-home-title"><span class="pill">فروشگاه فعال</span><h1 style="margin-top:12px">فروشگاه ماه‌رخ</h1><p class="muted">هر بخش، یک کار مشخص.</p></div>${homeTasks('cards')}</section></main>`;
  const content = state.screen === 'create' ? `${productStep('A')}${flowActions()}` : compactScreen();
  return `<main class="app">${header()}<section class="c-wrap page-enter"><div class="c-grid"><div class="soft-panel c-editor"><div class="a-head"><span class="tiny muted">${state.screen==='create'?'ساخت کالا':'فروشگاه من'}</span>${state.screen==='create'?progress():''}</div><div class="step-content">${content}</div></div>${preview()}</div></section></main>`;
}

function switcher() {
  return `<div class="prototype-label">نمونهٔ دورریختنی</div><div class="state-line">${state.screen==='create'?`ساخت کالا · قدم ${state.step}`:state.screen}</div><div class="switcher" role="group" aria-label="تعویض نمونه"><button data-cycle="-1" aria-label="نمونه قبلی">←</button><span>${current} — ${variants[current].name}</span><button data-cycle="1" aria-label="نمونه بعدی">→</button></div>`;
}

function render() {
  app.innerHTML = `${variants[current].render()}${switcher()}`;
  bind();
}

function navigate(screen) { state.screen=screen; if(screen==='create') state.step=1; render(); }
function setVariant(key) { current=key; const url=new URL(location.href); url.searchParams.set('variant',key); history.replaceState({},'',url); render(); }
function cycle(direction) { const keys=Object.keys(variants); setVariant(keys[(keys.indexOf(current)+direction+keys.length)%keys.length]); }
function toast(message) { document.querySelector('.toast')?.remove(); const el=document.createElement('div'); el.className='toast'; el.textContent=message; document.body.appendChild(el); setTimeout(()=>el.remove(),2300); }

function bind() {
  document.querySelectorAll('[data-cycle]').forEach(el=>el.addEventListener('click',()=>cycle(Number(el.dataset.cycle))));
  document.querySelectorAll('[data-nav]').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.nav)));
  document.querySelectorAll('[data-step]').forEach(el=>el.addEventListener('click',()=>{state.step=Number(el.dataset.step);render()}));
  document.querySelectorAll('[data-next]').forEach(el=>el.addEventListener('click',()=>{if(state.step<4){state.step++;render()}else{state.screen='home';render();toast('کالا ساخته شد')}}));
  document.querySelectorAll('[data-prev]').forEach(el=>el.addEventListener('click',()=>{if(state.step>1){state.step--;render()}}));
  document.querySelectorAll('[data-category]').forEach(el=>el.addEventListener('click',()=>{state.category=el.dataset.category;render()}));
  document.querySelectorAll('[data-toast]').forEach(el=>el.addEventListener('click',()=>toast(el.dataset.toast)));
  document.querySelectorAll('[data-model]').forEach(el=>el.addEventListener('input',()=>{state[el.dataset.model]=el.value; const target=document.querySelector(el.dataset.model==='name'?'[data-preview-name]':'[data-preview-price]'); if(target)target.textContent=el.dataset.model==='price'?`${el.value} تومان`:el.value}));
  document.querySelectorAll('[data-stock]').forEach(el=>el.addEventListener('input',()=>{state.stocks[Number(el.dataset.stock)].count=Number(el.value)||0}));
}

addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)||event.target.isContentEditable)return;if(event.key==='ArrowLeft')cycle(-1);if(event.key==='ArrowRight')cycle(1)});
addEventListener('popstate',()=>{current=readVariant();render()});
render();
