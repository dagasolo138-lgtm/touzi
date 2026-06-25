import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { parseHistoryRows } from '../index.js';

function response(body, init = {}) {
  return new Response(body, { status: 200, ...init });
}

function f10Body(date = '2026-06-24', nav = '1.4617', accNav = '1.4617') {
  return `var apidata={ content:"<table><thead><tr><th>净值日期</th><th>单位净值</th><th>累计净值</th></tr></thead><tbody><tr><td>${date}</td><td>${nav}</td><td>${accNav}</td><td></td></tr></tbody></table>",records:1,pages:1,curpage:1};`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloudflare worker nav proxy', () => {
  it('uses fundgz realtime NAV when the realtime endpoint has data', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      expect(String(url)).toContain('fundgz.1234567.com.cn/js/000001.js');
      return response('jsonpgz({"fundcode":"000001","name":"华夏成长混合","dwjz":"1.0000","gsz":"1.0100","jzrq":"2026-06-24","gztime":"2026-06-25 15:00"});');
    }));

    const res = await worker.fetch(new Request('https://worker.test/nav?code=000001'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({ code: '000001', name: '华夏成长混合', nav: 1, estimatedNav: 1.01, navDate: '2026-06-24', source: 'fundgz' });
  });

  it('falls back to official F10 latest NAV when fundgz returns jsonpgz();', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const href = String(url);
      if (href.includes('fundgz.1234567.com.cn/js/020712.js')) return response('jsonpgz();');
      if (href.includes('fund.eastmoney.com/pingzhongdata/020712.js')) return response('var fS_name = "华安三菱日联日经225ETF发起式联接(QDII)A";');
      if (href.includes('fund.eastmoney.com/f10/F10DataApi.aspx')) return response(f10Body());
      throw new Error(`unexpected url ${href}`);
    }));

    const res = await worker.fetch(new Request('https://worker.test/nav?code=020712'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      code: '020712',
      name: '华安三菱日联日经225ETF发起式联接(QDII)A',
      nav: 1.4617,
      accNav: 1.4617,
      navDate: '2026-06-24',
      estimatedNav: null,
      estimatedTime: null,
      source: 'eastmoney-f10',
    });
  });

  it('parses official F10 history rows', () => {
    expect(parseHistoryRows(f10Body('2026-06-23', '1.3145', '1.3145'))).toEqual([{ date: '2026-06-23', nav: 1.3145, accNav: 1.3145 }]);
  });
});
