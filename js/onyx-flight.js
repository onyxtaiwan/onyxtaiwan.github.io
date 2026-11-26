/*
 * ONYX flight check — reads /flightdb.json (pushed twice a day by the flight GAS, GH2_* target).
 * The resolver functions below are copied unchanged from the 準點 site so both sites read the
 * file the same way. Do not edit them here; update them from the 準點 source if the format changes.
 *
 * ONYX_FLIGHT.check({ flight, date:'YYYY-MM-DD', airport:'TPE', dir:'arr'|'dep' }) ->
 *   { status: 'ok' | 'mismatch' | 'notfound' | 'not_operating' | 'skip', flight, airline, time, actual }
 *   'skip' = no data (file missing, stale, out of season): never block the customer.
 */
(function (root) {
  'use strict';
        function _fnCandidates_(raw) {
          var s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!s) return [];
          var out = [s];
          var m = /^([A-Z0-9]{2})(\d{1,4})$/.exec(s);
          if (m) {
            var code = m[1], num = m[2];
            // ⚠ 只有「不足三碼」才補。無條件 slice(-3) 會把 3U3783 截成 3U783 ——
            //   四碼班號一堆（3U、MU、CZ 這些陸籍航空幾乎都是四碼），無條件補零會全毀。
            if (num.length < 3) {
              var pad3 = code + ('000' + num).slice(-3);           // BR7 → BR007
              if (out.indexOf(pad3) < 0) out.push(pad3);
            }
            // 反向：來源哪天不補零了，客人打 BR007 也要找得到 BR7
            if (num.charAt(0) === '0') {
              var bare = code + num.replace(/^0+/, '');
              if (bare.length > 2 && out.indexOf(bare) < 0) out.push(bare);
            }
          }
          return out;
        }

        function _resolveFlight_(f, dateStr, wantAp, dir) {
          var out = { depAirports: [], arrAirports: [], depTimes: [], arrTimes: [],
                      matchedDep: '', matchedArr: '', resolved: false, reason: '',
                      suggestedDep: '', suggestedArr: '', suggestedSource: '' };
          var legs = (f && f.legs) ? f.legs : [];

          // ① 先用客人選的機場過濾。共用班號(CodeShare)常常一個班號掛好幾條航線，
          //    客人既然已經選了機場，這一步就能砍掉大半雜訊。
          //    ⚠ 濾完是空的就不濾 —— 讓前端既有的「方向/機場不符」檢查去報錯，
          //      那句話（「此為降落於 XXX 的入境航班…」）比「查無此航班」有用得多。
          if (wantAp) {
            var byAp = legs.filter(function (L) { return (dir === 'dropoff' ? L[0] : L[1]) === wantAp; });
            if (byAp.length) legs = byAp;
          }

          // ② 不分日期的全集合。向下相容用：舊前端只讀這四個。
          legs.forEach(function (L) {
            if (L[0] && out.depAirports.indexOf(L[0]) < 0) out.depAirports.push(L[0]);
            if (L[1] && out.arrAirports.indexOf(L[1]) < 0) out.arrAirports.push(L[1]);
            if (L[2] && out.depTimes.indexOf(L[2]) < 0) out.depTimes.push(L[2]);
            if (L[3] && out.arrTimes.indexOf(L[3]) < 0) out.arrTimes.push(L[3]);
          });

          var d8 = _d8_(dateStr);
          if (!d8) { out.reason = 'no_date'; _fillSuggested_(out, f, null, null); return out; }

          // ③ 班期 ∩ 星期
          var hit = legs.filter(function (L) {
            var dd = (dir === 'dropoff') ? d8 : _addDays_(d8, -_dayShift_(L[3]));
            if (!L[5] || !L[6] || dd < L[5] || dd > L[6]) return false;
            return (L[4] & (1 << (_dow_(dd) - 1))) !== 0;
          });

          /**
           * ★ 比不到不是錯，是常態。但要分清楚是哪一種常態。
           *
           * ★ v4.16.1：舊版一律回 out_of_range，把兩件完全不同的事混在一起：
           *
           *   not_operating —— 資料明明涵蓋這一天，但這班機那天就是沒飛
           *     （很多航班一週只飛 3~4 天）。實測 2026-08-17 那天，飛四大機場的
           *     1,063 支航班號裡有 243 支屬於這種。這值得柔性提醒客人確認日期。
           *
           *   out_of_season —— 我們手上沒有那個航季的資料。TDX 只發當季，
           *     2026-08-03 實測最遠只到 10-24（夏季航季末），客人訂 11 月一定落空。
           *     這是**我們的**資料缺口，不能讓客人看到任何像是他填錯的訊息。
           *
           * 兩種都退回 v4.15 的行為（不標時間、內部取最早），所以這個改動
           * 仍然是嚴格不退步的；差別只在前端有沒有資格開口提醒。
           *
           * ⚠ 絕對不要在這裡回 not_found：那會讓客人看到「查無此航班」、
           *   以為自己打錯，而其實是我們沒資料。
           */
          if (!hit.length) {
            var lo = 0, hi = 0;
            legs.forEach(function (L) {
              if (L[5] && (!lo || L[5] < lo)) lo = L[5];
              if (L[6] > hi) hi = L[6];
            });
            // ±1 天的寬容度是給跨日航班用的（客人選落地日，班表記的是起飛日）
            var dn = _dayNum_(d8);
            out.reason = (lo && dn >= _dayNum_(lo) - 1 && dn <= _dayNum_(hi) + 1)
                       ? 'not_operating' : 'out_of_season';
            _fillSuggested_(out, f, null, null);      // 比不到也要給後台一個數字
            return out;
          }

          var dts = [], ats = [];
          hit.forEach(function (L) {
            if (L[2] && dts.indexOf(L[2]) < 0) dts.push(L[2]);
            if (L[3] && ats.indexOf(L[3]) < 0) ats.push(L[3]);
          });
          // ★ v4.18.1：把「這一天」的候選原樣（含±N）帶出去。
          //   多時段時訂單端要靠它跟自己存的 AK 對「同一班」——±N 是持久判別鍵：
          //   IT209 週五有 00:10+1（週四班跨日）與 23:45（週五班），起飛差近 24 小時，
          //   剝掉 +1 之後就再也分不出誰是誰。
          out.candDep = dts.slice(); out.candArr = ats.slice();
          if (dts.length === 1 && ats.length === 1) {
            out.resolved = true; out.matchedDep = dts[0]; out.matchedArr = ats[0];
            out.suggestedDep = dts[0]; out.suggestedArr = ats[0]; out.suggestedSource = 'exact';
          } else {
            out.reason = 'ambiguous';     // 同一天真的有兩班同號（少數共用班號）
            _fillSuggested_(out, f, dts, ats);
          }
          return out;
        }

        function _fillSuggested_(out, f, dts, ats) {
          var pool = (ats && ats.length) ? ats : out.arrTimes;
          var dpool = (dts && dts.length) ? dts : out.depTimes;
          var pick = _pickByNight_(pool, (f && f.n !== undefined) ? f.n : null);
          out.suggestedArr = pick.t;
          out.suggestedSource = pick.src;
          out.suggestedDep = _pickByNight_(dpool, null).t;      // 送機不套夜間政策，一律最早
        }

        function _pickByNight_(times, policy) {
          var list = (times || []).slice().filter(function (t) { return /^\d{1,2}:[0-5]\d/.test(String(t)); });
          if (!list.length) return { t: '', src: '' };
          function mins(t) { return Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5)); }
          function isN(t) { var h = Number(String(t).slice(0, 2)); return h >= 22 || h < 6; }
          list.sort(function (a, b) { return mins(a) - mins(b); });
          if (policy === 1 || policy === 0) {
            var want = list.filter(function (t) { return isN(t) === (policy === 1); });
            if (want.length) return { t: want[0], src: (policy === 1 ? 'night_policy' : 'day_policy') };
          }
          return { t: list[0], src: 'earliest' };
        }

        function _d8_(v) {                          // 任何日期表示法 → 20260803；拿不到回 0
          if (v == null || v === '') return 0;
          var s = String(v);
          var m = /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(s);
          if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
          var n = Number(s.replace(/\D/g, ''));
          return (n >= 19000101 && n <= 21001231) ? n : 0;
        }

        function _dayNum_(d8) {                     // → 距 1970-01-01 的天數
          return Math.floor(Date.UTC(Math.floor(d8 / 10000), Math.floor(d8 / 100) % 100 - 1, d8 % 100) / 86400000);
        }

        function _fromDayNum_(n) {
          var d = new Date(n * 86400000);
          return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
        }

        function _addDays_(d8, n) { return _fromDayNum_(_dayNum_(d8) + n); }

        function _dow_(d8) { return ((_dayNum_(d8) + 3) % 7) + 1; }

        function _dayShift_(t) {                    // '05:00+1' → 1；'17:55' → 0；'23:50-1' → -1
          var m = /([+-]\d)\s*$/.exec(String(t || ''));
          return m ? Number(m[1]) : 0;
        }
        /* ══════════ 抽取區結束 ══════════ */

  var AIRPORTS = { TPE: 1, TSA: 1, RMQ: 1, KHH: 1 };
  var db = null, loading = null;

  // Same cache key rule as the 準點 site: Taipei date + slot (a = 05:00-16:59, b = 17:00-04:59)
  function cacheKey() {
    var P = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date());
    var g = function (t) { var x = P.find(function (v) { return v.type === t; }); return x ? x.value : ''; };
    var y = Number(g('year')), m = Number(g('month')), d = Number(g('day')), h = Number(g('hour'));
    if (h === 24) h = 0;
    var slot = 'b';
    if (h >= 5 && h < 17) slot = 'a';
    else if (h < 5) { var dt = new Date(Date.UTC(y, m - 1, d) - 864e5); y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate(); }
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') + '-' + slot;
  }
  function todayTaipei8() {
    var P = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    var g = function (t) { var x = P.find(function (v) { return v.type === t; }); return x ? Number(x.value) : 0; };
    return g('year') * 10000 + g('month') * 100 + g('day');
  }
  function load(url) {
    if (db) return Promise.resolve(db);
    if (loading) return loading;
    loading = fetch((url || 'flightdb.json') + '?d=' + cacheKey())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { db = (j && j.flights) ? j : null; return db; })
      .catch(function () { db = null; return null; })
      .then(function (v) { loading = null; return v; });
    return loading;
  }
  function stripDay(t) { return String(t || '').replace(/[+-]\d\s*$/, '').trim(); }

  function check(p) {
    // status: 'ok' | 'direction' (an arrival flight booked as a departure, or the other way) | 'mismatch' (other Taiwan airport)
    //         | 'notfound' | 'not_operating' | 'skip' (no data: never block the customer)
    // time: the one scheduled time on that date (landing for arrivals, departure for departures), '' when not certain
    // reason (time = ''): 'no_date' | 'ambiguous' (two times that day) | 'out_of_season' (no schedule for that date yet)
    // hasXDay (arrivals): some flights with this number land the next day (+1): the customer confirms the landing date
    var out = { status: 'skip', flight: '', airline: '', time: '', timeRaw: '', reason: '', hasXDay: false, actual: '' };
    if (!db || !db.flights || !db.generatedAt) return out;
    var gen8 = _d8_(String(db.generatedAt).slice(0, 10));
    if (!gen8 || _dayNum_(todayTaipei8()) - _dayNum_(gen8) > 1) return out;      // stale file: skip
    var cands = _fnCandidates_(p.flight || ''), f = null;
    for (var i = 0; i < cands.length; i++) if (db.flights[cands[i]]) { f = db.flights[cands[i]]; out.flight = cands[i]; break; }
    if (!cands.length) return out;
    if (!f) { out.status = 'notfound'; out.flight = cands[0]; return out; }
    out.airline = f.a || '';
    var dir = p.dir === 'dep' ? 'dropoff' : 'pickup';
    var ap = AIRPORTS[p.airport] ? p.airport : '';
    // direction first (same as 準點), even before an airport is chosen
    var all = _resolveFlight_(f, '', '', dir);
    var twDep = all.depAirports.filter(function (a) { return AIRPORTS[a]; }), twArr = all.arrAirports.filter(function (a) { return AIRPORTS[a]; });
    if (dir === 'dropoff' && twArr.length && !twDep.length) { out.status = 'direction'; out.actual = twArr[0]; return out; }
    if (dir === 'pickup' && twDep.length && !twArr.length) { out.status = 'direction'; out.actual = twDep[0]; return out; }
    var r = _resolveFlight_(f, p.date || '', ap, dir);
    var served = dir === 'dropoff' ? r.depAirports : r.arrAirports;
    if (ap && served.length && served.indexOf(ap) < 0) {
      out.status = 'mismatch';
      out.actual = served.filter(function (a) { return AIRPORTS[a]; })[0] || served[0];
      return out;
    }
    // any flight with this number (at this airport) landing the next day -> ask for the landing date (準點 v3.2.153)
    if (dir === 'pickup') out.hasXDay = /[+]\d/.test(r.arrTimes.join(',') + ',' + (r.matchedArr || ''));
    if (r.reason === 'not_operating') { out.status = 'not_operating'; return out; }
    out.status = 'ok';
    var t = dir === 'dropoff' ? (r.resolved ? r.matchedDep : '') : (r.resolved ? r.matchedArr : '');
    out.timeRaw = String(t || '');          // with +1 / -1 as in the schedule
    out.time = stripDay(t);                 // only when the schedule gives one exact time
    out.reason = r.resolved ? '' : (r.reason || '');
    return out;
  }

  root.ONYX_FLIGHT = { load: load, check: check };
})(typeof window !== 'undefined' ? window : this);
