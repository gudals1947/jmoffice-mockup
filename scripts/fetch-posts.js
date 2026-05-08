#!/usr/bin/env node
/**
 * Naver 블로그 → posts.json 동기화
 *
 * 동작:
 * 1. category-list API에서 전체 카테고리 구조 받아옴
 * 2. 최상위(parentCategoryNo=null) Q타입 카테고리만 추려서 각각 post-list API 호출
 *    (부모 카테고리는 자식 카테고리 글까지 포함해서 반환됨 — 검증됨)
 * 3. logNo 기준 dedup, 날짜 내림차순 정렬
 * 4. posts.json 저장
 *
 * 친구분이 블로그에만 글 올리면 GitHub Actions가 매일 이 스크립트 돌려서 자동 동기화.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BLOG_ID = 'jmoffice051';
const PER_CATEGORY_MAX = 30;
const OUTPUT_PATH = path.join(__dirname, '..', 'posts.json');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  Referer: `https://m.blog.naver.com/${BLOG_ID}`,
  Accept: 'application/json',
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timeout')));
  });
}

async function fetchJson(url) {
  const raw = await fetchUrl(url);
  const json = JSON.parse(raw);
  if (!json.isSuccess) throw new Error(`API failure: ${url}`);
  return json.result;
}

// Naver CDN blocks raw thumbnail URLs (404). Adding ?type=ffn300_300 makes them
// publicly accessible.
function withResize(url) {
  if (!url) return '';
  return url.includes('?') ? url : `${url}?type=ffn300_300`;
}

(async () => {
  console.log(`Fetching category list for ${BLOG_ID}...`);
  const catResult = await fetchJson(
    `https://m.blog.naver.com/api/blogs/${BLOG_ID}/category-list`
  );

  const topLevel = (catResult.mylogCategoryList || []).filter(
    (c) => c.categoryType === 'Q' && c.parentCategoryNo == null && c.postCnt > 0
  );

  console.log(
    `Top-level categories with posts: ${topLevel
      .map((c) => `${c.categoryName}(${c.postCnt})`)
      .join(', ')}`
  );

  // Fetch posts for each top-level category in parallel
  const fetched = await Promise.all(
    topLevel.map(async (cat) => {
      const itemCount = Math.min(PER_CATEGORY_MAX, cat.postCnt);
      const url = `https://m.blog.naver.com/api/blogs/${BLOG_ID}/post-list?categoryNo=${cat.categoryNo}&itemCount=${itemCount}&page=1&userId=`;
      const result = await fetchJson(url);
      const items = result.items || [];
      console.log(`  [${cat.categoryName}] fetched ${items.length}`);
      return items.map((p) => ({ ...p, _topCategory: cat.categoryName }));
    })
  );

  // Flatten and dedup by logNo
  const seen = new Set();
  const merged = [];
  for (const arr of fetched) {
    for (const p of arr) {
      if (seen.has(p.logNo)) continue;
      seen.add(p.logNo);
      merged.push(p);
    }
  }

  // Sort by date descending
  merged.sort((a, b) => (b.addDate || 0) - (a.addDate || 0));

  const items = merged.map((p) => ({
    logNo: p.logNo,
    title: p.titleWithInspectMessage || '',
    brief: (p.briefContents || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    category: p._topCategory || p.categoryName || '',
    subCategory: p.categoryName || '',
    thumbnail: withResize(p.thumbnailUrl),
    date: p.addDate || null,
    url: `https://blog.naver.com/${BLOG_ID}/${p.logNo}`,
    sympathyCnt: p.sympathyCnt || 0,
  }));

  const output = {
    syncedAt: new Date().toISOString(),
    blogId: BLOG_ID,
    count: items.length,
    posts: items,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nSynced ${items.length} posts → ${OUTPUT_PATH}`);
})().catch((err) => {
  console.error('Failed to sync posts:', err.message);
  process.exit(1);
});
