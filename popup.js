const $ = (id) => document.getElementById(id);
const LEVELS = ['ブロンズ', 'シルバー', 'ゴールド', 'プラチナ', 'ダイヤモンド'];
const LEVEL_COLORS = ['#b0764a', '#9aa0a6', '#f9ab00', '#7b93b5', '#4fc3f7'];

let products = [];
let selected = null;
let showEmpty = false;

const levelIndex = (p) => LEVELS.indexOf(p.level);
const levelColor = (p) => LEVEL_COLORS[levelIndex(p)] ?? '#dadce0';

function medalSvg(color) {
  return `
    <svg viewBox="0 0 44 50" aria-hidden="true">
      <path d="M4 2h36l-9 20H13z" fill="#1a73e8"/>
      <path d="M13 2h18l-9 20z" fill="#4285f4"/>
      <circle cx="22" cy="33" r="14" fill="${color}"/>
      <circle cx="22" cy="33" r="14" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
      <path d="M22 25l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" fill="#fff"/>
    </svg>`;
}

function renderSummary() {
  const p = products.find((x) => x.product === selected) ?? products[0];
  if (!p) return;
  selected = p.product;
  const idx = levelIndex(p);

  $('product').value = p.product;
  const i = products.indexOf(p);
  $('prev').disabled = i <= 0;
  $('next').disabled = i >= products.length - 1;

  $('medal').innerHTML = medalSvg(levelColor(p));
  $('level').textContent = idx >= 0 ? p.level : '未達成';
  $('active').textContent = p.activePoints ?? '-';
  $('days').textContent = p.daysToCycle ?? '-';

  // 進捗バー（ブロンズ=0%、ダイヤモンド=100%）
  const pos = Math.max(idx, 0) * 25;
  $('fill').style.width = idx >= 0 ? pos + '%' : '0';
  $('fill').style.setProperty('--full', pos ? (100 / pos) * 100 + '%' : '100%');
  $('marker').style.left = pos + '%';
  $('marker').style.background = levelColor(p);
  $('track-labels').replaceChildren(
    ...LEVELS.map((name, n) => {
      const s = document.createElement('span');
      s.textContent = name;
      if (n === idx) s.className = 'current';
      else if (n < idx) s.className = 'done';
      return s;
    })
  );

  const toNext = $('to-next');
  if (idx < 0) {
    toNext.textContent = p.level;
  } else if (idx < LEVELS.length - 1) {
    toNext.innerHTML = `${LEVELS[idx + 1]}まで あと <b></b> ポイント`;
    toNext.querySelector('b').textContent = p.toNext ?? '-';
  } else {
    toNext.textContent = '最高レベルに到達しています';
  }

  $('warning').hidden = !p.warning;
  $('warning').querySelector('span').textContent = p.warning ?? '';

  $('breakdown').replaceChildren(
    ...(p.breakdown.length
      ? p.breakdown.map((b) => {
          const row = document.createElement('div');
          row.append(Object.assign(document.createElement('span'), { textContent: b.name }));
          row.append(Object.assign(document.createElement('b'), { textContent: b.points }));
          return row;
        })
      : [Object.assign(document.createElement('div'), { className: 'none', textContent: 'ポイントはまだありません' })])
  );

  for (const row of $('list').children) {
    row.classList.toggle('selected', row.dataset.product === selected);
  }
}

function renderList() {
  // 未達成かつ 0 pt の製品は初期状態で隠す
  const isEmpty = (p) => levelIndex(p) < 0 && Number(p.activePoints) === 0;
  const visible = showEmpty ? products : products.filter((p) => !isEmpty(p));
  const hiddenCount = products.length - visible.length;

  const rows = visible.map((p) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.product = p.product;
    row.innerHTML = '<span class="dot"></span><span class="name"></span><span class="lv"></span><span class="pts"></span>';
    row.querySelector('.dot').style.background = levelColor(p);
    row.querySelector('.name').textContent = p.product;
    row.querySelector('.lv').textContent = levelIndex(p) >= 0 ? p.level : '未達成';
    row.querySelector('.pts').textContent = `${p.activePoints ?? '-'} pt`;
    row.addEventListener('click', () => select(p.product));
    return row;
  });
  $('list').replaceChildren(...rows);

  if (hiddenCount || showEmpty) {
    const more = document.createElement('button');
    more.className = 'more';
    more.textContent = showEmpty ? '0 pt の製品を隠す' : `ほか ${hiddenCount} 製品（0 pt）を表示`;
    more.addEventListener('click', () => {
      showEmpty = !showEmpty;
      renderList();
      renderSummary();
    });
    $('list').append(more);
  }
}

function select(product) {
  selected = product;
  chrome.storage.local.set({ selected });
  renderSummary();
}

function render({ data, status, selected: saved }) {
  const running = !!status?.running;
  $('refresh').disabled = running;
  $('refresh').classList.toggle('spin', running);
  $('status').className = status?.error ? 'error' : '';
  $('status').textContent = running && !data
    ? '取得中…'
    : status?.error || (data ? '' : '更新ボタンを押すと達成状況を取得します。');

  if (!data) return;
  $('content').hidden = false;
  $('all').hidden = false;
  $('updated').textContent = '最終更新: ' + new Date(data.fetchedAt).toLocaleString('ja-JP');

  // レベルの高い順、同じならポイントの多い順
  products = [...data.products].sort(
    (a, b) => levelIndex(b) - levelIndex(a) || Number(b.activePoints) - Number(a.activePoints)
  );
  selected ??= saved;

  $('product').replaceChildren(
    ...products.map((p) => Object.assign(document.createElement('option'), { value: p.product, textContent: p.product }))
  );
  renderList();
  renderSummary();
}

async function load() {
  render(await chrome.storage.local.get(['data', 'status', 'selected']));
}

$('refresh').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'refresh' }));
$('product').addEventListener('change', (e) => select(e.target.value));
$('prev').addEventListener('click', () => select(products[products.findIndex((p) => p.product === selected) - 1].product));
$('next').addEventListener('click', () => select(products[products.findIndex((p) => p.product === selected) + 1].product));
chrome.storage.onChanged.addListener((changes) => {
  if (changes.data || changes.status) load();
});

load().then(async () => {
  // データが無いか1時間以上古ければ自動で更新
  const { data, status } = await chrome.storage.local.get(['data', 'status']);
  if (!status?.running && (!data || Date.now() - data.fetchedAt > 3600000)) {
    chrome.runtime.sendMessage({ type: 'refresh' });
  }
});
