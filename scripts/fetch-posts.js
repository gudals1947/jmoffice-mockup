#!/usr/bin/env node
/**
 * Naver 블로그 posts → posts.json 동기화
 * GitHub Actions에서 매일 1회 실행. 친구분이 블로그에 글만 올리면 사이트가 자동 반영됨.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BLOG_ID = 'jmoffice051';
const ITEM_COUNT = 24;
const API_URL = `https://m.blog.naver.com/api/blogs/${BLOG_ID}/post-list?categoryNo=0&itemCount=${ITEM_COUNT}&page=1&userId=`;
const OUTPUT_PATH = path.join(__dirname, '..', 'posts.json');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
          Referer: `https://m.blog.naver.com/${BLOG_ID}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timeout'));
    });
  });
}

(async () => {
  console.log(`Fetching posts from: ${API_URL}`);
  const raw = await fetchUrl(API_URL);
  const json = JSON.parse(raw);

  if (!json.isSuccess) {
    throw new Error(`API returned failure: ${JSON.stringify(json).slice(0, 200)}`);
  }

  const items = (json.result.items || []).map((p) => ({
    logNo: p.logNo,
    title: p.titleWithInspectMessage || '',
    brief: (p.briefContents || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    category: p.categoryName || '',
    thumbnail: p.thumbnailUrl || '',
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
  console.log(`Synced ${items.length} posts → ${OUTPUT_PATH}`);
})().catch((err) => {
  console.error('Failed to sync posts:', err.message);
  process.exit(1);
});
