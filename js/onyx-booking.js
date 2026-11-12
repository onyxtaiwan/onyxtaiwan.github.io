/*
 * ONYX booking form (preview). Renders into #onyx-booking.
 * Needs: js/onyx-pricing.js (ONYX_PRICING), js/onyx-flight.js (ONYX_FLIGHT),
 *        window.ONYX_BOOKING_CONFIG, Google Maps JS (loading=async, callback=onyxMapsReady).
 */
(function () {
  'use strict';
  var P = window.ONYX_PRICING, F = window.ONYX_FLIGHT;
  var CFG = window.ONYX_BOOKING_CONFIG || {};
  var VEHICLES = ['Standard', 'Premium SUV', 'Premium Van', 'Luxury'];
  var AP = P.GEO.airports;
  var SVC = { airport: 'Airport Transfer', city: 'City Transfer', charter: 'Private Charter' };
  var MAXSTOPS = { airport: 3, city: 3, charter: 6 };

  // Fixed coordinates for single-day itinerary stops (please verify; see coordinates review sheet)
  var SPOTS = {
    1: [['Yehliu Geopark', 25.2063, 121.6900], ['Yin Yang Sea', 25.1236, 121.8616], ['Golden Waterfall', 25.1174, 121.8605], ['Jiufen Old Street', 25.1088, 121.8435], ['Shifen Waterfall', 25.0494, 121.7877], ['Shifen Sky Lanterns (Shifen Old Street)', 25.0426, 121.7766]],
    2: [['Rainbow Village', 24.1336, 120.6097], ['Miyahara', 24.1377, 120.6835], ['Shenji New Village', 24.1446, 120.6629], ['National Taichung Theater', 24.1626, 120.6404], ['Gaomei Wetlands', 24.3125, 120.5497]],
    3: [['Xiangshan Visitor Center', 23.8511, 120.9021], ['Shuishe Pier', 23.8645, 120.9118], ['Xuanguang Pier (Lake Cruise)', 23.8528, 120.9132], ['Sun Moon Lake Ropeway', 23.8525, 120.9350], ['Ita Thao', 23.8496, 120.9287], ['Wenwu Temple', 23.8700, 120.9275]],
    4: [['C.K.S Memorial Hall', 25.0347, 121.5218], ['National Palace Museum', 25.1024, 121.5485], ['Taipei 101', 25.0340, 121.5645], ['Lungshan Temple', 25.0372, 121.4999], ['Dihua Street', 25.0560, 121.5101]],
    5: [['Xiaoyoukeng', 25.1754, 121.5475], ['Qingtiangang Grassland', 25.1664, 121.5743], ['Milk Lake', 25.1668, 121.5645], ['Thermal Valley', 25.1379, 121.5119], ['Beitou Hot Spring Museum', 25.1366, 121.5070], ['Xinbeitou Historic Station', 25.1374, 121.5022]],
    6: [['Lanyang Museum', 24.8686, 121.8325], ['Jiaoxi Hot Spring Park', 24.8310, 121.7760], ['National Center for Traditional Arts', 24.6862, 121.8238], ['Kavalan Whisky Distillery', 24.7141, 121.6887], ["Zhang Mei Ama's Farm", 24.6750, 121.6762]],
    12: [['Sanyi Wood Sculpture Museum', 24.4059, 120.7609], ['Shengxing Railway Station', 24.3880, 120.7817], ['Old Mountain Line Rail Bike', 24.3880, 120.7817], ['Longteng Broken Bridge', 24.3584, 120.7738], ['Nanzhuang Old Street', 24.5994, 120.9993], ['Chateau in the Air', 24.3495, 120.7789]]
  };

  /* ---------------- state ---------------- */
  var uid = 0;
  function pt(label, lat, lng) { return { label: label || '', lat: typeof lat === 'number' ? lat : null, lng: typeof lng === 'number' ? lng : null }; }
  function newCar(src) {
    return src ? { vehicle: src.vehicle, pax: src.pax, l28: src.l28, l20: src.l20, lst: src.lst, kids: src.kids, inf: src.inf, ch: src.ch }
               : { vehicle: null, pax: '', l28: '', l20: '', lst: '0', kids: false, inf: '0', ch: '0' };
  }
  function newTrip(prev) {
    var t = { id: ++uid, svc: 'airport', dir: null, airport: '', flight: '', fres: null, fok: false, hrs: null,
      date: '', hh: '', mm: '', from: pt(), to: pt(), same: false, stops: [], sign: false, eng: false,
      cars: [newCar()], route: null, pending: null, itinerary: '' };
    if (prev) {
      t.cars = prev.cars.map(newCar);
      var hotel = prev.svc === 'airport' ? (prev.dir === 'arr' ? prev.to : prev.from) : (prev.same ? prev.from : prev.to);
      if (hotel && hotel.label) t.from = pt(hotel.label, hotel.lat, hotel.lng);
    }
    return t;
  }
  var S = { trips: [newTrip()], promoCode: '', promo: null, promoStale: false, promoMsg: '', promoBad: false,
    name: '', phone: '', email: '', remarks: '', terms: false, errors: [], submitting: false, done: null, sugg: null };

  /* ---------------- helpers ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return 'TWD ' + Number(n).toLocaleString('en-US'); }
  function n0(v) { return v === '' || v == null ? 0 : Number(v); }
  function opts(min, max, cur, ph) {
    var h = ph ? '<option value="" disabled' + (cur === '' ? ' selected' : '') + '>Select</option>' : '';
    for (var i = min; i <= max; i++) h += '<option value="' + i + '"' + (String(i) === String(cur) ? ' selected' : '') + '>' + i + '</option>';
    return h;
  }
  function taipeiNow() {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    var g = function (t) { var x = p.find(function (v) { return v.type === t; }); return x ? x.value : '00'; };
    var h = g('hour') === '24' ? '00' : g('hour');
    return { date: g('year') + '-' + g('month') + '-' + g('day'), time: h + ':' + g('minute') };
  }
  function hoursUntil(t) {   // both sides as Taiwan wall-clock time
    if (!t.date) return null;
    var now = taipeiNow();
    var a = Date.parse(now.date + 'T' + now.time + ':00Z'), b = Date.parse(t.date + 'T' + (t.hh || '00') + ':' + (t.mm || '00') + ':00Z');
    return (b - a) / 36e5;
  }
  var minDate = (function () { var d = new Date(Date.parse(taipeiNow().date + 'T00:00:00Z') + 2 * 864e5); return d.toISOString().slice(0, 10); })();

  function enginePoints(t) {
    var from = t.from, to = t.same ? t.from : t.to;
    if (t.svc === 'airport' && t.airport) {
      var a = AP[t.airport], ap = pt(a.name, a.lat, a.lng);
      if (t.dir === 'arr') from = ap; else if (t.dir === 'dep') to = ap;
    }
    return { from: from, to: to, stops: t.stops.filter(function (s) { return s.label.trim(); }) };
  }
  function hasCoords(p) { return p && typeof p.lat === 'number' && typeof p.lng === 'number'; }
  function routeReady(t) {
    if (t.svc === 'airport' && (!t.dir || !t.airport)) return false;
    if (t.svc === 'charter' && !t.hrs) return false;
    var pts = enginePoints(t);
    return hasCoords(pts.from) && hasCoords(pts.to) && pts.stops.every(hasCoords);
  }
  function engineTrip(t) {
    return { svc: t.svc, dir: t.dir, airport: t.airport, hrs: t.hrs, date: t.date, time: t.hh && t.mm ? t.hh + ':' + t.mm : '',
      points: enginePoints(t), route: t.route && t.route.status === 'ok' ? t.route : null, sign: t.sign, eng: t.eng,
      cars: t.cars.map(function (c) { return { vehicle: c.vehicle, pax: n0(c.pax), l28: n0(c.l28), l20: n0(c.l20), lst: n0(c.lst), inf: c.kids ? n0(c.inf) : 0, ch: c.kids ? n0(c.ch) : 0 }; }) };
  }
  function quote() { return P.quoteOrder({ trips: S.trips.map(engineTrip), promo: S.promo }); }
  function lineFor(q, ti, ci) { for (var i = 0; i < q.lines.length; i++) if (q.lines[i].trip === ti && q.lines[i].car === ci) return q.lines[i]; return null; }

  /* ---------------- Google Maps wrapper (new APIs, legacy fallback) ---------------- */
  var mapsReady = new Promise(function (resolve) {
    if (window.google && google.maps && google.maps.importLibrary) resolve();
    else window.onyxMapsReady = resolve;
  });
  function ll(p) { return typeof p.lat === 'function' ? { lat: p.lat(), lng: p.lng() } : { lat: Number(p.lat), lng: Number(p.lng) }; }
  function sample(path, max) {
    if (path.length <= max) return path;
    var step = path.length / max, out = [];
    for (var i = 0; i < max; i++) out.push(path[Math.floor(i * step)]);
    out.push(path[path.length - 1]);
    return out;
  }
  var Maps = {
    route: function (points) {
      return mapsReady.then(function () {
        return google.maps.importLibrary('routes').then(function (lib) {
          if (!lib.Route || !lib.Route.computeRoutes) throw new Error('no Route class');
          return lib.Route.computeRoutes({
            origin: points[0], destination: points[points.length - 1],
            intermediates: points.slice(1, -1).map(function (p) { return { location: p }; }),
            travelMode: 'DRIVING', region: 'tw', fields: ['distanceMeters', 'durationMillis', 'path']
          }).then(function (r) {
            var rt = r && r.routes && r.routes[0];
            if (!rt) throw new Error('no route');
            return { km: rt.distanceMeters / 1000, durationMin: (rt.durationMillis || 0) / 60000, path: (rt.path || []).map(ll) };
          });
        }).catch(function () { return Maps.legacyRoute(points); });
      });
    },
    legacyRoute: function (points) {
      return new Promise(function (resolve, reject) {
        new google.maps.DirectionsService().route({
          origin: points[0], destination: points[points.length - 1],
          waypoints: points.slice(1, -1).map(function (p) { return { location: p, stopover: true }; }),
          travelMode: 'DRIVING', region: 'tw'
        }, function (res, status) {
          if (status !== 'OK' || !res.routes[0]) return reject(new Error(status));
          var legs = res.routes[0].legs, m = 0, s = 0;
          legs.forEach(function (l) { m += l.distance.value; s += l.duration.value; });
          resolve({ km: m / 1000, durationMin: s / 60, path: res.routes[0].overview_path.map(ll) });
        });
      });
    },
    // Highest elevation of the pick-up / drop-off / stops themselves (not the road in between:
    // tunnels would read as the mountain above them)
    pointElevation: function (points) {
      return mapsReady.then(function () { return google.maps.importLibrary('elevation'); }).then(function (lib) {
        var svc = new lib.ElevationService();
        return svc.getElevationForLocations({ locations: points });
      }).then(function (r) {
        var res = r && (r.results || r);
        if (!res || !res.length) return null;
        var el = res.map(function (x) { return x.elevation; });
        return { max: Math.max.apply(null, el), end: el[el.length - 1] };   // highest point, and the drop-off
      }).catch(function () { return null; });     // no elevation = no mountain surcharge (never blocks)
    },
    token: null,
    suggest: function (text) {
      return mapsReady.then(function () { return google.maps.importLibrary('places'); }).then(function (lib) {
        if (lib.AutocompleteSuggestion) {
          if (!Maps.token) Maps.token = new lib.AutocompleteSessionToken();
          return lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: text, sessionToken: Maps.token, includedRegionCodes: ['tw'], language: 'en' })
            .then(function (r) { return (r.suggestions || []).filter(function (s) { return s.placePrediction; }).slice(0, 5).map(function (s) { return { text: s.placePrediction.text.toString(), pred: s.placePrediction }; }); });
        }
        return new Promise(function (resolve) {
          new google.maps.places.AutocompleteService().getPlacePredictions({ input: text, componentRestrictions: { country: 'tw' } }, function (p) {
            resolve((p || []).slice(0, 5).map(function (x) { return { text: x.description, placeId: x.place_id }; }));
          });
        });
      }).catch(function () { return []; });
    },
    details: function (item) {
      if (item.pred) {
        var place = item.pred.toPlace();
        Maps.token = null;
        return place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] }).then(function () {
          var name = place.displayName || '', addr = place.formattedAddress || '';
          return pt(name && addr.indexOf(name) < 0 ? name + ', ' + addr : (addr || name), place.location.lat(), place.location.lng());
        });
      }
      return Maps.geocode({ placeId: item.placeId }, item.text);
    },
    geocode: function (req, label) {
      return mapsReady.then(function () {
        return new Promise(function (resolve) {
          new google.maps.Geocoder().geocode(typeof req === 'string' ? { address: req, region: 'tw' } : req, function (r, s) {
            if (s === 'OK' && r[0]) resolve(pt(label || r[0].formatted_address, r[0].geometry.location.lat(), r[0].geometry.location.lng()));
            else resolve(null);
          });
        });
      });
    }
  };

  /* ---------------- route + elevation per trip ---------------- */
  function routeKey(t) {
    var pts = enginePoints(t), list = [pts.from].concat(pts.stops, [pts.to]);
    return t.svc + '|' + list.map(function (p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }).join(';');
  }
  function ensureRoute(t) {
    if (!routeReady(t)) { if (t.route && t.route.status !== 'loading') t.route = null; return; }
    var key = routeKey(t);
    if (t.route && t.route.key === key && !(t.route.status === 'fail' && Date.now() - t.route.at > 15000)) return;
    t.route = { key: key, status: 'loading' };
    var pts = enginePoints(t), list = [pts.from].concat(pts.stops, [pts.to]).map(function (p) { return { lat: p.lat, lng: p.lng }; });
    Maps.route(list).then(function (r) {
      if (!t.route || t.route.key !== key) return null;
      // 150 rounded points: exactly what the payment GAS receives, so both price the same path
      var path = sample(r.path, 150).map(function (p) { return { lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 }; });
      var base = { key: key, status: 'ok', km: Math.round(r.km * 10) / 10, durationMin: Math.round(r.durationMin), path: path, pointElev: null, endElev: null };
      return Maps.pointElevation(list).then(function (e) {
        if (e) { base.pointElev = Math.round(e.max); base.endElev = Math.round(e.end); }
        return base;
      });
    }).then(function (done) {
      if (done && t.route && t.route.key === key) { t.route = done; render(); }
    }).catch(function () {
      if (t.route && t.route.key === key) { t.route = { key: key, status: 'fail', at: Date.now() }; render(); }
    });
  }

  /* ---------------- flight ---------------- */
  function checkFlight(t) {
    t.fres = null; t.fok = false;
    var raw = (t.flight || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    t.flight = raw;
    if (!raw || t.svc !== 'airport') return;
    F.load(CFG.FLIGHTDB_URL).then(function () {
      var r = F.check({ flight: raw, date: t.date, airport: t.airport, dir: t.dir });
      if (r.flight) t.flight = r.flight;
      t.fres = r;
      if (r.status === 'ok' && r.time && t.dir === 'arr' && !t.hh && !t.mm) {
        t.hh = r.time.slice(0, 2); var m = Number(r.time.slice(3, 5)); t.mm = String(Math.floor(m / 10) * 10).padStart(2, '0');
      }
      render();
    });
  }

  /* ---------------- rendering ---------------- */
  function addrField(id, p, placeholder, extraAttr) {
    var s = S.sugg && S.sugg.id === id ? S.sugg : null;
    return '<div class="addr"><input id="' + id + '" data-addr="' + id + '" autocomplete="off" placeholder="' + esc(placeholder) + '" value="' + esc(p.label) + '"' + (extraAttr || '') + '>' +
      (s && s.items.length ? '<ul class="sugg" role="listbox">' + s.items.map(function (it, i) {
        return '<li role="option" data-pick="' + id + '" data-i="' + i + '" aria-selected="' + (i === s.active) + '">' + esc(it.text) + '</li>'; }).join('') + '</ul>' : '') +
      '</div><button class="mapbtn" type="button" data-act="map" data-target="' + id + '" aria-label="Pick on map">⌖</button>';
  }
  function carBlock(t, ti, c, ci, q) {
    var k = 't' + ti + 'c' + ci, multi = t.cars.length > 1, cap = P.capacityOf(c.vehicle) || { pax: 8, bags: 8, seats: 2 };
    var line = lineFor(q, ti, ci);
    var ready = routeReady(t) && t.route && t.route.status === 'ok';
    var cards = VEHICLES.map(function (v) {
      var price = null;
      if (ready) {
        var qq = P.quoteCar(engineTrip(t), { vehicle: v, pax: n0(c.pax), l28: 0, l20: 0, lst: 0, inf: 0, ch: 0 }, { promo: null, overnightNights: 0 });
        if (qq.ok) price = qq.total;
      }
      var cp = P.capacityOf(v);
      return '<button class="car" type="button" aria-pressed="' + (c.vehicle === v) + '" data-act="car" data-t="' + ti + '" data-c="' + ci + '" data-v="' + v + '"><span class="name">' + v + '</span><span class="cap">' + cp.pax + ' pax · ' + cp.bags + ' bags</span><span class="price' + (price == null ? ' wait' : '') + '">' + (price == null ? '—' : fmt(price)) + '</span></button>';
    }).join('');
    var bagsLeft = Math.max(0, cap.bags), seatMax = cap.seats;
    var problem = c.vehicle ? P.capacityProblem(engineTrip(t).cars[ci]) : null;
    var seatHint = (t.svc === 'charter' ? 'Free on charters' : '+$200 each') + ' · Up to ' + seatMax + ' seat' + (seatMax > 1 ? 's' : '') + (c.vehicle ? ' in ' + c.vehicle : '');
    return '<div class="' + (multi ? 'vehicle' : 'step') + '">' +
      (multi ? '<div class="head"><b>Car ' + (ci + 1) + '</b>' + (ci > 0 ? '<button class="rm" type="button" data-act="rmcar" data-t="' + ti + '" data-c="' + ci + '">Remove</button>' : '') + '</div>' : '') +
      '<div class="step"><span class="step-label">Vehicle<span class="req">*</span></span><div class="cars" role="group" aria-label="Vehicle" id="' + k + '-cars">' + cards + '</div></div>' +
      '<div class="step"><span class="step-label">Passengers &amp; luggage</span><div class="row-pax">' +
        '<div class="field"><label for="' + k + '-pax">Passengers (incl. children)<span class="req">*</span></label><select id="' + k + '-pax" data-f="pax" class="' + (c.pax === '' ? 'empty' : '') + '">' + opts(1, Math.max(cap.pax, n0(c.pax)), c.pax, true) + '</select></div>' +
        '<div class="field"><label for="' + k + '-l28">28" bags<span class="req">*</span></label><select id="' + k + '-l28" data-f="l28" class="' + (c.l28 === '' ? 'empty' : '') + '">' + opts(0, Math.max(bagsLeft, n0(c.l28)), c.l28, true) + '</select></div>' +
        '<div class="field"><label for="' + k + '-l20">20" bags<span class="req">*</span></label><select id="' + k + '-l20" data-f="l20" class="' + (c.l20 === '' ? 'empty' : '') + '">' + opts(0, Math.max(bagsLeft * 2, n0(c.l20)), c.l20, true) + '</select></div>' +
        '<div class="field"><label for="' + k + '-lst">Stroller / Wheelchair</label><select id="' + k + '-lst" data-f="lst">' + opts(0, Math.max(bagsLeft, n0(c.lst)), c.lst, false) + '</select></div>' +
      '</div>' +
      '<label class="check"><input type="checkbox" id="' + k + '-kids" data-f="kids"' + (c.kids ? ' checked' : '') + '> Traveling with children under 5</label>' +
      (c.kids ? '<div class="kids"><div class="grid">' +
        '<div class="field"><label for="' + k + '-inf">Infant seat (age 0–2)</label><select id="' + k + '-inf" data-f="inf">' + opts(0, Math.max(seatMax, n0(c.inf)), c.inf, false) + '</select></div>' +
        '<div class="field"><label for="' + k + '-ch">Child seat (age 3–4)</label><select id="' + k + '-ch" data-f="ch">' + opts(0, Math.max(seatMax, n0(c.ch)), c.ch, false) + '</select></div>' +
        '</div><span class="hint">' + seatHint + '</span></div>' : '') +
      (problem ? '<span class="msg stop">' + esc(problem) + '</span>' : '') +
      (ci === t.cars.length - 1 ? '<button class="link" type="button" data-act="addcar" data-t="' + ti + '">Need more space? + Add another vehicle</button>' : '') +
      '</div>' +
      (multi ? '<div class="line-total"><span class="small">Car ' + (ci + 1) + (c.vehicle ? ' · ' + c.vehicle : '') + '</span><span class="amt">' + (line && line.ok ? fmt(line.total) : '—') + '</span></div>' : '') +
    '</div>';
  }
  function hoursOpts(cur, ph, list) {
    var h = '<option value="" disabled' + (cur ? '' : ' selected') + '>' + ph + '</option>';
    list.forEach(function (v) { h += '<option' + (v === cur ? ' selected' : '') + '>' + v + '</option>'; });
    return h;
  }
  var HH = [], MM = [];
  for (var i = 0; i < 24; i++) HH.push(String(i).padStart(2, '0'));
  for (var j = 0; j < 60; j += 10) MM.push(String(j).padStart(2, '0'));

  function tripBlock(t, ti, q) {
    var k = 't' + ti, isAir = t.svc === 'airport', arr = t.dir === 'arr', dep = t.dir === 'dep';
    var apName = t.airport ? AP[t.airport].name : 'Airport';
    var tabs = ['airport', 'city', 'charter'].map(function (s) {
      var sub = { airport: 'To or from the airport', city: 'Point to point', charter: '4 or 8 hours' }[s];
      return '<button class="tab" type="button" aria-pressed="' + (t.svc === s) + '" data-act="svc" data-t="' + ti + '" data-v="' + s + '">' + SVC[s] + '<small>' + sub + '</small></button>';
    }).join('');
    var fr = t.fres, fmsg = '';
    if (fr && fr.status === 'ok') fmsg = '<span class="msg ok">✓ ' + esc(t.flight) + (fr.airline ? ' · ' + esc(fr.airline) : '') + (fr.time ? ' · scheduled ' + (arr ? 'landing ' : 'departure ') + fr.time : '') + '</span>';
    else if (fr && fr.status === 'mismatch') fmsg = '<span class="msg stop">' + esc(t.flight) + (dep ? ' departs from ' : ' lands at ') + esc(AP[fr.actual] ? AP[fr.actual].name : fr.actual) + ', not ' + esc(apName) + '. Please check the airport.</span>';
    else if (fr && fr.status === 'notfound') fmsg = '<span class="msg warn">We couldn\'t find ' + esc(t.flight) + '. Please check the flight number.</span><label class="check"><input type="checkbox" id="' + k + '-fok" data-f="fok"' + (t.fok ? ' checked' : '') + '> My flight number is correct</label>';
    else if (fr && fr.status === 'not_operating') fmsg = '<span class="msg warn">' + esc(t.flight) + ' doesn\'t usually fly on this date. Please check the date.</span>';
    var lines = t.cars.map(function (c, ci) { return lineFor(q, ti, ci); });
    var tripTotal = lines.every(function (l) { return l && l.ok; }) ? lines.reduce(function (s, l) { return s + l.total; }, 0) : null;
    var anyManual = lines.some(function (l) { return l && l.manual; });
    var holiday = lines.some(function (l) { return l && l.holiday; });
    var freeHour = lines.some(function (l) { return l && l.freeHour; });
    var warns = [];
    lines.forEach(function (l) { if (l) l.warnings.forEach(function (w) { if (warns.indexOf(w) < 0) warns.push(w); }); });
    var hrs = hoursUntil(t), rush = hrs != null && hrs >= 48 && hrs < 72;
    var stopsHtml = t.stops.map(function (s, si) {
      var lock = t.svc === 'charter' && t.stops.length === 1;
      return '<div class="stop"><span class="dot mid"></span>' + addrField(k + '-s' + si, s, 'Stop ' + (si + 1)) + (lock ? '' : '<button class="x" type="button" aria-label="Remove stop" data-act="rmstop" data-t="' + ti + '" data-s="' + si + '">✕</button>') + '</div>';
    }).join('');
    var routeHint = '';
    if (t.route && t.route.status === 'loading') routeHint = 'Calculating route…';
    else if (t.route && t.route.status === 'fail') routeHint = 'We couldn\'t find a driving route. We\'ll send you a quote by WhatsApp.';
    else if (t.route && t.route.status === 'ok') routeHint = 'Distance ' + t.route.km + ' km' + (t.svc === 'charter' && t.hrs !== 'custom' ? ' · includes ' + (t.hrs === '8' ? 150 : 100) + ' km' : '');
    var sub = (t.date ? t.date + ' · ' : '') + SVC[t.svc] + (isAir && t.dir ? ' · ' + (arr ? 'Arrival' : 'Departure') : '') + (t.svc === 'charter' && t.hrs ? ' · ' + (t.hrs === 'custom' ? 'Custom' : t.hrs + ' hours') : '');
    return '<section class="card" aria-label="Trip ' + (ti + 1) + '">' +
      '<div class="head"><span><b>Trip ' + (ti + 1) + '</b> <span class="sub">' + esc(sub) + '</span></span>' + (ti > 0 ? '<button class="rm" type="button" data-act="rmtrip" data-t="' + ti + '">Remove trip</button>' : '') + '</div>' +
      '<div class="step"><span class="step-label">Service<span class="req">*</span></span><div class="tabs" role="group" aria-label="Service">' + tabs + '</div>' +
        (t.pending ? '<div class="infobox" role="alert">Switch to ' + SVC[t.pending] + '? The route, date, time and flight you entered for this trip will be cleared. Vehicles, passengers and your contact details stay. <span class="linkrow"><button class="link" type="button" data-act="svcyes" data-t="' + ti + '">Switch</button> · <button class="link" type="button" data-act="svcno" data-t="' + ti + '">Keep ' + SVC[t.svc] + '</button></span></div>' : '') +
      '</div>' +
      '<div class="step"><span class="step-label">Trip details</span>' +
        (isAir ? '<div class="field"><span class="flabel">Direction<span class="req">*</span></span><div class="seg two" role="group" aria-label="Direction" id="' + k + '-dir">' +
          '<button type="button" aria-pressed="' + arr + '" data-act="dir" data-t="' + ti + '" data-v="arr">Arrival</button><button type="button" aria-pressed="' + dep + '" data-act="dir" data-t="' + ti + '" data-v="dep">Departure</button></div></div>' +
          '<div class="grid"><div class="field"><label for="' + k + '-ap">Airport<span class="req">*</span></label><select id="' + k + '-ap" data-f="airport" class="' + (t.airport ? '' : 'empty') + '"><option value="" disabled' + (t.airport ? '' : ' selected') + '>Select airport</option>' +
            Object.keys(AP).map(function (a) { return '<option value="' + a + '"' + (t.airport === a ? ' selected' : '') + '>' + AP[a].name.replace(' Airport', '') + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="' + k + '-fl">Flight number<span class="req">*</span></label><input id="' + k + '-fl" data-f="flight" placeholder="e.g. BR198" autocomplete="off" value="' + esc(t.flight) + '">' + fmsg + '</div></div>' : '') +
        (t.svc === 'charter' ? '<div class="field"><span class="flabel">Duration<span class="req">*</span></span><div class="seg three" role="group" aria-label="Duration" id="' + k + '-hrs">' +
          ['4', '8', 'custom'].map(function (h) { return '<button type="button" aria-pressed="' + (t.hrs === h) + '" data-act="hrs" data-t="' + ti + '" data-v="' + h + '">' + (h === 'custom' ? 'Custom' : h + ' hours') + '</button>'; }).join('') + '</div>' +
          (freeHour ? '<span class="gift">✓ Promo: +1 free hour (9 hours in total)</span>' : '') +
          (t.hrs === 'custom' ? '<span class="hint">Tell us your plan in Remarks. We\'ll send you a quote by WhatsApp.</span>' : '') + '</div>' : '') +
        '<div class="grid"><div class="field"><label for="' + k + '-date">' + (isAir && arr ? 'Landing date' : 'Date') + '<span class="req">*</span></label><input type="date" id="' + k + '-date" data-f="date" min="' + minDate + '" value="' + esc(t.date) + '"></div>' +
          '<div class="field"><span class="flabel">' + (isAir ? (arr ? 'Landing time' : dep ? 'Pick-up time' : 'Time') : t.svc === 'charter' ? 'Start time' : 'Pick-up time') + '<span class="req">*</span></span><div class="time2">' +
          '<select id="' + k + '-hh" data-f="hh" aria-label="Hour" class="' + (t.hh ? '' : 'empty') + '">' + hoursOpts(t.hh, 'Hour', HH) + '</select>' +
          '<select id="' + k + '-mm" data-f="mm" aria-label="Minute" class="' + (t.mm ? '' : 'empty') + '">' + hoursOpts(t.mm, 'Min', MM) + '</select></div></div></div>' +
        (rush ? '<span class="rush">Short-notice booking: we\'ll confirm vehicle availability shortly. If no vehicle is available, your deposit is fully refunded.</span>' : '') +
        (isAir && dep ? '<span class="hint">We recommend arriving at the airport 3 hours before an international flight.</span>' : '') +
        '<div class="route"><span class="flabel">Route<span class="req">*</span></span>' +
          '<div class="stop"><span class="dot"></span>' + (isAir && !dep ? '<span class="fixed">' + esc(apName) + '</span>' : addrField(k + '-from', t.from, isAir ? 'Hotel or pick-up address' : 'Pick-up address')) + '</div>' +
          stopsHtml +
          (t.stops.length < MAXSTOPS[t.svc] ? '<div class="linkrow"><button class="link" type="button" data-act="addstop" data-t="' + ti + '">+ Add stop' + (t.svc === 'charter' ? '' : ' · +$300 each') + '</button><button class="info" type="button" data-act="info" data-t="' + ti + '" aria-label="About stops">i</button></div>' : '') +
          '<div class="infobox" data-info="' + k + '" hidden>Please list all stops now. Stops added on the day are TWD 500 each plus TWD 25 per extra km, paid to your chauffeur.</div>' +
          '<div class="stop"><span class="dot end"></span>' + (isAir && dep ? '<span class="fixed">' + esc(apName) + '</span>' : (t.same ? '<span class="fixed">Same as pick-up</span>' : addrField(k + '-to', t.to, isAir ? 'Hotel or drop-off address' : 'Drop-off address'))) + '</div>' +
          (t.svc === 'charter' ? '<label class="check"><input type="checkbox" id="' + k + '-same" data-f="same"' + (t.same ? ' checked' : '') + '> Drop-off same as pick-up</label>' : '') +
          (routeHint ? '<span class="hint">' + esc(routeHint) + '</span>' : '') +
        '</div></div>' +
      t.cars.map(function (c, ci) { return carBlock(t, ti, c, ci, q); }).join('') +
      ((isAir && arr) || t.svc === 'charter' ? '<div class="step"><span class="step-label">Extras</span>' +
        (isAir && arr ? '<label class="check"><input type="checkbox" id="' + k + '-sign" data-f="sign"' + (t.sign ? ' checked' : '') + '> Meet &amp; greet name sign · +$300 per car</label>' : '') +
        (t.svc === 'charter' ? '<label class="check"><input type="checkbox" id="' + k + '-eng" data-f="eng"' + (t.eng ? ' checked' : '') + '> Fluent English chauffeur · +$1,000 / day per car</label>' : '') + '</div>' : '') +
      warns.map(function (w) { return '<span class="msg warn">' + esc(w) + '</span>'; }).join('') +
      (anyManual ? '<span class="msg warn">This trip needs a custom quote. We\'ll send it to you by WhatsApp.</span>' : '') +
      '<div class="line-total trip-total"><span class="small">Trip ' + (ti + 1) + ' price' + (t.cars.length > 1 ? ' (' + t.cars.length + ' cars)' : '') + (holiday ? '<span class="badge">🏮 Lunar New Year rate (+50%)</span>' : '') + '</span><span class="amt">' + (anyManual ? 'Quote' : tripTotal == null ? '—' : fmt(tripTotal)) + '</span></div>' +
    '</section>';
  }

  function summaryHtml(q) {
    var rows = '';
    q.lines.forEach(function (l) {
      var t = S.trips[l.trip];
      rows += '<div class="muted"><span>Trip ' + (l.trip + 1) + (t.cars.length > 1 ? ' · Car ' + (l.car + 1) : '') + (t.date ? ' · ' + t.date : '') + '</span><span>' + (l.manual ? 'Quote' : l.ok ? fmt(l.total) : '—') + '</span></div>';
    });
    var ok = q.complete && q.lines.length;
    var conv = ok && window.onyxConvert ? window.onyxConvert(q.total) : '';
    return rows +
      '<div><span>Total' + (q.manual ? ' (excl. custom quote)' : '') + '</span><span class="total">' + (ok ? fmt(q.total) : '—') + '</span></div>' +
      (conv ? '<div class="muted"><span></span><span>' + esc(conv) + '</span></div>' : '') +
      '<div><span>Deposit (pay now)</span><span>' + (ok ? fmt(q.deposit) : '—') + '</span></div>' +
      '<div><span>Balance (cash to chauffeur)</span><span>' + (ok ? fmt(q.total - q.deposit) : '—') + '</span></div>';
  }
  function promoText(q) {
    if (!S.promo) return S.promoStale && S.promoCode ? { cls: 'warn', text: 'Your trip changed. Tap Apply to use your code again.' } : (S.promoMsg ? { cls: S.promoBad ? 'stop' : 'warn', text: S.promoMsg } : null);
    var parts = [];
    S.trips.forEach(function (t, ti) {
      if (t.svc === 'charter' && (!t.hrs || t.hrs === 'custom')) return;
      var ls = q.lines.filter(function (l) { return l.trip === ti; });
      var per = t.cars.length > 1 ? ' per car' : '';
      if (!ls.length) return;
      if (ls.some(function (l) { return l.freeHour; })) parts.push('Trip ' + (ti + 1) + ': +1 free hour' + per);
      else if (ls.some(function (l) { return l.discount > 0; })) parts.push('Trip ' + (ti + 1) + ': TWD ' + ls[0].discount + ' off' + per);
      else if (ls.some(function (l) { return l.promoNote === 'min'; })) parts.push('Trip ' + (ti + 1) + ': minimum spend not reached');
      else if (ls.every(function (l) { return l.ok || l.reason === 'route' || l.reason === 'vehicle'; }) && !P.promoApplies(S.promo, engineTrip(t), { vehicle: t.cars[0].vehicle || '' })) parts.push('Not valid for Trip ' + (ti + 1));
    });
    return { cls: 'ok', text: '✓ ' + S.promo.code + ' applied' + (parts.length ? ' · ' + parts.join(' · ') : '') };
  }

  // Chrome fires focusout when render() replaces the focused input; those events are ours, not the customer's
  var rendering = false;
  function render() {
    rendering = true;
    try { renderNow(); } finally { rendering = false; }
  }
  function renderNow() {
    var root = $('onyx-booking'); if (!root) return;
    var active = document.activeElement, aid = active && root.contains(active) ? active.id : null, caret = null;
    try { caret = active && active.selectionStart; } catch (e) { caret = null; }
    if (S.done) { root.innerHTML = doneHtml(); return; }
    S.trips.forEach(ensureRoute);
    var q = quote();
    var pm = promoText(q);
    root.innerHTML =
      '<p class="small">Need more than one vehicle? Use "Add another vehicle".</p>' +
      '<div id="obk-trips" style="display:flex;flex-direction:column;gap:20px">' + S.trips.map(function (t, ti) { return tripBlock(t, ti, q); }).join('') + '</div>' +
      '<div class="linkrow"><button class="addtrip" type="button" data-act="addtrip">+ Add another trip</button><button class="info" type="button" data-act="tripinfo" aria-label="About multi-day charters">i</button></div>' +
      '<div class="infobox" id="obk-tripinfo" hidden>Multi-day charters: we\'ll do our best to keep the same chauffeur. Nights away from your first pick-up city add TWD 1,500 per night for the chauffeur\'s stay.</div>' +
      '<section class="card" aria-label="Your details"><span class="step-label">Your details</span><div class="grid3">' +
        '<div class="field"><label for="obk-name">Name<span class="req">*</span></label><input id="obk-name" data-g="name" autocomplete="name" value="' + esc(S.name) + '"></div>' +
        '<div class="field"><label for="obk-phone">Phone / WhatsApp<span class="req">*</span></label><input id="obk-phone" data-g="phone" type="tel" placeholder="+65 9123 4567" autocomplete="tel" value="' + esc(S.phone) + '"><span class="hint">Use your WhatsApp number. We\'ll add you to a group chat with your chauffeur the day before your trip.</span></div>' +
        '<div class="field"><label for="obk-email">Email<span class="req">*</span></label><input id="obk-email" data-g="email" type="email" autocomplete="email" value="' + esc(S.email) + '"></div></div>' +
        '<div class="field"><label for="obk-remarks">Remarks</label><textarea id="obk-remarks" data-g="remarks" placeholder="e.g. lunch stop, oversized luggage, special requests">' + esc(S.remarks) + '</textarea></div></section>' +
      '<section class="card" aria-label="Payment"><span class="step-label">Payment</span>' +
        '<div class="field"><label for="obk-promo">Promo code</label><div class="promo"><input id="obk-promo" data-g="promoCode" autocomplete="off" value="' + esc(S.promoCode) + '"><button type="button" data-act="promo">Apply</button></div>' +
          (pm ? '<span class="msg ' + pm.cls + '">' + esc(pm.text) + '</span>' : '') + '</div>' +
        '<div class="summary">' + summaryHtml(q) + '</div>' +
        '<span class="small">Charged in TWD. Converted prices are for reference only.</span>' +
        '<div class="included small">✓ Tolls &amp; parking included · Free waiting time · Flight monitoring <button class="link" type="button" data-act="incl">What\'s included</button>' +
          '<ul id="obk-incl" hidden><li>All-inclusive fixed price – tolls, parking &amp; fuel included. No meter, no surprises.</li><li>Free waiting time – 60 min after landing for arrivals, 15 min for other pick-ups.</li><li>Flight monitoring – flight delayed? We adjust your pick-up at no extra cost.</li><li>Free cancellation 7+ days before pick-up.</li><li>Typhoon &amp; flight-cancellation protection – free reschedule or full refund.</li><li>Licensed &amp; insured vehicles, professional chauffeurs.</li><li>WhatsApp group chat with your chauffeur.</li><li>Child seats &amp; meet-and-greet name sign available.</li><li>Fluent English-speaking chauffeur option.</li><li>Prices shown in your currency.</li></ul></div>' +
        '<label class="check"><input type="checkbox" id="obk-terms" data-g="terms"' + (S.terms ? ' checked' : '') + '> <span>I agree to the <a href="#booking-terms" data-act="terms">Booking Terms</a><span class="req">*</span></span></label>' +
        (S.errors.length ? '<div class="formerr" role="alert">Please complete: ' + esc(S.errors.join(', ')) + '.</div>' : '') +
        '<button class="btn gold" type="button" data-act="submit"' + (S.submitting ? ' disabled' : '') + '>' + (S.submitting ? 'Sending…' : 'Book &amp; pay deposit') + '</button>' +
      '</section>';
    if (S.badIds) S.badIds.forEach(function (id) { var el = $(id); if (el) el.classList.add('bad'); });
    if (aid && $(aid)) { $(aid).focus(); try { if (caret != null) $(aid).setSelectionRange(caret, caret); } catch (e) { /* select elements */ } }
  }

  /* ---------------- events ---------------- */
  function tripOf(el) { var m = (el.id || el.dataset.addr || el.dataset.target || '').match(/^t(\d+)(?:c(\d+))?/); return m ? { t: S.trips[+m[1]], ti: +m[1], c: m[2] != null ? +m[2] : null } : null; }
  function setPoint(id, p) {
    var m = id.match(/^t(\d+)-(from|to|s(\d+))$/); if (!m) return;
    var t = S.trips[+m[1]];
    if (m[2] === 'from') t.from = p; else if (m[2] === 'to') t.to = p; else t.stops[+m[3]] = p;
  }
  function getPoint(id) {
    var m = id.match(/^t(\d+)-(from|to|s(\d+))$/); if (!m) return null;
    var t = S.trips[+m[1]];
    return m[2] === 'from' ? t.from : m[2] === 'to' ? t.to : t.stops[+m[3]];
  }
  function hasData(t) { return !!(t.dir || t.airport || t.flight || t.hrs || t.date || t.hh || t.mm || t.from.label || t.to.label || t.same || t.sign || t.eng || t.stops.some(function (s) { return s.label; })); }
  function switched(t, svc) { var nt = newTrip(); nt.svc = svc; nt.cars = t.cars.map(newCar); if (svc === 'charter') nt.stops = [pt()]; return nt; }
  function dropPromo() { if (S.promo) { S.promo = null; S.promoStale = true; } }
  function clearErrors() { S.errors = []; S.badIds = null; }

  var suggTimer = null, blurTimer = null;
  function onClick(e) {
    var b = e.target.closest('[data-act],[data-pick]'); if (!b) return;
    if (b.dataset.pick) {
      e.preventDefault();
      var s = S.sugg; if (!s) return;
      var item = s.items[+b.dataset.i], id = b.dataset.pick;
      S.sugg = null; clearTimeout(blurTimer);
      Maps.details(item).then(function (p) { if (p) { setPoint(id, p); render(); } });
      setPoint(id, pt(item.text)); render();
      return;
    }
    var act = b.dataset.act, ti = b.dataset.t != null ? +b.dataset.t : null, t = ti != null ? S.trips[ti] : null;
    if (act === 'info') { var box = document.querySelector('[data-info="t' + ti + '"]'); if (box) box.hidden = !box.hidden; return; }
    if (act === 'tripinfo') { $('obk-tripinfo').hidden = !$('obk-tripinfo').hidden; return; }
    if (act === 'incl') { $('obk-incl').hidden = !$('obk-incl').hidden; return; }
    if (act === 'terms') {
      e.preventDefault();
      // the terms live in the footer's collapsed "Booking Terms" panel: open it, then scroll to it
      var bt = document.getElementById('booking-terms'), acc = bt && bt.closest('#policy-accordion');
      if (acc && acc.classList.contains('hidden')) { if (window.toggleAccordion) window.toggleAccordion('policy-accordion'); else acc.classList.remove('hidden'); }
      if (bt) (acc || bt).scrollIntoView({ block: 'start' });
      return;
    }
    if (act === 'map') { if (window.initOrOpenMap) window.initOrOpenMap(b.dataset.target); return; }
    if (act === 'promo') { applyPromo(); return; }
    if (act === 'submit') { submit(); return; }
    clearErrors();
    if (act === 'svc') {
      if (t.svc === b.dataset.v) t.pending = null;
      else if (hasData(t)) t.pending = b.dataset.v;
      else { S.trips[ti] = switched(t, b.dataset.v); dropPromo(); }
    }
    if (act === 'svcyes') { S.trips[ti] = switched(t, t.pending); dropPromo(); }
    if (act === 'svcno') t.pending = null;
    if (act === 'dir') { t.dir = b.dataset.v; checkFlight(t); }
    if (act === 'hrs') { if (t.hrs !== b.dataset.v) dropPromo(); t.hrs = b.dataset.v; }
    if (act === 'car') t.cars[+b.dataset.c].vehicle = b.dataset.v;
    if (act === 'addstop') t.stops.push(pt());
    if (act === 'rmstop') t.stops.splice(+b.dataset.s, 1);
    if (act === 'addcar') t.cars.push(newCar());
    if (act === 'rmcar') t.cars.splice(+b.dataset.c, 1);
    if (act === 'rmtrip') S.trips.splice(ti, 1);
    if (act === 'addtrip') { S.trips.push(newTrip(S.trips[S.trips.length - 1])); render(); var cards = document.querySelectorAll('#obk-trips > .card'); cards[cards.length - 1].scrollIntoView({ block: 'start' }); return; }
    render();
    if (act === 'addstop') { var inp = $('t' + ti + '-s' + (t.stops.length - 1)); if (inp) inp.focus(); }
  }
  function onInput(e) {
    var el = e.target;
    if (el.dataset.g) { S[el.dataset.g] = el.type === 'checkbox' ? el.checked : el.value; return; }
    if (el.dataset.addr) {
      var id = el.dataset.addr, val = el.value;
      setPoint(id, pt(val));
      clearTimeout(suggTimer);
      if (val.trim().length < 3) { if (S.sugg) { S.sugg = null; render(); } return; }
      suggTimer = setTimeout(function () {
        Maps.suggest(val).then(function (items) {
          if (!$(id) || $(id).value !== val) return;
          S.sugg = { id: id, items: items, active: -1 }; render();
        });
      }, 250);
      return;
    }
    if (el.dataset.f === 'flight') { var tr = tripOf(el); if (tr) tr.t.flight = el.value; }
  }
  function onChange(e) {
    var el = e.target, f = el.dataset.f;
    if (el.dataset.g) { S[el.dataset.g] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.g === 'terms') { clearErrors(); render(); } return; }
    if (!f) return;
    var tr = tripOf(el); if (!tr) return;
    var t = tr.t;
    clearErrors();
    if (tr.c != null) { var c = t.cars[tr.c]; c[f] = el.type === 'checkbox' ? el.checked : el.value; }
    else if (f === 'flight') { t.flight = el.value; checkFlight(t); }
    else if (f === 'airport') { t.airport = el.value; checkFlight(t); }
    else if (f === 'date') { t.date = el.value; if (t.flight) checkFlight(t); }
    else if (el.type === 'checkbox') { t[f] = el.checked; if (f === 'same' && el.checked) t.to = pt(); }
    else t[f] = el.value;
    render();
  }
  function onFocusOut(e) {
    if (rendering) return;
    var el = e.target; if (!el.dataset || !el.dataset.addr) return;
    var id = el.dataset.addr;
    blurTimer = setTimeout(function () {
      if (S.sugg && S.sugg.id === id) { S.sugg = null; }
      var p = getPoint(id);
      if (p && p.label.trim() && !hasCoords(p)) {
        Maps.geocode(p.label.trim(), p.label.trim()).then(function (g) { if (g) { setPoint(id, g); } render(); });
      } else render();
    }, 200);
  }
  function onKey(e) {
    var el = e.target; if (!el.dataset || !el.dataset.addr || !S.sugg || S.sugg.id !== el.dataset.addr) return;
    var s = S.sugg;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); s.active = (s.active + (e.key === 'ArrowDown' ? 1 : -1) + s.items.length) % s.items.length; render(); }
    else if (e.key === 'Enter' && s.active >= 0) { e.preventDefault(); var li = document.querySelector('[data-pick="' + s.id + '"][data-i="' + s.active + '"]'); if (li) li.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    else if (e.key === 'Escape') { S.sugg = null; render(); }
  }

  /* ---------------- promo ---------------- */
  function applyPromo() {
    var code = (S.promoCode || '').trim().toUpperCase();
    S.promoStale = false; S.promoMsg = ''; S.promoBad = false;
    if (!code) { S.promo = null; render(); return; }
    if (!CFG.PROMO_GAS_URL) { S.promo = null; S.promoMsg = 'Promo codes are not available right now.'; S.promoBad = true; render(); return; }
    S.promoMsg = 'Checking…'; render();
    fetch(CFG.PROMO_GAS_URL + '?action=checkPromo&code=' + encodeURIComponent(code)).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.valid) { S.promo = null; S.promoMsg = res.message || 'This code is not valid.'; S.promoBad = true; }
      else { S.promo = { code: code, discountType: res.discountType, discountAmount: res.discountAmount, hasUpgrade: res.hasUpgrade, minSpend: res.minSpend, applicableService: res.applicableService, applicableVehicle: res.applicableVehicle }; S.promoMsg = ''; }
      render();
    }).catch(function () { S.promo = null; S.promoMsg = 'We couldn\'t check this code. Please try again.'; S.promoBad = true; render(); });
  }

  /* ---------------- validation + submit ---------------- */
  function validate() {
    var miss = [], bad = [];
    function need(ok, id, label) { if (!ok) { miss.push(label); if (id) bad.push(id); } }
    var q = quote();
    S.trips.forEach(function (t, ti) {
      var k = 't' + ti, T = (S.trips.length > 1 ? 'Trip ' + (ti + 1) + ' ' : '');
      if (t.svc === 'airport') {
        need(!!t.dir, k + '-dir', T + 'direction'); need(!!t.airport, k + '-ap', T + 'airport'); need(!!t.flight, k + '-fl', T + 'flight number');
        need(!(t.fres && t.fres.status === 'mismatch'), k + '-fl', T + 'flight and airport do not match');
        need(!(t.fres && t.fres.status === 'notfound') || t.fok, k + '-fl', T + 'confirm your flight number');
      }
      if (t.svc === 'charter') {
        need(!!t.hrs, k + '-hrs', T + 'duration');
        if (t.hrs !== 'custom') need(!!(t.stops[0] && t.stops[0].label.trim()), k + '-s0', T + 'at least 1 stop');
      }
      need(!!t.date, k + '-date', T + 'date');
      need(!!t.hh && !!t.mm, k + '-hh', T + 'time');
      var ahead = t.date && t.hh && t.mm ? hoursUntil(t) : null;
      need((!t.date || t.date >= minDate) && (ahead == null || ahead >= 48), k + '-date', T + 'date and time at least 48 hours ahead');
      if (!(t.svc === 'airport' && t.dir === 'arr')) need(!!t.from.label.trim(), k + '-from', T + 'pick-up address');
      if (!(t.svc === 'airport' && t.dir === 'dep') && !t.same) need(!!t.to.label.trim(), k + '-to', T + 'drop-off address');
      t.cars.forEach(function (c, ci) {
        var kk = k + 'c' + ci, C = T + (t.cars.length > 1 ? 'car ' + (ci + 1) + ' ' : '');
        need(!!c.vehicle, kk + '-cars', C + 'vehicle'); need(c.pax !== '', kk + '-pax', C + 'passengers');
        need(c.l28 !== '', kk + '-l28', C + '28" bags'); need(c.l20 !== '', kk + '-l20', C + '20" bags');
        if (c.kids) need(n0(c.inf) + n0(c.ch) > 0, kk + '-inf', C + 'number of child seats');
        if (c.vehicle) need(!P.capacityProblem(engineTrip(t).cars[ci]), kk + '-pax', C + 'fit passengers and luggage');
        var l = lineFor(q, ti, ci);
        if (l && l.reason === 'not-allowed') need(false, k + '-hrs', T + '8 hours (4 hours not available there)');
      });
      if (t.svc !== 'charter' || t.hrs !== 'custom') {
        var pts = enginePoints(t);
        var located = hasCoords(pts.from) && hasCoords(pts.to) && pts.stops.every(hasCoords);
        if ((t.from.label || t.to.label) && !located) need(false, null, T + 'choose addresses from the suggestions');
        if (located && t.route && t.route.status === 'loading') need(false, null, T + 'wait for the route to finish');
      }
    });
    need(!!S.name.trim(), 'obk-name', 'name');
    need(/^\+?[0-9\s\-()]{7,20}$/.test(S.phone.trim()), 'obk-phone', 'phone');
    need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(S.email.trim()), 'obk-email', 'email');
    need(S.terms, 'obk-terms', 'Booking Terms');
    S.errors = miss; S.badIds = bad;
    return !miss.length;
  }

  // ONYX-YYMMDD-NNNNN: NNNNN = position in the Taiwan day (00000-99999, one step = 0.864 s), so IDs never repeat
  function orderBaseId() {
    var now = Date.now() + 8 * 36e5, day = Math.floor(now / 864e5);
    var d = new Date(day * 864e5).toISOString().slice(2, 10).replace(/-/g, '');
    return 'ONYX-' + d + '-' + String(Math.floor((now - day * 864e5) / 864)).padStart(5, '0');
  }
  function serviceName(t) {
    if (t.svc === 'airport') return 'Airport Transfer - ' + (t.dir === 'arr' ? 'Arrival' : 'Departure') + ' (' + t.airport + ')';
    if (t.svc === 'city') return 'City Transfer';
    return 'Private Charter (' + (t.hrs === 'custom' ? 'Custom' : t.hrs + ' Hrs') + ')';
  }
  function detailsText(t, ti, c, ci, l, id, q) {
    var pts = enginePoints(t), lines = [];
    var add = function (k, v) { if (v !== '' && v != null) lines.push(k + ': ' + v); };
    add('Order', id); add('Order time', taipeiNow().date + ' ' + taipeiNow().time);
    add('Trip', 'Day ' + (ti + 1) + ' · Car ' + (ci + 1));
    add('Service', serviceName(t));
    if (t.svc === 'airport') { add('Airport', AP[t.airport].name); add('Flight', t.flight + (t.fres && t.fres.status === 'notfound' ? ' (not in schedule, customer confirmed)' : '')); }
    add(t.svc === 'airport' && t.dir === 'arr' ? 'Landing' : 'Date / time', t.date + ' ' + t.hh + ':' + t.mm);
    add('Pick-up', pts.from.label);
    pts.stops.forEach(function (s, i) { add('Stop ' + (i + 1), s.label); });
    add('Drop-off', t.same ? pts.from.label + ' (same as pick-up)' : pts.to.label);
    add('Vehicle', c.vehicle);
    add('Passengers', c.pax + ' (incl. children)');
    if (c.kids && (n0(c.inf) + n0(c.ch))) add('Seats', [n0(c.ch) ? n0(c.ch) + ' child seat' : '', n0(c.inf) ? n0(c.inf) + ' infant seat' : ''].filter(Boolean).join(', '));
    add('Luggage', n0(c.l28) + 'x28", ' + n0(c.l20) + 'x20"' + (n0(c.lst) ? ', ' + n0(c.lst) + ' stroller/wheelchair' : ''));
    var addOns = [];
    if (t.sign && t.svc === 'airport' && t.dir === 'arr') addOns.push('Meet & greet');
    if (t.eng && t.svc === 'charter') addOns.push('English chauffeur');
    if (t.svc !== 'charter' && P.isNight(t.hh + ':' + t.mm)) addOns.push('Late night');
    if (l && l.overnight) addOns.push('Chauffeur overnight');
    add('Add-ons', addOns.join(', '));
    if (t.route && t.route.status === 'ok') add('Distance', t.route.km + ' km');
    var flags = [];
    var h = hoursUntil(t); if (h != null && h < 72) flags.push('Short-notice');
    if (l && l.holiday) flags.push('Lunar New Year');
    if (l && l.manual) flags.push('Custom quote needed');
    add('Flags', flags.join(' / '));
    if (S.promo && l && (l.discount > 0 || l.freeHour)) add('Promo code', S.promo.code + (l.freeHour ? ' (+1 free hour)' : ''));
    if (l && l.ok) { add('Total', fmt(l.total)); add('Deposit', fmt(l.deposit)); add('Balance', fmt(l.total - l.deposit)); }
    else add('Total', 'Quote by ONYX');
    return lines.join('\n');
  }

  function postRow(fields) {
    if (!CFG.ORDER_GAS_URL) return Promise.resolve();
    var form = new FormData();
    Object.keys(fields).forEach(function (k) { form.append(k, fields[k]); });
    return fetch(CFG.ORDER_GAS_URL, { method: 'POST', body: form, mode: 'no-cors' }).catch(function () {});
  }

  function submit() {
    if (S.submitting) return;
    if (!validate()) { render(); var first = document.querySelector('.obk .bad'); if (first) first.scrollIntoView({ block: 'center' }); return; }
    S.submitting = true; render();
    var q = quote(), base = orderBaseId();
    var items = [];
    S.trips.forEach(function (t, ti) { t.cars.forEach(function (c, ci) { items.push({ t: t, ti: ti, c: c, ci: ci, l: lineFor(q, ti, ci) }); }); });
    items.sort(function (a, b) {
      var ka = a.t.date + ' ' + a.t.hh + a.t.mm, kb = b.t.date + ' ' + b.t.hh + b.t.mm;
      return ka < kb ? -1 : ka > kb ? 1 : (a.ti - b.ti) || (a.ci - b.ci);
    });
    items.forEach(function (it, i) { it.id = i === 0 ? base : base + '-' + (i + 1); });
    var created = new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour12: false });
    var rows = items.map(function (it) {
      var t = it.t, c = it.c, l = it.l, pts = enginePoints(t);
      var details = detailsText(t, it.ti, c, it.ci, l, it.id, q);
      return {
        'Order ID': it.id, 'Name': S.name, 'Phone': S.phone, 'Email': S.email, 'Service': serviceName(t),
        'Date': t.date + ' ' + t.hh + ':' + t.mm, 'Vehicle': c.vehicle, 'Pax': c.pax,
        'Luggage': n0(c.l28) + 'x 28", ' + n0(c.l20) + 'x 20"' + (n0(c.lst) ? ', ' + n0(c.lst) + 'x stroller/wheelchair' : ''),
        'Baby Seat': c.kids ? n0(c.inf) + 'x 0~2 yrs, ' + n0(c.ch) + 'x 3~4 yrs' : '0',
        'Pick-up Location': pts.from.label, 'Drop-off Location': t.same ? pts.from.label : pts.to.label,
        'Flight': t.svc === 'airport' ? t.flight : (t.flight || 'N/A'),
        'Itinerary': [t.itinerary, S.remarks].filter(Boolean).join('\n') || 'N/A',
        'Promo Code': S.promo && l && (l.discount > 0 || l.freeHour) ? S.promo.code : 'N/A',
        'Estimated Price': l && l.ok ? fmt(l.total) + (t.route && t.route.km ? ' (' + t.route.km + ' km)' : '') : 'To be quoted',
        'CreatedAt': created, 'Order Details': details, 'Payment Status': l && l.ok ? 'Unpaid' : 'Quote needed'
      };
    });
    var allDetails = rows.map(function (r) { return r['Order Details']; }).join('\n\n');
    var legacy = function (k) { var v = []; rows.forEach(function (r) { if (v.indexOf(String(r[k])) < 0) v.push(String(r[k])); }); return v.join(' | '); };
    var payable = q.complete && !q.manual && q.deposit > 0, tot = q.total, dep = q.deposit;
    var payLink = (CFG.PAY_PAGE_URL || '') + '?order=' + encodeURIComponent(base);
    var waLines = items.map(function (it) { return it.id + ' · ' + it.t.date + ' ' + it.t.hh + ':' + it.t.mm + ' · ' + serviceName(it.t) + ' · ' + it.c.vehicle; });
    var waText = function (tot, dep) {
      return 'Hi ONYX! My booking ' + base + '\nName: ' + S.name + '\n' + waLines.join('\n') +
        (tot != null ? '\nTotal: ' + fmt(tot) + ' · Deposit: ' + fmt(dep) : '');
    };
    var order = payload(base), reg = null;
    var chain = Promise.resolve();
    rows.forEach(function (r) { chain = chain.then(function () { return postRow(r); }); });
    chain.then(function () {
      if (!payable || !CFG.PAYMENT_GAS_URL) return null;
      return gasPost({ action: 'register', order: order }).then(function (r) { if (r && r.ok) reg = r; }).catch(function () { return null; });
    }).then(function () {
      // the payment GAS re-prices the order: its numbers are the ones charged and emailed
      if (reg) { tot = reg.total; dep = reg.deposit; }
      var linkOk = payable && !!reg;
      if (!CFG.FORMSUBMIT_URL) return null;
      return fetch(CFG.FORMSUBMIT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        _subject: 'Booking: ' + base, _cc: CFG.FORMSUBMIT_CC || '', _template: 'table', _webhook: CFG.MAKE_WEBHOOK || '',
        orderId: base, name: S.name, phone: S.phone, email: S.email, orderDetails: allDetails,
        total: linkOk ? tot : '', deposit: linkOk ? dep : '', balance: linkOk ? tot - dep : '',
        payLink: linkOk ? payLink : '', needsQuote: linkOk ? 'no' : 'yes', remarks: S.remarks, pricingVersion: q.version,
        // old field names, so the existing Make email keeps working (several trips/cars joined with " | ")
        serviceType: legacy('Service'), date: legacy('Date'), vehicle: legacy('Vehicle'), pax: legacy('Pax'), luggage: legacy('Luggage'),
        babySeat: legacy('Baby Seat'), pickupLocation: legacy('Pick-up Location'), dropoffLocation: legacy('Drop-off Location'),
        flightNumber: legacy('Flight'), itinerary: legacy('Itinerary'), souvenir: 'N/A', referral: S.promo ? S.promo.code : 'N/A',
        createdAt: created, estimatedPrice: linkOk ? fmt(tot) : 'To be quoted'
      }) }).catch(function () { return null; });
    }).then(function () {
      S.done = { id: base, q: { total: tot, deposit: dep }, payable: payable, reg: reg,
        wa: 'https://wa.me/' + (CFG.WHATSAPP || '886970326591') + '?text=' + encodeURIComponent(waText(payable ? tot : null, dep)) };
      S.submitting = false; render();
      var root = $('onyx-booking'); if (root) root.scrollIntoView({ block: 'start' });
      if (payable) startPayment();
    }).catch(function () {
      S.submitting = false; S.errors = ['your connection (sending failed, please try again)']; render();
    });
  }

  // What the payment GAS needs to re-check the price (no Google calls on the server)
  function payload(base) {
    return {
      orderId: base, promoCode: S.promo ? S.promo.code : '', contact: { name: S.name, phone: S.phone, email: S.email },
      trips: S.trips.map(function (t) {
        var e = engineTrip(t);
        if (e.route) e.route = { km: e.route.km, durationMin: e.route.durationMin, pointElev: e.route.pointElev, endElev: e.route.endElev, path: (e.route.path || []).map(function (p) { return [p.lat, p.lng]; }) };
        return e;
      })
    };
  }

  /* ---------------- success + PayPal ---------------- */
  function doneHtml() {
    var d = S.done, q = d.q;
    return '<section class="card" aria-label="Booking received"><span class="step-label">Booking received</span>' +
      '<p style="margin:0;font-size:15px">Order <b style="color:var(--gold)">' + esc(d.id) + '</b></p>' +
      (d.payable ? '<div class="summary"><div><span>Total</span><span class="total" id="obk-tot">' + fmt(q.total) + '</span></div><div><span>Deposit (pay now)</span><span id="obk-dep">' + fmt(q.deposit) + '</span></div><div><span>Balance (cash to chauffeur)</span><span id="obk-bal">' + fmt(q.total - q.deposit) + '</span></div></div>' +
        '<div id="obk-pay"><span class="hint">Loading secure payment…</span></div>'
        : '<p class="msg warn" style="margin:0">Part of your booking needs a custom quote. We\'ll send the price and a payment link by WhatsApp and email.</p>') +
      '<div><b>Staying in touch</b><ol class="touch"><li>Save our WhatsApp: +886 970 326 591</li><li>The day before your trip, we\'ll open a group chat with your chauffeur.</li><li>All trip updates happen in that group.</li></ol></div>' +
      '<a class="btn wa" href="' + esc(d.wa) + '" target="_blank" rel="noopener">WhatsApp us</a>' +
      '<button class="link" type="button" onclick="location.reload()">Book another trip</button>' +
    '</section>';
  }
  function gasPost(body) {
    return fetch(CFG.PAYMENT_GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function payFallback(msg) {
    var box = $('obk-pay'); if (!box) return;
    box.innerHTML = '<p class="msg warn" style="margin:0">' + esc(msg || 'We\'ll email you a secure payment link shortly.') + '</p>';
  }
  function loadPayPal() {
    if (window.paypal) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(CFG.PAYPAL_CLIENT_ID) + '&currency=TWD&intent=capture&components=buttons';
      s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }
  function startPayment() {
    var d = S.done;
    if (!CFG.PAYMENT_GAS_URL || !CFG.PAYPAL_CLIENT_ID || !d.reg) { payFallback('We\'ll send you a secure payment link by WhatsApp shortly.'); return; }
    loadPayPal().then(function () {
      var box = $('obk-pay'); if (!box) return;
      box.innerHTML = '<div id="obk-paypal"></div>';
      window.paypal.Buttons({
        style: { color: 'gold', shape: 'rect', label: 'pay' },
        createOrder: function () { return gasPost({ action: 'create', orderId: d.id }).then(function (r) { if (!r.ok) throw new Error(r.error || 'create'); return r.paypalOrderId; }); },
        onApprove: function (data) {
          return gasPost({ action: 'capture', orderId: d.id, paypalOrderId: data.orderID }).then(function (r) {
            location.href = (r && r.ok ? CFG.SUCCESS_URL : CFG.FAIL_URL) + '?order=' + encodeURIComponent(d.id);
          });
        },
        onError: function () { location.href = CFG.FAIL_URL + '?order=' + encodeURIComponent(d.id); }
      }).render('#obk-paypal');
    }).catch(function () { payFallback('We\'ll email you a secure payment link shortly.'); });
  }

  /* ---------------- public API ---------------- */
  window.ONYX_BOOKING = {
    // map picker modal → address
    setAddress: function (inputId, label, lat, lng) { setPoint(inputId, pt(label, lat, lng)); render(); },
    // itinerary "Book" buttons on the page
    prefillItinerary: function (item) {
      var t = newTrip(); t.svc = 'charter';
      t.itinerary = 'Itinerary No.' + String(item.id).padStart(2, '0') + ' ' + item.title_en;
      if (item.day === 1 && SPOTS[item.id]) {
        t.hrs = '8'; t.same = true;
        t.stops = SPOTS[item.id].map(function (s) { return pt(s[0], s[1], s[2]); });
      } else {
        t.hrs = 'custom';
        S.remarks = t.itinerary + ' (' + item.day + ' days)\n' + item.spots.join('\n');
      }
      t.cars = S.trips[0] ? S.trips[0].cars.map(newCar) : [newCar()];
      S.trips = [t]; clearErrors(); dropPromo(); render();
    },
    applyPromoCode: function (code) { S.promoCode = code; applyPromo(); },
    _state: S
  };

  function init() {
    var root = $('onyx-booking'); if (!root) return;
    root.classList.add('obk');
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('keydown', onKey);
    root.addEventListener('mousedown', function (e) { if (e.target.closest('[data-pick]')) e.preventDefault(); });
    F.load(CFG.FLIGHTDB_URL);
    render();
    var qs = new URLSearchParams(location.search);
    var ref = qs.get('ref') || qs.get('promo');
    if (ref) window.ONYX_BOOKING.applyPromoCode(ref);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
