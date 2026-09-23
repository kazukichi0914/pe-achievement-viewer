const PROFILE_URL = 'https://productexperts.withgoogle.com/profile';

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'refresh') refresh();
});

async function refresh() {
  const { status } = await chrome.storage.local.get('status');
  if (status?.running && Date.now() - status.startedAt < 120000) return;
  await chrome.storage.local.set({ status: { running: true, startedAt: Date.now() } });

  let tab;
  try {
    tab = await chrome.tabs.create({ url: PROFILE_URL, active: false });
    await waitForTabComplete(tab.id);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeAllProducts,
    });
    if (result.error) throw new Error(result.error);
    await chrome.storage.local.set({
      data: { products: result.products, fetchedAt: Date.now() },
      status: { running: false },
    });
  } catch (e) {
    await chrome.storage.local.set({ status: { running: false, error: String(e.message || e) } });
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('ページの読み込みがタイムアウトしました'));
    }, 30000);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ページ内で実行される（外部の変数は参照できない）
async function scrapeAllProducts() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const getCard = () =>
    [...document.querySelectorAll('div.card')].find(
      (c) => c.querySelector('.title')?.textContent.trim() === '達成状況'
    );

  const read = () => {
    const card = getCard();
    const stats = [...card.querySelectorAll('.stats-card:not(.medal-card)')].map((s) => ({
      value: clean(s.querySelector('.points')?.innerText),
      label: clean(s.querySelector('.points-description')?.innerText),
    }));
    const find = (re) => stats.find((s) => re.test(s.label))?.value ?? null;
    const warning = [...card.querySelectorAll('*')]
      .filter((e) => /無効になります/.test(e.textContent))
      .pop();
    const breakdown = [...card.querySelectorAll('.breakdown-type')]
      .map((b) => ({
        name: clean(b.querySelector('.sourceName')?.innerText),
        points: Number(clean(b.querySelector('.numPoints')?.innerText)) || 0,
      }))
      .filter((b) => b.points > 0);
    return {
      product: clean(card.querySelector('.mat-mdc-select-value-text')?.innerText),
      level: clean(card.querySelector('.medal-card')?.innerText),
      activePoints: find(/アクティブ/),
      toNext: find(/になるため/),
      daysToCycle: find(/サイクル/),
      warning: warning ? clean(warning.textContent) : null,
      breakdown,
    };
  };

  // 達成状況カードの表示を待つ（非表示タブではタイマーが間引かれるので回数で上限を決める）
  const ready = () => getCard()?.querySelector('.medal-card') && read().product;
  for (let i = 0; i < 60 && !ready(); i++) await sleep(500);
  if (!ready()) {
    return { error: '達成状況が見つかりません。productexperts.withgoogle.com にログインしているか確認してください。' };
  }

  // 全製品のデータは読み込み済みで、切り替えると表示は同期的に更新される
  const button = (dir) =>
    getCard().querySelector(`button[aria-label="プルダウン メニューの${dir}の製品が選択されます"]`);
  for (let i = 0; i < 50 && button('前') && !button('前').disabled; i++) {
    button('前').click();
    await Promise.resolve();
  }

  const products = [read()];
  const seen = new Set([products[0].product]);
  for (let i = 0; i < 50 && button('次') && !button('次').disabled; i++) {
    button('次').click();
    await Promise.resolve();
    const r = read();
    if (seen.has(r.product)) break;
    seen.add(r.product);
    products.push(r);
  }
  return { products };
}
