/*
 * ONYX booking form (preview). Renders into #onyx-booking.
 * Needs: js/onyx-pricing.js (ONYX_PRICING), js/onyx-flight.js (ONYX_FLIGHT),
 *        window.ONYX_BOOKING_CONFIG, Google Maps JS (loading=async, callback calls onyxMapsReady; loaded on demand via window.onyxLoadMaps).
 */
(function () {
  'use strict';
  var P = window.ONYX_PRICING, F = window.ONYX_FLIGHT;
  // online deposit payment (PayPal) is off until ONLINE_PAYMENT is true in onyx-config.js; then you send deposit links yourself
  var ONLINE = function () { return !!(window.ONYX_SETTINGS && window.ONYX_SETTINGS.ONLINE_PAYMENT); };
  // oversized items (Premium Van only): fixed items, plus two "other" items the customer measures
  var OVS = [['str', 'Stroller'], ['whc', 'Wheelchair'], ['wide', 'Extra-wide suitcase'], ['golf', 'Golf bag']];
  var OTH = ['o1', 'o2', 'o3', 'o4'], OTHF = ['n', 'l', 'w', 'h'];
  function carData(c, vehicle) {
    var d = { vehicle: vehicle || c.vehicle, pax: n0(c.pax), l28: n0(c.l28), l20: n0(c.l20), inf: c.kids ? n0(c.inf) : 0, ch: c.kids ? n0(c.ch) : 0 };
    OVS.forEach(function (o) { d[o[0]] = c.ovs ? n0(c[o[0]]) : 0; });
    OTH.forEach(function (o) { OTHF.forEach(function (f) { d[o + f] = c.ovs ? n0(c[o + f]) : 0; }); });
    return d;
  }
  function othUnitsEach(c, o) { return P.otherUnits(1, n0(c[o + 'l']), n0(c[o + 'w']), n0(c[o + 'h'])); }
  function ovsText(c, sep) {
    if (!c.ovs) return [];
    return OVS.filter(function (o) { return n0(c[o[0]]); }).map(function (o) { return n0(c[o[0]]) + sep + o[1].toLowerCase(); })
      .concat(OTH.filter(function (o) { return n0(c[o + 'n']); }).map(function (o, i) {
        return n0(c[o + 'n']) + sep + 'other ' + o.slice(1) + ' (' + n0(c[o + 'l']) + '×' + n0(c[o + 'w']) + '×' + n0(c[o + 'h']) + ' cm = ' + n0(c[o + 'n']) * othUnitsEach(c, o) + ' × 28-inch)';
      }));
  }
  var CFG = window.ONYX_BOOKING_CONFIG || {};
  CFG.GAS_URL = CFG.GAS_URL || CFG.PAYMENT_GAS_URL || '';   // the ONYX GAS (orders, promo codes, payments)
  var VEHICLES = ['Standard', 'Premium Car', 'Premium Van', 'Luxury'];
  // card photo + models (models are examples; the exact car is not guaranteed)
  var FLEET = {
    'Standard': { img: 'standard', models: 'Toyota RAV4, Honda CR-V' },
    'Premium Car': { img: 'premium-suv', models: 'Benz GLB, Lexus ES/NX, Tesla Model Y' },
    'Premium Van': { img: 'premium-van', models: 'Benz Vito, VW T6.1' },
    'Luxury': { img: 'luxury', models: 'Toyota Alphard, Benz V-Class' }
  };
  var AP = P.GEO.airports;
  var SVC = { airport: 'Airport Transfer', city: 'City Transfer', charter: 'Private Charter' };
  var MAXSTOPS = { airport: 3, city: 3, charter: 6 };

  // Itineraries: js/onyx-tours.js (window.ONYX_TOURS), built from the tours source on the owner's PC.
  // Each tour has days of stops [label, lat, lng] and options (where the guest stays) that say how the days start and end.
  function tourOf(id) { var L = window.ONYX_TOURS || []; for (var i = 0; i < L.length; i++) if (L[i].id === Number(id)) return L[i]; return null; }
  function addDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }

  /* ---------------- state ---------------- */
  var uid = 0;
  function pt(label, lat, lng) { return { label: label || '', lat: typeof lat === 'number' ? lat : null, lng: typeof lng === 'number' ? lng : null }; }
  function newCar(src) {
    var c = src ? { vehicle: src.vehicle, pax: src.pax, l28: src.l28, l20: src.l20, ovs: src.ovs, othN: src.othN || 1, kids: src.kids, inf: src.inf, ch: src.ch }
                : { vehicle: null, pax: '', l28: '', l20: '', ovs: false, othN: 1, kids: false, inf: '0', ch: '0' };
    OVS.forEach(function (o) { c[o[0]] = src ? src[o[0]] : '0'; });
    OTH.forEach(function (o) { OTHF.forEach(function (f) { c[o + f] = src ? src[o + f] : (f === 'n' ? '0' : ''); }); });
    return c;
  }
  function newTrip(prev) {
    var t = { id: ++uid, svc: 'airport', dir: null, airport: '', flight: '', fres: null, fok: false, hrs: null,
      date: '', hh: '', mm: '', from: pt(), to: pt(), same: false, plan: false, stops: [], sign: false, signText: '', eng: false, notes: '',
      cars: [newCar()], route: null, pending: null, itinerary: '' };
    if (prev) {
      t.svc = null;   // the customer picks the service for each added trip
      t.cars = prev.cars.map(newCar);
      var hotel = prev.svc === 'airport' ? (prev.dir === 'arr' ? prev.to : prev.from) : (prev.same ? prev.from : prev.to);
      if (hotel && hotel.label) t.from = pt(hotel.label, hotel.lat, hotel.lng);
    }
    return t;
  }
  var S = { trips: [newTrip()], promoCode: '', promo: null, promoStale: false, promoMsg: '', promoBad: false,
    name: '', phone: '', email: '', website: '', remarks: '', terms: false, errors: [], submitting: false, done: null, sugg: null, cal: null, open: {}, sheet: false };

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
  var maxDate = (function () { var d = new Date(Date.parse(taipeiNow().date + 'T00:00:00Z') + 365 * 864e5); return d.toISOString().slice(0, 10); })();
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function ymd(y, m, d) { return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function niceDate(iso) { var d = new Date(iso + 'T00:00:00Z'); return WD[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  var CAL_ICON = '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
  // month calendar: days before the 48-hour limit or more than a year ahead cannot be chosen
  function calHtml(t, ti) {
    var y = S.cal.y, m = S.cal.m, first = new Date(Date.UTC(y, m, 1)).getUTCDay(), days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var today = taipeiNow().date, prevOk = ymd(y, m, 1) > minDate, nextOk = ymd(y, m, days) < maxDate;
    var cells = '', holInMonth = false;
    for (var i = 0; i < first; i++) cells += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var iso = ymd(y, m, d), off = iso < minDate || iso > maxDate, hol = P.holidayOf(iso);
      if (hol && !off) holInMonth = true;
      cells += '<button type="button" data-act="day" data-t="' + ti + '" data-v="' + iso + '"' + (off ? ' disabled' : '') +
        ' class="' + (iso === t.date ? 'sel ' : '') + (iso === today ? 'today ' : '') + (hol && !off ? 'hol' : '') + '"' +
        ' aria-label="' + niceDate(iso) + (hol ? ' · ' + hol.label + ' rate' : '') + '"' + (iso === t.date ? ' aria-current="date"' : '') + '>' + d + '</button>';
    }
    return '<div class="cal" role="dialog" aria-label="Choose a date">' +
      '<div class="calhead"><button type="button" data-act="calnav" data-t="' + ti + '" data-v="-1" aria-label="Previous month"' + (prevOk ? '' : ' disabled') + '>‹</button>' +
      '<b>' + MONTHS[m] + ' ' + y + '</b><button type="button" data-act="calnav" data-t="' + ti + '" data-v="1" aria-label="Next month"' + (nextOk ? '' : ' disabled') + '>›</button></div>' +
      '<div class="calgrid">' + WD.map(function (w) { return '<span class="wd">' + w.slice(0, 2) + '</span>'; }).join('') + cells + '</div>' +
      '<span class="calnote">' + (holInMonth ? '<i class="holdot"></i> Lunar New Year rate (+50%) · ' : '') + 'Book at least 48 hours ahead</span></div>';
  }

  function planOpenOf(t) { return t.svc === 'charter' && !!t.plan && t.hrs !== 'custom'; }
  function enginePoints(t) {
    var from = t.from, to = t.same ? t.from : t.to;
    if (t.svc === 'airport' && t.airport) {
      var a = AP[t.airport], ap = pt(a.name, a.lat, a.lng);
      if (t.dir === 'arr') from = ap; else if (t.dir === 'dep') to = ap;
    }
    return { from: from, to: to, stops: t.svc === 'charter' && t.plan ? [] : t.stops.filter(function (s) { return s.label.trim(); }) };
  }
  function hasCoords(p) { return p && typeof p.lat === 'number' && typeof p.lng === 'number'; }
  function routeReady(t) {
    if (!t.svc) return false;
    if (t.svc === 'airport' && (!t.dir || !t.airport)) return false;
    if (t.svc === 'charter' && !t.hrs) return false;
    var pts = enginePoints(t);
    return hasCoords(pts.from) && hasCoords(pts.to) && pts.stops.every(hasCoords);
  }
  function engineTrip(t) {
    return { svc: t.svc, dir: t.dir, airport: t.airport, hrs: t.hrs, date: t.date, time: t.hh && t.mm ? t.hh + ':' + t.mm : '',
      points: enginePoints(t), route: t.route && t.route.status === 'ok' ? t.route : null, sign: t.sign, eng: t.eng,
      planOpen: t.svc === 'charter' && !!t.plan,
      cars: t.cars.map(function (c) { return carData(c); }) };
  }
  function quote() { return P.quoteOrder({ trips: S.trips.map(engineTrip), promo: S.promo }); }
  function lineFor(q, ti, ci) { for (var i = 0; i < q.lines.length; i++) if (q.lines[i].trip === ti && q.lines[i].car === ci) return q.lines[i]; return null; }

  /* ---------------- Google Maps wrapper (new APIs, legacy fallback) ---------------- */
  var mapsReady = new Promise(function (resolve) {
    if (window.google && google.maps && google.maps.importLibrary) resolve();
    else window.onyxMapsReady = resolve;
  });
  // the page loads Google Maps on demand (window.onyxLoadMaps); ask for it the first time a map service is needed
  function maps() { if (window.onyxLoadMaps) window.onyxLoadMaps(); return mapsReady; }
  function ll(p) { return typeof p.lat === 'function' ? { lat: p.lat(), lng: p.lng() } : { lat: Number(p.lat), lng: Number(p.lng) }; }
  function sample(path, max) {
    if (path.length <= max) return path;
    var step = path.length / max, out = [];
    for (var i = 0; i < max; i++) out.push(path[Math.floor(i * step)]);
    out.push(path[path.length - 1]);
    return out;
  }
  // Google result that is only an area (city, district, township, county, postcode): not precise enough to price or to find you
  var AREA_TYPES = ['country', 'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3', 'administrative_area_level_4',
    'administrative_area_level_5', 'locality', 'postal_code', 'postal_town', 'colloquial_area', 'political', 'geocode'];
  function isArea(types) { return !!(types && types.length) && types.every(function (x) { return AREA_TYPES.indexOf(String(x).toLowerCase()) >= 0; }); }
  var Maps = {
    route: function (points) {
      return maps().then(function () {
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
      return maps().then(function () { return google.maps.importLibrary('elevation'); }).then(function (lib) {
        var svc = new lib.ElevationService();
        return svc.getElevationForLocations({ locations: points });
      }).then(function (r) {
        var res = r && (r.results || r);
        if (!res || !res.length) return null;
        var el = res.map(function (x) { return x.elevation; });
        return { max: Math.max.apply(null, el), end: el[el.length - 1], all: el };   // highest point, the drop-off, and each point
      }).catch(function () { return null; });     // no elevation = no mountain surcharge (never blocks)
    },
    token: null,
    suggest: function (text) {
      return maps().then(function () { return google.maps.importLibrary('places'); }).then(function (lib) {
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
        return place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName', 'types'] }).then(function () {
          var name = place.displayName || '', addr = place.formattedAddress || '';
          var p = pt(name && addr.indexOf(name) < 0 ? name + ', ' + addr : (addr || name), place.location.lat(), place.location.lng());
          if (isArea(place.types)) p.vague = true;
          return p;
        });
      }
      return Maps.geocode({ placeId: item.placeId }, item.text);
    },
    geocode: function (req, label) {
      return maps().then(function () {
        return new Promise(function (resolve) {
          new google.maps.Geocoder().geocode(typeof req === 'string' ? { address: req, region: 'tw' } : req, function (r, s) {
            if (s === 'OK' && r[0]) { var p = pt(label || r[0].formatted_address, r[0].geometry.location.lat(), r[0].geometry.location.lng()); if (isArea(r[0].types)) p.vague = true; resolve(p); }
            else resolve(null);
          });
        });
      });
    }
  };

  /* ---------------- route + elevation per trip ---------------- */
  function routeKey(t) {
    var pts = enginePoints(t), list = [pts.from].concat(pts.stops, [pts.to]);
    return t.svc + (t.svc === 'charter' && t.plan ? '+plan' : '') + '|' + list.map(function (p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }).join(';');
  }
  function ensureRoute(t) {
    if (!routeReady(t)) { if (t.route && t.route.status !== 'loading') t.route = null; return; }
    var key = routeKey(t);
    if (t.route && t.route.key === key && !(t.route.status === 'fail' && Date.now() - t.route.at > 15000)) return;
    t.route = { key: key, status: 'loading' };
    var pts = enginePoints(t), list = [pts.from].concat(pts.stops, [pts.to]).map(function (p) { return { lat: p.lat, lng: p.lng }; });
    if (t.svc === 'charter' && t.plan && P.distKm(pts.from, pts.to) < 0.5) {
      Maps.pointElevation(list).then(function (e) {
        if (!t.route || t.route.key !== key) return;
        t.route = { key: key, status: 'ok', km: 0, durationMin: 0, path: [list[0], list[1]], pointElev: e ? Math.round(e.max) : null, endElev: e ? Math.round(e.end) : null, elevs: e ? e.all.map(function (x) { return Math.round(x); }) : null };
      }).then(function () { render(); });
      return;
    }
    Maps.route(list).then(function (r) {
      if (!t.route || t.route.key !== key) return null;
      // 150 rounded points: exactly what the payment GAS receives, so both price the same path
      var path = sample(r.path, 150).map(function (p) { return { lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 }; });
      var base = { key: key, status: 'ok', km: Math.round(r.km * 10) / 10, durationMin: Math.round(r.durationMin), path: path, pointElev: null, endElev: null, elevs: null };
      return Maps.pointElevation(list).then(function (e) {
        if (e) { base.pointElev = Math.round(e.max); base.endElev = Math.round(e.end); base.elevs = e.all.map(function (x) { return Math.round(x); }); }
        return base;
      });
    }).then(function (done) {
      if (done && t.route && t.route.key === key) t.route = done;
    }, function () {
      if (t.route && t.route.key === key) t.route = { key: key, status: 'fail', at: Date.now() };
    }).then(function () { render(); });   // a display problem can never turn a good route into a failed one
  }

  /* ---------------- flight ---------------- */
  function checkFlight(t) {
    t.fres = null; t.fok = false;
    var raw = (t.flight || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    t.flight = raw;
    if (!raw || t.svc !== 'airport') return;
    F.load(CFG.FLIGHTDB_URL).then(function () {
      if (t.flight !== raw) return;   // the guest typed another flight meanwhile
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
  // Google Maps blocked or not loading (ad blocker, firewall, very slow network): addresses can't be found, so offer WhatsApp
  function mapsDownHtml() {
    var wa = 'https://wa.me/' + (CFG.WHATSAPP || '886970326591') + '?text=' + encodeURIComponent('Hi ONYX! I\'d like to book a ride. The address search on your website isn\'t loading for me.');
    return '<div class="infobox mapsdown" role="alert"><p>Address search isn\'t loading on your network. Message us on WhatsApp and we\'ll book your ride for you.</p>' +
      '<a class="btn wa" href="' + esc(wa) + '" target="_blank" rel="noopener">Book on WhatsApp</a></div>';
  }
  var VAGUE_MSG = 'Choose an exact hotel, address or landmark.';
  function addrField(id, p, placeholder, extraAttr) {
    var s = S.sugg && S.sugg.id === id ? S.sugg : null;
    return '<div class="addr"><input id="' + id + '" data-addr="' + id + '" autocomplete="off" placeholder="' + esc(placeholder) + '" value="' + esc(p.label) + '"' + (extraAttr || '') + (p.vague ? ' class="bad" aria-invalid="true" aria-describedby="' + id + '-vague"' : '') + '>' +
      (p.vague ? '<span class="msg stop vague" id="' + id + '-vague">' + VAGUE_MSG + '</span>' : '') +
      (s && s.items.length ? '<ul class="sugg" role="listbox">' + s.items.map(function (it, i) {
        return '<li role="option" data-pick="' + id + '" data-i="' + i + '" aria-selected="' + (i === s.active) + '">' + esc(it.text) + '</li>'; }).join('') + '</ul>' : '') +
      '</div><button class="mapbtn" type="button" data-act="map" data-target="' + id + '" aria-label="Pick on map">⌖</button>';
  }
  // biggest vehicle: the limits used before a vehicle is chosen
  var MAXCAP = VEHICLES.reduce(function (m, v) { var c = P.capacityOf(v); return { pax: Math.max(m.pax, c.pax), bags: Math.max(m.bags, c.bags), seats: Math.max(m.seats, c.seats) }; }, { pax: 0, bags: 0, seats: 0 });
  function bagText(n) { return (Math.round(n * 10) / 10) + ' × 28-inch'; }
  // "too small" = passengers, luggage, seats or oversized items; the adult-on-board rule is about passengers, not the car
  function fitsIn(v, c) { var pr = P.capacityProblem(carData(c, v)); return !pr || /^An adult/.test(pr); }
  function carBlock(t, ti, c, ci, q) {
    var k = 't' + ti + 'c' + ci, multi = t.cars.length > 1, cap = P.capacityOf(c.vehicle) || MAXCAP;
    var line = lineFor(q, ti, ci);
    var ready = routeReady(t) && t.route && t.route.status === 'ok';
    var cards = VEHICLES.map(function (v) {
      var price = null;
      if (ready) {
        var qq = P.quoteCar(engineTrip(t), { vehicle: v, pax: n0(c.pax), l28: 0, l20: 0, inf: 0, ch: 0 }, { promo: null, overnightNights: 0 });
        if (qq.ok) price = qq.total;
      }
      var cp = P.capacityOf(v), fits = c.vehicle === v || fitsIn(v, c);
      return '<button class="car" type="button" aria-pressed="' + (c.vehicle === v) + '"' + (fits ? '' : ' aria-disabled="true" title="Too small for your group"') + ' data-act="car" data-t="' + ti + '" data-c="' + ci + '" data-v="' + v + '">' +
        '<img class="carimg" src="' + (CFG.FLEET_IMG_DIR || 'images/fleet/') + FLEET[v].img + '.webp" alt="" width="240" height="135" loading="lazy">' +
        '<span class="name">' + v + '</span><span class="models">' + FLEET[v].models + ' or equivalent</span><span class="cap">' + cp.pax + ' passengers<br>' + cp.bags + ' × 28-inch suitcases</span>' +
        '<span class="price' + (price == null || !fits ? ' wait' : '') + '">' + (!fits ? 'Too small' : price == null ? '—' : fmt(price)) + '</span></button>';
    }).join('');
    // luggage: what is still free decides each list (2 × 20-inch = 1 × 28-inch, each oversized item = 2 × 28-inch)
    var LU = P.CONFIG.luggage, cd = carData(c);
    var u28 = n0(c.l28), u20 = n0(c.l20) / 2, ust = P.oversizedUnits(cd);
    var max28 = Math.max(n0(c.l28), Math.floor(cap.bags - u20 - ust + 1e-9));
    var max20 = Math.max(n0(c.l20), Math.floor((cap.bags - u28 - ust) * 2 + 1e-9));
    var left = cap.bags - u28 - u20 - ust;
    var vanOk = !c.vehicle || LU.oversizedVehicles.indexOf(c.vehicle) >= 0;
    var maxOv = function (f, u) { return vanOk ? n0(c[f]) + Math.max(0, Math.floor(left / u + 1e-9)) : n0(c[f]); };
    var seatsLeft = c.pax === '' ? cap.seats : Math.min(cap.seats, Math.max(0, n0(c.pax) - 1));
    var maxInf = Math.max(n0(c.inf), seatsLeft - n0(c.ch)), maxCh = Math.max(n0(c.ch), seatsLeft - n0(c.inf));
    // vehicles that are too small are greyed out, so only the adult rule can still show here
    var problem = c.vehicle ? P.capacityProblem(engineTrip(t).cars[ci]) : null;
    if (problem && !/^An adult/.test(problem)) problem = null;
    var bagHint = esc((c.vehicle ? c.vehicle : 'Largest vehicle') + ': ' + cap.pax + ' passengers, ') + '<span class="nw">' + esc(bagText(cap.bags)) + '.</span>';
    var seatHint = (t.svc === 'charter' ? 'Free on charters' : 'TWD 200 each') + ' · Max ' + cap.seats + (c.vehicle ? ' in ' + c.vehicle : '') + ' · An adult must ride along.';
    return '<div class="' + (multi ? 'vehicle' : 'step') + '">' +
      (multi ? '<div class="head"><b>Vehicle ' + (ci + 1) + '</b>' + (ci > 0 ? '<button class="rm" type="button" data-act="rmcar" data-t="' + ti + '" data-c="' + ci + '">Remove</button>' : '') + '</div>' : '') +
      '<div class="step"><span class="step-label">Vehicle<span class="req">*</span></span><div class="cars" role="group" aria-label="Vehicle" id="' + k + '-cars">' + cards + '</div></div>' +
      '<div class="step"><span class="step-label">Passengers &amp; luggage</span><div class="row-pax">' +
        '<div class="field"><label for="' + k + '-pax">Passengers <span class="nw">(incl. children)<span class="req">*</span></span></label><select id="' + k + '-pax" data-f="pax" class="' + (c.pax === '' ? 'empty' : '') + '">' + opts(1, Math.max(cap.pax, n0(c.pax)), c.pax, true) + '</select></div>' +
        '<div class="field"><label for="' + k + '-l28">28-inch suitcases<span class="req">*</span></label><select id="' + k + '-l28" data-f="l28" class="' + (c.l28 === '' ? 'empty' : '') + '">' + opts(0, max28, c.l28, true) + '</select></div>' +
        '<div class="field"><label for="' + k + '-l20">20-inch suitcases<span class="req">*</span></label><select id="' + k + '-l20" data-f="l20" class="' + (c.l20 === '' ? 'empty' : '') + '">' + opts(0, max20, c.l20, true) + '</select></div>' +
      '</div><span class="hint">' + bagHint + ' <span class="nw">(2 × 20-inch = 1 × 28-inch.)</span></span>' +
      '<label class="check' + (vanOk && c.vehicle ? '' : ' off') + '"><input type="checkbox" id="' + k + '-ovs" data-f="ovs"' + (c.ovs ? ' checked' : '') + (vanOk && c.vehicle ? '' : ' disabled') + '> <span>Oversized items <span class="nw">(need a Premium Van)</span></span></label>' +
      (c.ovs ? '<div class="kids"><div class="grid ovs">' + OVS.map(function (o) {
          return '<div class="field"><label for="' + k + '-' + o[0] + '">' + o[1] + '</label><select id="' + k + '-' + o[0] + '" data-f="' + o[0] + '">' + opts(0, maxOv(o[0], LU.units[o[0]]), c[o[0]], false) + '</select></div>';
        }).join('') + '</div>' + OTH.slice(0, c.othN || 1).map(function (o, oi) {
          var u = othUnitsEach(c, o), dims = ['l', 'w', 'h'].map(function (f, i) {
            var nm = ['Length', 'Width', 'Height'][i];
            return '<div class="field"><label for="' + k + '-' + o + f + '">' + nm + ' (cm)</label><input id="' + k + '-' + o + f + '" data-f="' + o + f + '" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" value="' + esc(c[o + f]) + '"></div>';
          }).join('');
          return '<div class="othrow"><div class="field"><label for="' + k + '-' + o + 'n">Other ' + o.slice(1) + '</label><select id="' + k + '-' + o + 'n" data-f="' + o + 'n">' + opts(0, maxOv(o + 'n', u), c[o + 'n'], false) + '</select></div>' + dims +
            '<div class="othfoot">' + (n0(c[o + 'n']) ? '<span class="othu">= ' + n0(c[o + 'n']) * u + ' × 28-inch</span>' : '') +
            (oi > 0 && oi === (c.othN || 1) - 1 ? '<button class="link" type="button" data-act="rmoth" data-t="' + ti + '" data-c="' + ci + '">Remove</button>' : '') + '</div></div>';
        }).join('') +
        ((c.othN || 1) < OTH.length ? '<div class="linkrow"><button class="link" type="button" data-act="addoth" data-t="' + ti + '" data-c="' + ci + '">+ Add another item</button></div>' : '') +
        '<span class="hint">Counted in 28-inch suitcases: stroller 2, wheelchair 3, extra-wide suitcase 2, golf bag 2. Other: enter the size in cm (at least 2).</span></div>' : '') +
      '<label class="check"><input type="checkbox" id="' + k + '-kids" data-f="kids"' + (c.kids ? ' checked' : '') + '> Traveling with children aged 0–4</label>' +
      (c.kids ? '<div class="kids"><span class="lawnote">By law, children aged 0–4 need a child seat.</span><div class="grid">' +
        '<div class="field"><label for="' + k + '-inf">Rear-facing seat <span class="nw">(under 2)</span></label><select id="' + k + '-inf" data-f="inf">' + opts(0, maxInf, c.inf, false) + '</select></div>' +
        '<div class="field"><label for="' + k + '-ch">Child seat <span class="nw">(ages 2–4)</span></label><select id="' + k + '-ch" data-f="ch">' + opts(0, maxCh, c.ch, false) + '</select></div>' +
        '</div><span class="hint">' + esc(seatHint) + '</span></div>' : '') +
      (problem ? '<span class="msg stop">' + esc(problem) + '</span>' : '') +
      (ci === t.cars.length - 1 ? '<button class="link" type="button" data-act="addcar" data-t="' + ti + '">Need more space? + Add a vehicle</button>' : '') +
      '</div>' +
      (multi ? '<div class="line-total"><span class="small">Vehicle ' + (ci + 1) + (c.vehicle ? ' · ' + c.vehicle : '') + '</span><span class="amt">' + (line && line.ok ? fmt(line.total) : '—') + '</span></div>' : '') +
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
    if (!t.svc) {
      return '<section class="card" aria-label="Trip ' + (ti + 1) + '">' +
        '<div class="head"><span><b>Trip ' + (ti + 1) + '</b></span>' + (ti > 0 ? '<button class="rm" type="button" data-act="rmtrip" data-t="' + ti + '">Remove trip</button>' : '') + '</div>' +
        '<div class="step"><span class="step-label">Service<span class="req">*</span></span><div class="tabs" role="group" aria-label="Service" id="' + k + '-svc">' + tabs + '</div>' +
        '<span class="hint">Choose a service for Trip ' + (ti + 1) + '.</span></div></section>';
    }
    var fr = t.fres, fmsg = '';
    if (fr && fr.status === 'ok') fmsg = '<span class="msg ok">✓ ' + esc(t.flight) + (fr.airline ? ' · ' + esc(fr.airline) : '') + (fr.time ? ' · scheduled ' + (arr ? 'landing ' : 'departure ') + fr.time : '') + '</span>';
    else if (fr && fr.status === 'mismatch') fmsg = '<span class="msg stop">' + esc(t.flight) + (dep ? ' departs from ' : ' lands at ') + esc(AP[fr.actual] ? AP[fr.actual].name : fr.actual) + ', not ' + esc(apName) + '. Check the airport.</span>';
    else if (fr && fr.status === 'notfound') fmsg = '<span class="msg warn">We can\'t find ' + esc(t.flight) + '. Check the number, or tick below if it\'s correct.</span><label class="check"><input type="checkbox" id="' + k + '-fok" data-f="fok"' + (t.fok ? ' checked' : '') + '> My flight number is correct</label>';
    else if (fr && fr.status === 'not_operating') fmsg = '<span class="msg warn">' + esc(t.flight) + ' may not fly on this date. Check the date.</span>';
    var lines = t.cars.map(function (c, ci) { return lineFor(q, ti, ci); });
    var tripTotal = lines.every(function (l) { return l && l.ok; }) ? lines.reduce(function (s, l) { return s + l.total; }, 0) : null;
    var anyManual = lines.some(function (l) { return l && l.manual; });
    var tooLong = lines.filter(function (l) { return l && l.reason === 'too-long'; })[0];
    var holiday = lines.some(function (l) { return l && l.holiday; });
    var freeHour = lines.some(function (l) { return l && l.freeHour; });
    var mtnHour = lines.some(function (l) { return l && l.ok && l.mountainHour; });
    var allHours = Math.max.apply(null, lines.map(function (l) { return l && l.ok && l.hours || 0; }));
    var gift = mtnHour || freeHour ? '<span class="gift">' + [mtnHour ? '✓ Mountain day: +1 hour included' : '', freeHour ? '✓ Promo: +1 free hour' : '', allHours ? '✓ ' + allHours + ' hours in total' : ''].filter(Boolean).join('<br>') + '</span>' : '';
    var warns = [];
    lines.forEach(function (l) { if (l) l.warnings.forEach(function (w) { if (warns.indexOf(w) < 0) warns.push(w); }); });
    var hrs = hoursUntil(t), rush = hrs != null && hrs >= 48 && hrs < 72;
    var planOpen = t.svc === 'charter' && t.plan && t.hrs !== 'custom';
    var stopsHtml = planOpen ? '' : t.stops.map(function (s, si) {
      var lock = t.svc === 'charter' && t.stops.length === 1;
      return '<div class="stop"><span class="dot mid"></span>' + addrField(k + '-s' + si, s, 'Stop ' + (si + 1)) + (lock ? '' : '<button class="x" type="button" aria-label="Remove stop" data-act="rmstop" data-t="' + ti + '" data-s="' + si + '">✕</button>') + '</div>';
    }).join('');
    var routeHint = '';
    if (t.route && t.route.status === 'loading') routeHint = 'Calculating route…';
    else if (t.route && t.route.status === 'fail') routeHint = 'No route found. We\'ll send a custom quote by email and WhatsApp.';
    else if (t.route && t.route.status === 'ok' && t.route.km > 0 && !planOpenOf(t)) routeHint = 'Distance ' + t.route.km + ' km';
    var sub = (t.date ? niceDate(t.date) + ' · ' : '') + SVC[t.svc] + (isAir && t.dir ? ' · ' + (arr ? 'Arrival' : 'Departure') : '') + (t.svc === 'charter' && t.hrs ? ' · ' + (t.hrs === 'custom' ? 'Custom' : t.hrs + ' hours') : '');
    return '<section class="card" aria-label="Trip ' + (ti + 1) + '">' +
      '<div class="head"><span><b>Trip ' + (ti + 1) + '</b> <span class="sub">' + esc(sub) + '</span></span>' + (ti > 0 ? '<button class="rm" type="button" data-act="rmtrip" data-t="' + ti + '">Remove trip</button>' : '') + '</div>' +
      (t.itinerary && t.svc === 'charter' ? '<p class="tourline">' + esc(t.itinerary) + (t.tour && t.tour.n > 1 ? '<br><small>' + (t.tour.d === 0 ? 'Pick-up: your hotel. ' : 'Pick-up: where Day ' + t.tour.d + ' ends. ') + (t.same ? 'Drop-off: same as pick-up.' : 'Drop-off: ' + (t.tour.d === t.tour.n - 1 ? 'where you go next.' : 'your hotel tonight.')) + '</small>' : '') + '</p>' : '') +
      '<div class="step"><span class="step-label">Service<span class="req">*</span></span><div class="tabs" role="group" aria-label="Service" id="' + k + '-svc">' + tabs + '</div>' +
        (t.pending ? '<div class="infobox switchbox" role="alert"><p class="swq">Switch to ' + SVC[t.pending] + '? Route, date and flight will be cleared.</p><div class="swbtns"><button class="swbtn" type="button" data-act="svcyes" data-t="' + ti + '">Switch</button><button class="swbtn" type="button" data-act="svcno" data-t="' + ti + '">Keep ' + SVC[t.svc] + '</button></div></div>' : '') +
      '</div>' +
      '<div class="step"><span class="step-label">Trip details</span>' +
        (isAir ? '<div class="field"><span class="flabel">Direction<span class="req">*</span></span><div class="seg two" role="group" aria-label="Direction" id="' + k + '-dir">' +
          '<button type="button" aria-pressed="' + arr + '" data-act="dir" data-t="' + ti + '" data-v="arr">Arrival</button><button type="button" aria-pressed="' + dep + '" data-act="dir" data-t="' + ti + '" data-v="dep">Departure</button></div></div>' +
          '<div class="grid"><div class="field"><label for="' + k + '-ap">Airport<span class="req">*</span></label><select id="' + k + '-ap" data-f="airport" class="' + (t.airport ? '' : 'empty') + '"><option value="" disabled' + (t.airport ? '' : ' selected') + '>Select airport</option>' +
            Object.keys(AP).map(function (a) { return '<option value="' + a + '"' + (t.airport === a ? ' selected' : '') + '>' + AP[a].name.replace(' Airport', '') + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="' + k + '-fl">Flight number<span class="req">*</span></label><input id="' + k + '-fl" data-f="flight" placeholder="e.g. BR198" autocomplete="off" value="' + esc(t.flight) + '">' + fmsg + '</div></div>' : '') +
        (t.svc === 'charter' ? '<div class="field"><span class="flabel">Duration<span class="req">*</span></span><div class="seg three" role="group" aria-label="Duration" id="' + k + '-hrs">' +
          ['4', '8', 'custom'].map(function (h) { return '<button type="button" aria-pressed="' + (t.hrs === h) + '" data-act="hrs" data-t="' + ti + '" data-v="' + h + '">' + (h === 'custom' ? 'Custom' : h + ' hours') + '</button>'; }).join('') + '</div>' +
          gift +
          (t.hrs === 'custom' ? '<span class="hint">Tell us your plan in Trip notes. We\'ll send a custom quote by email and WhatsApp.</span>' : '') + '</div>' : '') +
        '<div class="grid"><div class="field"><span class="flabel" id="' + k + '-datel">' + (isAir && arr ? 'Landing date' : 'Date') + '<span class="req">*</span></span>' +
          '<button type="button" class="datebtn' + (t.date ? '' : ' empty') + '" id="' + k + '-date" data-act="cal" data-t="' + ti + '" aria-haspopup="dialog" aria-expanded="' + !!(S.cal && S.cal.ti === ti) + '" aria-labelledby="' + k + '-datel ' + k + '-date">' +
          '<span>' + (t.date ? niceDate(t.date) : 'Select date') + '</span>' + CAL_ICON + '</button>' + (S.cal && S.cal.ti === ti ? calHtml(t, ti) : '') + '</div>' +
          '<div class="field"><span class="flabel">' + (isAir ? (arr ? 'Landing time' : dep ? 'Pick-up time' : 'Time') : t.svc === 'charter' ? 'Start time' : 'Pick-up time') + '<span class="req">*</span></span><div class="time2">' +
          '<select id="' + k + '-hh" data-f="hh" aria-label="Hour" class="' + (t.hh ? '' : 'empty') + '">' + hoursOpts(t.hh, 'Hour', HH) + '</select>' +
          '<select id="' + k + '-mm" data-f="mm" aria-label="Minute" class="' + (t.mm ? '' : 'empty') + '">' + hoursOpts(t.mm, 'Min', MM) + '</select></div></div></div>' +
        (rush ? '<span class="rush">Short notice: we\'ll confirm availability. Full refund if no car.</span>' : '') +
        (isAir && dep ? '<span class="hint">Arrive 3 hours before international flights.</span>' : '') +
        '<div class="route"><span class="flabel">Route<span class="req">*</span></span>' +
          '<div class="stop"><span class="dot"></span>' + (isAir && !dep ? '<span class="fixedpt">' + esc(apName) + '</span>' : addrField(k + '-from', t.from, isAir ? 'Hotel or pick-up address' : 'Pick-up address')) + '</div>' +
          stopsHtml +
          (!planOpen && t.stops.length < MAXSTOPS[t.svc] ? '<div class="linkrow"><button class="link" type="button" data-act="addstop" data-t="' + ti + '">+ Add stop' + (t.svc === 'charter' ? '' : ' · TWD 300 each') + '</button><button class="info" type="button" data-act="info" data-t="' + ti + '" aria-label="About stops">i</button></div>' : '') +
          '<div class="infobox" data-info="' + k + '" hidden>' + (t.svc === 'charter' ? 'Add all stops now. Changes on the day may add a mileage &amp; mountain surcharge.' : 'Add all stops now. Stops added on the day: TWD 500 + TWD 25/km. Up to 15 minutes per stop. For longer visits, book a charter.') + '</div>' +
          '<div class="stop"><span class="dot end"></span>' + (isAir && dep ? '<span class="fixedpt">' + esc(apName) + '</span>' : (t.same ? '<span class="fixedpt">' + esc(t.from.label ? t.from.label + ' (same as pick-up)' : 'Same as pick-up') + '</span>' : addrField(k + '-to', t.to, isAir ? 'Hotel or drop-off address' : 'Drop-off address'))) + '</div>' +
          (t.svc === 'charter' ? '<label class="check"><input type="checkbox" id="' + k + '-same" data-f="same"' + (t.same ? ' checked' : '') + '> Drop-off same as pick-up</label>' : '') +
          (t.svc === 'charter' && t.hrs !== 'custom' ? '<label class="check"><input type="checkbox" id="' + k + '-plan" data-f="plan"' + (t.plan ? ' checked' : '') + '> Plan not set yet</label>' +
            (t.plan ? '<span class="hint">Price without stops. Once you share your plan, we\'ll add TWD 0–2,000 for distance and mountain areas. Longer trips are quoted separately. Tell us roughly where you\'d like to go in Trip notes.</span>' : '') : '') +
          (routeHint ? '<span class="hint">' + esc(routeHint) + '</span>' : '') +
          (S.mapsDown ? mapsDownHtml() : '') +
        '</div></div>' +
      t.cars.map(function (c, ci) { return carBlock(t, ti, c, ci, q); }).join('') +
      ((isAir && arr) || t.svc === 'charter' ? '<div class="step"><span class="step-label">Extras</span>' +
        (isAir && arr ? '<label class="check"><input type="checkbox" id="' + k + '-sign" data-f="sign"' + (t.sign ? ' checked' : '') + '> Meet &amp; greet name sign · TWD 300 per car</label>' +
          (t.sign ? '<div class="field signbox"><label for="' + k + '-signtext">Name on the sign</label><input id="' + k + '-signtext" data-f="signText" maxlength="40" autocomplete="off" placeholder="e.g. Mr. John Smith" value="' + esc(t.signText) + '"><span class="hint">Shown at arrivals. Leave blank to use your name.</span></div>' : '') : '') +
        (t.svc === 'charter' ? '<label class="check"><input type="checkbox" id="' + k + '-eng" data-f="eng"' + (t.eng ? ' checked' : '') + '> English-speaking chauffeur · TWD 1,000 per day</label>' + (t.eng ? '<span class="hint">For full conversation in English.</span>' : '') : '') + '</div>' : '') +
      '<div class="field"><label for="' + k + '-notes">Trip notes</label><textarea id="' + k + '-notes" data-f="notes" rows="2" maxlength="1000" placeholder="' +
        (t.svc === 'charter' ? 'e.g. places to visit, lunch stop, special requests' : 'e.g. special requests, anything your chauffeur should know') + '">' + esc(t.notes) + '</textarea></div>' +
      warns.map(function (w) { return '<span class="msg warn">' + esc(w) + '</span>'; }).join('') +
      (tooLong ? '<div class="msg warn">Driving time too long. ' +
          '<span class="linkrow"><button class="link" type="button" data-act="fixlong" data-t="' + ti + '">' + (longTo(t) === '8' ? 'Switch to 8 hours' : 'Switch to Custom') + '</button></span></div>'
        : anyManual ? '<span class="msg warn">Custom quote by email and WhatsApp.</span>' : '') +
      '<div class="line-total trip-total"><span class="small">Trip ' + (ti + 1) + ' price' + (t.cars.length > 1 ? ' (' + t.cars.length + ' vehicles)' : '') + (holiday ? '<span class="badge">🏮 Lunar New Year rate (+50%)</span>' : '') + '</span><span class="amt">' + (anyManual ? 'Custom quote' : tripTotal == null ? '—' : fmt(tripTotal)) + '</span></div>' +
    '</section>';
  }

  function money(a) { return a < 0 ? '− ' + fmt(-a) : a === 0 ? 'Free' : fmt(a); }
  // two levels: the item, and a smaller grey line under it (vehicle, "+1 hour included", "+1 free hour"); lines only break between word groups
  function nw(x) { return '<span class="nw">' + x + '</span>'; }
  function partLabel(p) {
    var L = p.label, m, sub = function (x) { return '<span class="psub">' + x + '</span>'; };
    if ((m = /^(\d+-hour charter) · (.+)$/.exec(L))) return nw(esc(m[1])) + sub(esc(m[2]));
    if (L === 'Mileage & mountain surcharge') return nw('Mileage &amp;') + ' ' + nw('mountain surcharge') + (p.note ? sub('<span class="phr">' + esc(p.note) + '</span>') : '');
    if ((m = /^Promo code (\S+): (.+)$/.exec(L))) return nw('Promo code') + ' ' + nw(esc(m[1])) + sub(esc(m[2]));
    if ((m = /^Promo code (\S+)$/.exec(L))) return nw('Promo code') + ' ' + nw(esc(m[1]));
    return esc(L);
  }
  function partsHtml(l) {
    return '<ul class="parts">' + l.parts.map(function (p) { return '<li' + (p.amount < 0 ? ' class="minus"' : '') + '><span class="plbl">' + partLabel(p) + '</span><span class="pamt">' + money(p.amount) + '</span></li>'; }).join('') +
      (l.extraHours ? '<li class="phours"><span class="plbl">Total time</span><span class="pamt">' + l.hours + ' hours</span></li>' : '') + '</ul>';
  }
  function titleBits(l) {
    var t = S.trips[l.trip], c = t.cars[l.car];
    return [S.trips.length > 1 ? 'Trip ' + (l.trip + 1) : SVC[t.svc]].concat(t.cars.length > 1 ? ['Vehicle ' + (l.car + 1)] : [], t.date ? [niceDate(t.date)] : [], c.vehicle && t.cars.length > 1 ? [c.vehicle] : []);
  }
  // phones: the first part on its own line, the rest below; each part stays whole
  function lineTitleHtml(l) {
    var b = titleBits(l);
    return nw(esc(b[0])) + (b.length > 1 ? '<span class="t2"><span class="tsep"> · </span>' + b.slice(1).map(function (x) { return nw(esc(x)); }).join(' · ') + '</span>' : '');
  }
  // price breakdown per car and trip; open by default, each one can be folded
  function breakdownHtml(q, where) {
    return q.lines.map(function (l) {
      var key = l.trip + '-' + l.car, open = S.open[key] !== false && l.ok && l.parts && l.parts.length;
      return '<div class="bd"><button type="button" class="bdhead" data-act="bd" data-k="' + key + '"' + (l.ok ? ' aria-expanded="' + !!open + '"' : ' disabled') + '>' +
        '<span class="ttl">' + lineTitleHtml(l) + '</span><span class="amt">' + (l.manual ? 'Custom quote' : l.ok ? fmt(l.total) : '—') + (l.ok ? '<i class="chev" aria-hidden="true"></i>' : '') + '</span></button>' +
        (open ? partsHtml(l) : '') + '</div>';
    }).join('');
  }
  function convText(twd) { try { return window.onyxConvert ? window.onyxConvert(twd) || '' : ''; } catch (e) { return ''; } }   // reference only: never breaks the form
  function summaryHtml(q) {
    var ok = q.complete && q.lines.length, conv = ok ? convText(q.total) : '';
    return '<div class="bdlist">' + breakdownHtml(q) + '</div>' +
      '<div class="sumrow"><span>' + (ONLINE() ? 'Total' : 'Estimated total') + (q.manual ? ' (excl. custom quote)' : '') + '</span><span class="total">' + (ok ? fmt(q.total) : '—') + '</span></div>' +
      (conv ? '<div class="sumrow muted"><span></span><span>' + esc(conv) + '</span></div>' : '') +
      (ONLINE() ? '<div class="sumrow"><span>Deposit (pay now)</span><span>' + (ok ? fmt(q.deposit) : '—') + '</span></div>' +
        '<div class="sumrow"><span>Balance (cash to chauffeur)</span><span>' + (ok ? fmt(q.total - q.deposit) : '—') + '</span></div>' : '');
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
  var rendering = false, lastModal = '';
  // multi-day itineraries: each later day starts the day after, from where the day before ended
  function syncTours() {
    S.trips.forEach(function (t) {
      if (!t.tour || !t.tour.d || t.svc !== 'charter') return;
      var p = S.trips.filter(function (x) { return x.tour && x.tour.g === t.tour.g && x.tour.d === t.tour.d - 1; })[0]; if (!p) return;
      if (t.tour.autoFrom) {
        var drop = p.same ? p.from : p.to;
        if (drop.label !== t.from.label || drop.lat !== t.from.lat || drop.lng !== t.from.lng) t.from = pt(drop.label, drop.lat, drop.lng);
      }
      if (t.tour.autoDate && p.date) { var nd = addDays(p.date, 1); if (t.date !== nd) t.date = nd; }
    });
  }
  function render() {
    syncTours();
    rendering = true;
    try { renderNow(); } finally { rendering = false; }
    renderBar();
  }
  function renderNow() {
    var root = $('onyx-booking'); if (!root) return;
    var active = document.activeElement, aid = active && root.contains(active) ? active.id : null, caret = null;
    // buttons without an id (vehicle cards, tabs, links): remember them by their data attributes so the keyboard focus survives a redraw
    var akey = null;
    if (active && root.contains(active) && !aid && active.dataset) {
      akey = ['act', 't', 'c', 'v', 'target', 'i', 'k'].map(function (k) { return active.dataset[k] != null ? '[data-' + k + '="' + String(active.dataset[k]).replace(/["\\]/g, '') + '"]' : ''; }).join('');
      if (!akey) akey = null;
    }
    try { caret = active && active.selectionStart; } catch (e) { caret = null; }
    if (S.done) { root.innerHTML = doneHtml(); document.body.classList.remove('obk-modal-open'); return; }
    S.trips.forEach(ensureRoute);
    var q = quote();
    checkLong();
    var pm = promoText(q), payableNow = ONLINE() && q.complete && !q.manual && q.deposit > 0;
    root.innerHTML =
      '<div id="obk-trips" style="display:flex;flex-direction:column;gap:20px">' + S.trips.map(function (t, ti) { return tripBlock(t, ti, q); }).join('') + '</div>' +
      '<div class="linkrow"><button class="addtrip" type="button" data-act="addtrip">+ Add another trip</button><button class="info" type="button" data-act="tripinfo" aria-label="About multi-day charters">i</button></div>' +
      '<div class="infobox" id="obk-tripinfo" hidden>Multi-day: same chauffeur when possible. Nights away: TWD 1,500 per night.</div>' +
      '<section class="card" aria-label="Your details"><span class="step-label">Your details</span><div class="grid3">' +
        '<div class="field"><label for="obk-name">Name<span class="req">*</span></label><input id="obk-name" data-g="name" autocomplete="name" placeholder="e.g. Ann Lee" value="' + esc(S.name) + '"></div>' +
        '<div class="field"><label for="obk-phone">Phone / WhatsApp<span class="req">*</span></label><input id="obk-phone" data-g="phone" type="tel" placeholder="+65 9123 4567" autocomplete="tel" value="' + esc(S.phone) + '"><span class="hint">WhatsApp number — we\'ll add you to a chat with your chauffeur.</span></div>' +
        '<div class="field"><label for="obk-email">Email<span class="req">*</span></label><input id="obk-email" data-g="email" type="email" autocomplete="email" placeholder="e.g. ann@example.com" value="' + esc(S.email) + '"></div></div>' +
        '<div class="hp" aria-hidden="true"><label>Website <input id="obk-website" data-g="website" tabindex="-1" autocomplete="off" value="' + esc(S.website) + '"></label></div></section>' +
      '<section class="card" aria-label="Payment"><span class="step-label">' + (ONLINE() ? 'Payment' : 'Price') + '</span>' +
        '<div class="field"><label for="obk-promo">Promo code</label><div class="promo"><input id="obk-promo" data-g="promoCode" autocomplete="off" value="' + esc(S.promoCode) + '"><button type="button" data-act="promo">Apply</button></div>' +
          (pm ? '<span class="msg ' + pm.cls + '">' + esc(pm.text) + '</span>' : '') + '</div>' +
        '<div class="summary">' + summaryHtml(q) + '</div>' +
        '<span class="small">Charged in TWD. Overtime extra. Conversions are estimates.</span>' +
        '<div class="included small">✓ Tolls &amp; parking included · Free waiting time · Flight tracking <button class="link" type="button" data-act="incl">What\'s included</button>' +
          '<ul id="obk-incl" hidden><li>Fixed price: tolls, parking and fuel included.</li><li>Free waiting time: 60 min after landing, 15 min for other pick-ups.</li><li>Flight tracking: delays at no extra cost.</li><li>Free cancellation 7+ days before pick-up.</li><li>Typhoon or cancelled flight: free reschedule or full refund.</li><li>Licensed, insured vehicles and professional chauffeurs.</li><li>WhatsApp group chat with your chauffeur.</li><li>Child seats and meet &amp; greet name sign available.</li><li>Chauffeurs speak basic English and use a translation app.</li></ul></div>' +
        '<label class="check"><input type="checkbox" id="obk-terms" data-g="terms"' + (S.terms ? ' checked' : '') + '> <span>I agree to the <a class="nw" href="#booking-terms" data-act="terms">Booking Terms</a><span class="req">*</span></span></label>' +
        (S.errors.length ? '<div class="formerr" role="alert">Please complete: ' + esc(S.errors.join(', ')) + '.</div>' : '') +
        '<button class="btn gold" type="button" data-act="submit"' + (S.submitting ? ' disabled' : '') + '>' + (S.submitting ? 'Sending…' : payableNow ? 'Book &amp; pay deposit' : 'Book now') + '</button>' +
      '</section>' + modalHtml(q);
    if (S.badIds) S.badIds.forEach(function (id) { var el = $(id); if (el) el.classList.add('bad'); });
    // an open dialog keeps the page behind it still, and gets the keyboard focus once
    var modal = S.proc ? 'proc' + (S.proc.err ? 'err' : '') : S.dlg ? 'dlg' : S.review ? 'review' : '';
    document.body.classList.toggle('obk-modal-open', !!modal);
    if (modal && modal !== lastModal) { var f = root.querySelector('.modal .btn.gold') || root.querySelector('.modal .mbox'); if (f) { if (!f.hasAttribute('tabindex') && f.tagName !== 'BUTTON') f.setAttribute('tabindex', '-1'); f.focus(); } }
    else if (aid && $(aid)) { $(aid).focus(); try { if (caret != null) $(aid).setSelectionRange(caret, caret); } catch (e) { /* select elements */ } }
    else if (akey) { var again = root.querySelector(akey); if (again) again.focus(); }
    lastModal = modal;
    if (window.onyxKeepWords) window.onyxKeepWords(root);   // "28-inch" never splits across lines
  }

  /* ---------------- dialogs: charter too long, review, sending ---------------- */
  // a charter whose driving time is longer than its hours: explain once per route and offer the right package
  function checkLong() {
    if (S.dlg) return;
    S.trips.forEach(function (t, ti) {
      if (S.dlg || t.svc !== 'charter' || (t.hrs !== '4' && t.hrs !== '8') || !t.route || t.route.status !== 'ok' || !t.route.durationMin) return;
      var h = t.route.durationMin / 60, sig = t.route.key + '|' + t.hrs;
      if (h < driveLimit(t.hrs, t) || t.dlgSeen === sig) return;
      t.dlgSeen = sig;
      S.dlg = { ti: ti, hrs: t.hrs, to: longTo(t) };
    });
  }
  // drive-time limits come from the engine (they are never shown on the site)
  // a mountain day (the engine gives it +1 hour) allows one more hour of driving
  function mountainTrip(t) {
    var ti = S.trips.indexOf(t);
    return ti >= 0 && quote().lines.some(function (l) { return l.trip === ti && l.mountainHour; });
  }
  function driveLimit(hrs, t) { return ((P.CONFIG.charter.customDriveHours || {})[hrs] || Number(hrs)) + (t && mountainTrip(t) ? P.CONFIG.charter.mountainExtraHours || 0 : 0); }
  function longTo(t) {
    var h = t.route && t.route.durationMin ? t.route.durationMin / 60 : 99;
    return t.hrs === '4' && h < driveLimit('8', t) ? '8' : 'custom';
  }
  function longFix(t) { dropPromo(); t.hrs = longTo(t); }
  function dialogHtml() {
    var d = S.dlg;
    return '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="obk-dlg-t"><div class="mbox small">' +
      '<b class="mtitle" id="obk-dlg-t">' + (d.to === '8' ? 'Driving time too long for 4 hours' : 'Driving time too long') + '</b>' +
      (d.to === '8' ? '' : '<p>We\'ll send you a custom quote.</p>') +
      '<div class="mbtns"><button class="btn gold" type="button" data-act="dlgyes" id="obk-dlg-yes">' + (d.to === '8' ? 'Switch to 8 hours' : 'Switch to Custom') + '</button>' +
      '<button class="btn ghost" type="button" data-act="dlgno">Change route</button></div></div></div>';
  }
  function routeText(t) {
    var pts = enginePoints(t), list = [pts.from].concat(pts.stops, [t.same ? pts.from : pts.to]);
    return list.map(function (p) { return esc(p.label || '—'); }).join(' <span class="arrow">→</span> ');
  }
  function reviewHtml(q) {
    var payable = ONLINE() && q.complete && !q.manual && q.deposit > 0, priced = q.complete && !q.manual, items = '';
    S.trips.forEach(function (t, ti) {
      t.cars.forEach(function (c, ci) {
        var l = lineFor(q, ti, ci), extra = [];
        if (t.svc === 'airport' && t.dir === 'arr' && t.sign) extra.push('Name sign: ' + esc(signName(t) || 'your name'));
        if (c.kids && n0(c.inf) + n0(c.ch)) extra.push([n0(c.ch) ? n0(c.ch) + ' child seat' : '', n0(c.inf) ? n0(c.inf) + ' rear-facing seat' : ''].filter(Boolean).join(', '));
        if (t.svc === 'charter' && t.eng) extra.push('English-speaking chauffeur');
        if (t.svc === 'charter' && t.plan && t.hrs !== 'custom') extra.push('Plan not set yet');
        var head = (S.trips.length > 1 ? 'Trip ' + (ti + 1) + ' · ' : '') + (t.cars.length > 1 ? 'Vehicle ' + (ci + 1) + ' · ' : '') + SVC[t.svc] +
          (t.svc === 'airport' ? ' · ' + (t.dir === 'arr' ? 'Arrival' : 'Departure') : t.svc === 'charter' ? ' · ' + (t.hrs === 'custom' ? 'Custom' : t.hrs + ' hours') : '');
        items += '<div class="rv"><div class="rvhead"><b>' + esc(head) + '</b><span>' + (l && l.manual ? 'Custom quote' : l && l.ok ? fmt(l.total) : '—') + '</span></div><ul>' +
          '<li>' + esc(niceDate(t.date) + ' · ' + t.hh + ':' + t.mm + (t.svc === 'airport' && t.flight ? ' · Flight ' + t.flight : '')) + '</li>' +
          '<li>' + routeText(t) + '</li>' +
          '<li>' + esc(c.vehicle + ' · ' + c.pax + '\u00a0passenger' + (c.pax === '1' ? '' : 's') + ' · ' + ([n0(c.l28) ? n0(c.l28) + '\u00a0×\u00a028-inch' : '', n0(c.l20) ? n0(c.l20) + '\u00a0×\u00a020-inch' : ''].filter(Boolean).concat(ovsText(c, '\u00a0×\u00a0')).join(', ') || 'no luggage')) + '</li>' +
          (extra.length ? '<li>' + extra.join(' · ') + '</li>' : '') +
          (P.hoursNote(l) ? '<li>Total time: ' + P.hoursNote(l).split(' (').map(function (x, i) { return nw(esc(i ? '(' + x : x)); }).join(' ') + '</li>' : '') + '</ul></div>';
      });
    });
    return '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="obk-rv-t"><div class="mbox">' +
      '<b class="mtitle" id="obk-rv-t">Review your booking</b>' + items +
      '<div class="summary">' + (payable
        ? '<div class="sumrow"><span>Total</span><span class="total">' + fmt(q.total) + '</span></div><div class="sumrow"><span>Deposit (pay now)</span><span>' + fmt(q.deposit) + '</span></div><div class="sumrow"><span>Balance (cash to chauffeur)</span><span>' + fmt(q.total - q.deposit) + '</span></div>'
        : (priced ? '<div class="sumrow"><span>Estimated total</span><span class="total">' + fmt(q.total) + '</span></div>' : '') +
          '<p class="msg warn" style="margin:0">' + nextStep(priced) + ' Nothing to pay now.</p>') + '</div>' +
      '<p class="small">' + esc(S.name) + ' · ' + esc(S.phone) + ' · ' + esc(S.email) + '</p>' +
      '<div class="mbtns"><button class="btn gold" type="button" data-act="revyes" id="obk-rv-yes">' + (payable ? 'Confirm &amp; pay deposit' : 'Confirm booking') + '</button>' +
      '<button class="btn ghost" type="button" data-act="revno">Edit booking</button></div></div></div>';
  }
  function nextStep(priced) { return priced ? 'We\'ll check your trip and send your deposit link by email and WhatsApp.' : 'We\'ll check your trip and send a custom quote by email and WhatsApp.'; }
  var STEPS = ['Checking your price', 'Saving your booking', 'Preparing secure payment'];
  function progressHtml() {
    var p = S.proc;
    if (p.err) return '<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="obk-pr-t"><div class="mbox small">' +
      '<b class="mtitle" id="obk-pr-t">We couldn\'t send your booking</b><p>' + esc(p.err) + ' Your details are still here.</p>' +
      '<div class="mbtns"><button class="btn gold" type="button" data-act="procretry" id="obk-pr-retry">Try again</button>' +
      '<a class="btn wa" href="https://wa.me/' + (CFG.WHATSAPP || '886970326591') + '" target="_blank" rel="noopener">WhatsApp us</a>' +
      '<button class="btn ghost" type="button" data-act="procback">Back to the form</button></div></div></div>';
    return '<div class="modal" role="dialog" aria-modal="true" aria-busy="true" aria-labelledby="obk-pr-t"><div class="mbox small">' +
      '<b class="mtitle" id="obk-pr-t">Sending your booking…</b><ol class="steps">' +
      (p.quote ? ['Checking your booking', 'Sending your request'] : STEPS).map(function (x, i) { return '<li class="' + (i < p.step ? 'done' : i === p.step ? 'now' : '') + '">' + (i < p.step ? '✓ ' : '') + x + '</li>'; }).join('') + '</ol>' +
      (p.slow ? '<p class="hint" role="status">Still working… please don\'t close this page.</p>' : '') + '</div></div>';
  }
  function modalHtml(q) {
    if (S.proc) return progressHtml();
    if (S.dlg) return dialogHtml();
    if (S.review) return reviewHtml(q);
    return '';
  }

  /* ---------------- phone: price bar fixed at the bottom ---------------- */
  var bar = null;
  var WA_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';
  function renderBar() {
    if (!bar) return;
    if (S.done) { bar.hidden = true; document.body.classList.remove('obk-bar-on'); return; }
    var q = quote(), ok = q.complete && q.lines.length, conv = ok ? convText(q.total) : '';
    var sub = ok ? (ONLINE() ? 'Deposit ' + fmt(q.deposit) + ' · ' : '') + (S.sheet ? 'Hide details' : 'See details') : q.manual ? 'We\'ll send a custom quote' : 'Choose route & vehicle to see the price';
    bar.innerHTML = (S.sheet && ok ? '<div class="sheet" role="region" aria-label="Price details"><div class="summary">' + summaryHtml(q) + '</div><span class="small">Charged in TWD. Overtime extra. Conversions are estimates.</span></div>' : '') +
      '<div class="barrow"><button type="button" class="barinfo" data-bar="sheet"' + (ok ? ' aria-expanded="' + !!S.sheet + '"' : ' disabled') + '>' +
        '<span class="lbl">' + (ONLINE() ? 'Total' : 'Estimated total') + (conv ? ' <em>' + esc(conv) + '</em>' : '') + '</span><span class="tot">' + (ok ? fmt(q.total) : '—') + '</span><span class="sub">' + esc(sub) + (ok ? '<i class="chev up" aria-hidden="true"></i>' : '') + '</span></button>' +
        '<a class="barwa" href="https://wa.me/' + (CFG.WHATSAPP || '886970326591') + '" target="_blank" rel="noopener" aria-label="Ask us on WhatsApp">' + WA_ICON + '</a>' +
        '<button type="button" class="btn gold barbtn" data-bar="go">Book now</button></div>';
    barVisibility();
  }
  function barVisibility() {
    if (!bar) return;
    var root = $('onyx-booking'), pay = root && root.querySelector('[data-act="submit"]');
    var show = false;
    if (root && !S.done && !S.review && !S.dlg && !S.proc && window.matchMedia('(max-width: 768px)').matches) {
      var r = root.getBoundingClientRect(), vh = window.innerHeight;
      var p = pay ? pay.getBoundingClientRect() : null;
      show = r.top < vh - 120 && r.bottom > 160 && !(p && p.top < vh - 70 && p.bottom > 0);
    }
    if (!show) S.sheet = false;
    bar.hidden = !show;
    document.body.classList.toggle('obk-bar-on', show);
  }
  function onBarClick(e) {
    var b = e.target.closest('[data-bar],[data-act="bd"]'); if (!b) return;
    if (b.dataset.act === 'bd') { var bk = b.dataset.k; S.open[bk] = S.open[bk] === false; render(); return; }
    if (b.dataset.bar === 'sheet') { S.sheet = !S.sheet; renderBar(); return; }
    if (b.dataset.bar === 'go') {
      S.sheet = false;
      var card = document.querySelector('#onyx-booking [aria-label="Your details"]');
      if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      renderBar();
    }
  }

  /* ---------------- events ---------------- */
  function tripOf(el) { var m = (el.id || el.dataset.addr || el.dataset.target || '').match(/^t(\d+)(?:c(\d+))?/); return m ? { t: S.trips[+m[1]], ti: +m[1], c: m[2] != null ? +m[2] : null } : null; }
  function setPoint(id, p) {
    var m = id.match(/^t(\d+)-(from|to|s(\d+))$/); if (!m) return;
    var t = S.trips[+m[1]]; if (!t || (m[3] != null && +m[3] >= t.stops.length)) return;   // trip or stop removed meanwhile
    if (m[2] === 'from') { t.from = p; if (t.tour) t.tour.autoFrom = false; } else if (m[2] === 'to') t.to = p; else t.stops[+m[3]] = p;
  }
  function getPoint(id) {
    var m = id.match(/^t(\d+)-(from|to|s(\d+))$/); if (!m) return null;
    var t = S.trips[+m[1]]; if (!t) return null;
    return m[2] === 'from' ? t.from : m[2] === 'to' ? t.to : t.stops[+m[3]];
  }
  // an address field, remembered by its trip (not its position), so late Maps answers never land in the wrong trip
  function pointRef(id) { var m = id.match(/^t(\d+)-(.+)$/); return m ? { trip: S.trips[+m[1]], key: m[2] } : null; }
  function liveId(ref) { var i = ref && ref.trip ? S.trips.indexOf(ref.trip) : -1; return i < 0 ? null : 't' + i + '-' + ref.key; }
  function hasData(t) { return !!(t.dir || t.airport || t.flight || t.hrs || t.date || t.hh || t.mm || t.from.label || t.to.label || t.same || t.sign || t.eng || t.stops.some(function (s) { return s.label; })); }
  function switched(t, svc) { var nt = newTrip(); nt.svc = svc; nt.cars = t.cars.map(newCar); if (svc === 'charter') nt.stops = [pt()]; return nt; }
  function dropPromo() { if (S.promo) { S.promo = null; S.promoStale = true; } }
  function clearErrors() { S.errors = []; S.badIds = null; }
  // same as clearErrors, but updates the page directly (used while the customer is typing)
  function clearErrorsQuiet() {
    if (!S.errors.length && !S.badIds) return;
    clearErrors();
    var box = document.querySelector('#onyx-booking .formerr'); if (box) box.remove();
    document.querySelectorAll('#onyx-booking .bad').forEach(function (x) { x.classList.remove('bad'); });
  }

  var suggTimer = null, blurTimer = null;
  function onClick(e) {
    var b = e.target.closest('[data-act],[data-pick]'); if (!b) return;
    if (b.dataset.pick) {
      e.preventDefault();
      var s = S.sugg; if (!s) return;
      var item = s.items[+b.dataset.i], id = b.dataset.pick;
      S.sugg = null; clearTimeout(blurTimer);
      var ref = pointRef(id);
      Maps.details(item).then(function (p) { var nid = liveId(ref); if (p && nid) { setPoint(nid, p); render(); } });
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
    if (act === 'cal') {
      if (S.cal && S.cal.ti === ti) S.cal = null;
      else { var base = t.date || minDate; S.cal = { ti: ti, y: +base.slice(0, 4), m: +base.slice(5, 7) - 1 }; }
      render(); return;
    }
    if (act === 'calnav') { var nm = S.cal.m + Number(b.dataset.v); S.cal.y += Math.floor(nm / 12); S.cal.m = (nm % 12 + 12) % 12; render(); var nb = document.querySelector('.obk .cal [data-act="calnav"][data-v="' + b.dataset.v + '"]'); if (nb && !nb.disabled) nb.focus(); return; }
    if (act === 'day') {
      clearErrors(); t.date = b.dataset.v; if (t.tour) t.tour.autoDate = false; S.cal = null; if (t.flight) checkFlight(t);
      render(); var db = $('t' + ti + '-date'); if (db) db.focus(); return;
    }
    if (act === 'bd') { var bk = b.dataset.k; S.open[bk] = S.open[bk] === false; render(); return; }
    if (act === 'promo') { applyPromo(); return; }
    if (act === 'submit') { submit(); return; }
    if (act === 'revno') { S.review = false; render(); var sb = document.querySelector('.obk [data-act="submit"]'); if (sb) sb.focus(); return; }
    if (act === 'revyes') { S.review = false; doSubmit(); return; }
    if (act === 'procretry') { doSubmit(); return; }
    if (act === 'procback') { S.proc = null; render(); return; }
    if (act === 'paynow') { startPayment(); return; }
    if (act === 'dlgyes' || act === 'dlgno') {
      var dt = S.dlg && S.trips[S.dlg.ti]; S.dlg = null;
      if (act === 'dlgyes' && dt) { clearErrors(); longFix(dt); }
      render(); return;
    }
    if (act === 'fixlong') { clearErrors(); longFix(t); render(); return; }
    clearErrors(); S.cal = null;
    if (act === 'svc') {
      if (!t.svc) { t.svc = b.dataset.v; if (t.svc === 'charter' && !t.stops.length) t.stops = [pt()]; dropPromo(); }
      else if (t.svc === b.dataset.v) t.pending = null;
      else if (hasData(t)) t.pending = b.dataset.v;
      else { S.trips[ti] = switched(t, b.dataset.v); dropPromo(); }
    }
    if (act === 'svcyes') { S.trips[ti] = switched(t, t.pending); dropPromo(); }
    if (act === 'svcno') t.pending = null;
    if (act === 'dir') { t.dir = b.dataset.v; checkFlight(t); }
    if (act === 'hrs') { if (t.hrs !== b.dataset.v) dropPromo(); t.hrs = b.dataset.v; }
    if (act === 'car') {
      if (b.getAttribute('aria-disabled') === 'true') return;
      var cc = t.cars[+b.dataset.c]; cc.vehicle = b.dataset.v;
      // oversized items only go in a Premium Van: leaving the van with none chosen unticks the box
      if (P.CONFIG.luggage.oversizedVehicles.indexOf(cc.vehicle) < 0 && !P.oversizedOf(carData(cc))) cc.ovs = false;
    }
    if (act === 'addstop') t.stops.push(pt());
    if (act === 'rmstop') t.stops.splice(+b.dataset.s, 1);
    if (act === 'addcar') t.cars.push(newCar());
    if (act === 'addoth') { var ca = t.cars[+b.dataset.c]; ca.othN = Math.min(OTH.length, (ca.othN || 1) + 1); }
    if (act === 'rmoth') { var co = t.cars[+b.dataset.c], last = OTH[(co.othN || 1) - 1]; if ((co.othN || 1) > 1) { OTHF.forEach(function (f) { co[last + f] = f === 'n' ? '0' : ''; }); co.othN--; } }
    if (act === 'rmcar') t.cars.splice(+b.dataset.c, 1);
    if (act === 'rmtrip') S.trips.splice(ti, 1);
    if (act === 'addtrip') { S.trips.push(newTrip(S.trips[S.trips.length - 1])); render(); var cards = document.querySelectorAll('#obk-trips > .card'); cards[cards.length - 1].scrollIntoView({ block: 'start' }); return; }
    render();
    if (act === 'addstop') { var inp = $('t' + ti + '-s' + (t.stops.length - 1)); if (inp) inp.focus(); }
  }
  function onInput(e) {
    var el = e.target;
    if (el.dataset.g) { S[el.dataset.g] = el.type === 'checkbox' ? el.checked : el.value; clearErrorsQuiet(); return; }
    if (el.dataset.addr) {
      var id = el.dataset.addr, val = el.value;
      setPoint(id, pt(val));
      clearTimeout(suggTimer);
      if (val.trim().length < 3) { if (S.sugg) { S.sugg = null; render(); } return; }
      suggTimer = setTimeout(function () {
        Maps.suggest(val).then(function (items) {
          if (!$(id) || $(id).value !== val) return;
          S.sugg = { id: id, items: items, active: -1 }; render();
          showSuggestions(id);
        });
      }, 250);
      return;
    }
    if (el.dataset.f === 'flight') { var tr = tripOf(el); if (tr) tr.t.flight = el.value; }
    if (el.dataset.f === 'signText') { var ts = tripOf(el); if (ts) ts.t.signText = el.value; }
    if (el.dataset.f === 'notes') { var tn = tripOf(el); if (tn) tn.t.notes = el.value; }
    // item sizes: kept while typing, so a redraw (a route or flight answer arriving) never loses what was typed
    if (/^o\d[lwh]$/.test(el.dataset.f || '')) { var tz = tripOf(el); if (tz && tz.c != null) tz.t.cars[tz.c][el.dataset.f] = el.value.replace(/\D/g, '').slice(0, 3); }
  }
  // phones: if the suggestion list opens below the visible area (keyboard open), move the field up under the menu so the list shows
  function showSuggestions(id) {
    var inp = $(id), li = document.querySelector('[data-pick="' + id + '"]'); if (!inp || !li || !li.parentElement) return;
    var vv = window.visualViewport, bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    if (li.parentElement.getBoundingClientRect().bottom > bottom - 8) { try { inp.scrollIntoView({ block: 'start' }); } catch (e) { inp.scrollIntoView(true); } }
  }
  function onChange(e) {
    var el = e.target, f = el.dataset.f;
    if (el.dataset.g) { S[el.dataset.g] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.g === 'terms') { clearErrors(); render(); } return; }
    if (!f) return;
    var tr = tripOf(el); if (!tr) return;
    var t = tr.t;
    if (f === 'signText' || f === 'notes') { t[f] = el.value; return; }   // free text: no redraw while typing
    clearErrors();
    if (/^o\d[lwh]$/.test(f)) el.value = el.value.replace(/\D/g, '').slice(0, 3);   // item size in cm: digits only
    if (tr.c != null) { var c = t.cars[tr.c]; c[f] = el.type === 'checkbox' ? el.checked : el.value; }
    else if (f === 'flight') { t.flight = el.value; checkFlight(t); }
    else if (f === 'airport') { t.airport = el.value; checkFlight(t); }
    else if (f === 'date') { t.date = el.value; if (t.tour) t.tour.autoDate = false; if (t.flight) checkFlight(t); }
    else if (el.type === 'checkbox') { t[f] = el.checked; if (f === 'same' && el.checked) t.to = pt(); }
    else t[f] = el.value;
    // a typed field (flight number, item size) changes when the guest taps the next field or a button:
    // redraw only after that tap is finished, so the field or button they tapped is not replaced under their finger
    if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio') { if (ptrDown) ptrWait = true; else setTimeout(render, 0); return; }
    render();
  }
  var ptrDown = false, ptrWait = false;
  function ptrEnd() { ptrDown = false; if (ptrWait) { ptrWait = false; setTimeout(render, 0); } }
  function onFocusOut(e) {
    if (rendering) return;
    var el = e.target; if (!el.dataset || !el.dataset.addr) return;
    var id = el.dataset.addr, ref = pointRef(id);
    blurTimer = setTimeout(function () {
      if (S.sugg && S.sugg.id === id) { S.sugg = null; }
      var nid = liveId(ref), p = nid && getPoint(nid);
      if (p && p.label.trim() && !hasCoords(p)) {
        Maps.geocode(p.label.trim(), p.label.trim()).then(function (g) { var n2 = liveId(ref); if (g && n2) { setPoint(n2, g); } render(); });
      } else render();
    }, 200);
  }
  function onKey(e) {
    if (e.key === 'Escape' && !S.proc && (S.dlg || S.review)) { S.dlg = null; S.review = false; render(); return; }
    // keep the keyboard inside an open dialog
    var m = e.key === 'Tab' && document.querySelector('#onyx-booking .modal');
    if (m) {
      var f = [].slice.call(m.querySelectorAll('button:not([disabled]),a[href]'));
      if (f.length) {
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
      }
      return;
    }
    if (e.key === 'Escape' && S.cal) { var ct = S.cal.ti; S.cal = null; render(); var db = $('t' + ct + '-date'); if (db) db.focus(); return; }
    var el = e.target; if (!el.dataset || !el.dataset.addr || !S.sugg || S.sugg.id !== el.dataset.addr) return;
    var s = S.sugg;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); s.active = (s.active + (e.key === 'ArrowDown' ? 1 : -1) + s.items.length) % s.items.length; render(); }
    else if (e.key === 'Enter' && s.active >= 0) { e.preventDefault(); var li = document.querySelector('[data-pick="' + s.id + '"][data-i="' + s.active + '"]'); if (li) li.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    else if (e.key === 'Escape') { S.sugg = null; render(); }
  }

  /* ---------------- promo ---------------- */
  var promoSeq = 0;
  function applyPromo() {
    var seq = ++promoSeq, code = (S.promoCode || '').trim().toUpperCase();
    S.promoStale = false; S.promoMsg = ''; S.promoBad = false;
    if (!code) { S.promo = null; render(); return; }
    if (!CFG.PROMO_GAS_URL) { S.promo = null; S.promoMsg = 'Promo codes are not available right now.'; S.promoBad = true; render(); return; }
    S.promoMsg = 'Checking…'; render();
    fetch(CFG.PROMO_GAS_URL + '?action=checkPromo&code=' + encodeURIComponent(code)).then(function (r) { return r.json(); }).then(function (res) {
      if (seq !== promoSeq) return;   // an older answer: a newer code was applied meanwhile
      if (!res.valid) { S.promo = null; S.promoMsg = res.message || 'This code is not valid.'; S.promoBad = true; }
      else { S.promo = { code: code, discountType: res.discountType, discountAmount: res.discountAmount, maxDiscount: res.maxDiscount, hasUpgrade: res.hasUpgrade, minSpend: res.minSpend, applicableService: res.applicableService, applicableVehicle: res.applicableVehicle }; S.promoMsg = ''; }
      render();
    }).catch(function () { if (seq !== promoSeq) return; S.promo = null; S.promoMsg = 'We couldn\'t check this code. Please try again.'; S.promoBad = true; render(); });
  }

  /* ---------------- validation + submit ---------------- */
  function validate() {
    var miss = [], bad = [];
    function need(ok, id, label) { if (!ok) { miss.push(label); if (id) bad.push(id); } }
    var q = quote();
    S.trips.forEach(function (t, ti) {
      var k = 't' + ti, T = (S.trips.length > 1 ? 'Trip ' + (ti + 1) + ' ' : '');
      if (!t.svc) { need(false, k + '-svc', 'Trip ' + (ti + 1) + ' service'); return; }
      if (t.svc === 'airport') {
        need(!!t.dir, k + '-dir', T + 'direction'); need(!!t.airport, k + '-ap', T + 'airport'); need(!!t.flight, k + '-fl', T + 'flight number');
        need(!(t.fres && t.fres.status === 'mismatch'), k + '-fl', T + 'flight and airport do not match');
        need(!(t.fres && t.fres.status === 'notfound') || t.fok, k + '-fl', T + 'confirm your flight number');
      }
      if (t.svc === 'charter') {
        need(!!t.hrs, k + '-hrs', T + 'duration');
        if (t.hrs !== 'custom' && !t.plan) need(!!(t.stops[0] && t.stops[0].label.trim()), k + '-s0', T + 'at least 1 stop (or tick "Plan not set yet")');
      }
      need(!!t.date, k + '-date', T + 'date');
      need(!!t.hh && !!t.mm, k + '-hh', T + 'time');
      var ahead = t.date && t.hh && t.mm ? hoursUntil(t) : null;
      need((!t.date || t.date >= minDate) && (ahead == null || ahead >= 48), k + '-date', T + 'date and time at least 48 hours ahead');
      if (!(t.svc === 'airport' && t.dir === 'arr')) need(!!t.from.label.trim(), k + '-from', T + 'pick-up address');
      if (!(t.svc === 'airport' && t.dir === 'dep') && !t.same) need(!!t.to.label.trim(), k + '-to', T + 'drop-off address');
      t.cars.forEach(function (c, ci) {
        var kk = k + 'c' + ci, C = T + (t.cars.length > 1 ? 'vehicle ' + (ci + 1) + ' ' : '');
        need(!!c.vehicle, kk + '-cars', C + 'vehicle'); need(c.pax !== '', kk + '-pax', C + 'passengers');
        need(c.l28 !== '', kk + '-l28', C + '28-inch suitcases'); need(c.l20 !== '', kk + '-l20', C + '20-inch suitcases');
        if (c.kids) need(n0(c.inf) + n0(c.ch) > 0, kk + '-inf', C + 'number of child seats');
        if (c.ovs) OTH.forEach(function (o) { if (n0(c[o + 'n'])) need(n0(c[o + 'l']) > 0 && n0(c[o + 'w']) > 0 && n0(c[o + 'h']) > 0, kk + '-' + o + 'l', C + 'size of Other ' + o.slice(1)); });
        if (c.vehicle) need(!P.capacityProblem(engineTrip(t).cars[ci]), kk + '-pax', C + 'fit passengers and luggage');
        var l = lineFor(q, ti, ci);
        if (l && l.reason === 'not-allowed') need(false, k + '-hrs', T + '8 hours (4 hours not available there)');
        if (l && l.reason === 'too-long' && ci === 0) need(false, k + '-hrs', T + (longTo(t) === '8' ? '8 hours' : 'Custom') + ' (driving time too long)');
      });
      if (t.svc !== 'charter' || t.hrs !== 'custom') {
        var pts = enginePoints(t);
        var located = hasCoords(pts.from) && hasCoords(pts.to) && pts.stops.every(hasCoords);
        if ((t.from.label || t.to.label) && !located) need(false, null, T + 'choose addresses from the suggestions');
        [['from', t.from], ['to', t.same ? pt() : t.to]].concat((t.svc === 'charter' && t.plan ? [] : t.stops).map(function (x, si) { return ['s' + si, x]; })).forEach(function (a) {
          if (a[1].vague) need(false, k + '-' + a[0], T + 'an exact address');
        });
        if (located && t.route && t.route.status === 'loading') need(false, null, T + 'wait for the route to finish');
      }
    });
    need(!!S.name.trim(), 'obk-name', 'name');
    need(/^\+?[0-9\s\-()]{7,20}$/.test(S.phone.trim()), 'obk-phone', S.phone.trim() ? 'a valid phone number' : 'phone');
    need(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S.email.trim()), 'obk-email', S.email.trim() ? 'a valid email' : 'email');
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
    if (c.kids && (n0(c.inf) + n0(c.ch))) add('Seats', [n0(c.ch) ? n0(c.ch) + ' child seat' : '', n0(c.inf) ? n0(c.inf) + ' rear-facing seat' : ''].filter(Boolean).join(', '));
    add('Luggage', [n0(c.l28) + 'x 28-inch', n0(c.l20) + 'x 20-inch'].concat(ovsText(c, 'x ')).join(', '));
    var addOns = [];
    if (t.sign && t.svc === 'airport' && t.dir === 'arr') { addOns.push('Meet & greet'); add('Name sign', signName(t)); }
    if (t.eng && t.svc === 'charter') addOns.push('English chauffeur');
    if (t.svc !== 'charter' && P.isNight(t.hh + ':' + t.mm)) addOns.push('Late night');
    if (l && l.overnight) addOns.push('Chauffeur overnight');
    add('Add-ons', addOns.join(', '));
    add('Trip notes', (t.notes || '').trim());
    if (t.route && t.route.status === 'ok') { add('Distance', t.route.km + ' km'); if (t.route.durationMin) add('Drive time (Google, no traffic)', Math.round(t.route.durationMin / 30) / 2 + ' h'); }
    var flags = [];
    var h = hoursUntil(t); if (h != null && h < 72) flags.push('Short-notice');
    if (l && l.holiday) flags.push('Lunar New Year');
    if (l && l.manual) flags.push('Custom quote needed');
    if (t.svc === 'charter' && t.plan && t.hrs !== 'custom') flags.push('Plan not set yet');
    if (c.ovs && OTH.some(function (o) { return n0(c[o + 'n']); })) flags.push('Other large item: check the size');
    add('Flags', flags.join(' / '));
    if (S.promo && l && (l.discount > 0 || l.freeHour)) add('Promo code', S.promo.code + (l.freeHour ? ' (+1 free hour)' : ''));
    if (P.hoursNote(l)) add('Hours', P.hoursNote(l));
    if (l && l.ok) { add('Total', fmt(l.total)); if (ONLINE()) { add('Deposit', fmt(l.deposit)); add('Balance', fmt(l.total - l.deposit)); } }
    else add('Total', 'Quote by ONYX');
    return lines.join('\n');
  }

  // what the confirmation emails show for one vehicle of one trip: only what was filled in
  function custFields(t, c, l) {
    var isAir = t.svc === 'airport', arr = isAir && t.dir === 'arr', pts = enginePoints(t);
    var lug = [n0(c.l28) ? n0(c.l28) + ' × 28-inch' : '', n0(c.l20) ? n0(c.l20) + ' × 20-inch' : ''].filter(Boolean).concat(ovsText(c, ' × '));
    var seats = c.kids ? [n0(c.inf) ? n0(c.inf) + ' rear-facing seat' : '', n0(c.ch) ? n0(c.ch) + ' child seat' : ''].filter(Boolean) : [];
    var extras = [];
    if (arr && t.sign) extras.push('Meet & greet name sign: ' + signName(t));
    if (t.svc === 'charter' && t.eng) extras.push('English-speaking chauffeur');
    if (l && l.overnight) extras.push('Chauffeur overnight');
    return {
      title: SVC[t.svc] + (isAir ? ' (' + (arr ? 'Arrival' : 'Departure') + ')' : t.svc === 'charter' ? ' (' + (t.hrs === 'custom' ? 'Custom' : t.hrs + ' hours') + ')' : ''),
      when: niceDate(t.date) + ' · ' + t.hh + ':' + t.mm + (arr ? ' (landing)' : t.svc === 'charter' ? ' (start)' : ''),
      flight: isAir ? t.flight : '',
      pickup: pts.from.label, stops: planOpenOf(t) ? ['Plan not set yet'] : pts.stops.map(function (x) { return x.label; }),
      dropoff: t.svc === 'charter' && t.same ? 'Same as pick-up' : pts.to.label,
      vehicle: c.vehicle, pax: String(c.pax), luggage: lug.join(', ') || 'None', seats: seats.join(', '), extras: extras.join(' · ')
    };
  }
  function signName(t) { return (t.signText || '').trim().slice(0, 40) || S.name.trim(); }
  function addOnsOf(t, l) {
    var a = [];
    if (t.sign && t.svc === 'airport' && t.dir === 'arr') a.push('Meet & greet (sign: ' + signName(t) + ')');
    if (t.eng && t.svc === 'charter') a.push('English chauffeur');
    if (t.svc !== 'charter' && P.isNight(t.hh + ':' + t.mm)) a.push('Late night');
    if (l && l.overnight) a.push('Chauffeur overnight');
    return a;
  }
  // display text for one car of one trip; the GAS adds the prices it calculated itself
  function itemFor(it, q) {
    var t = it.t, c = it.c, l = it.l, pts = enginePoints(t), flags = [];
    var h = hoursUntil(t); if (h != null && h < 72) flags.push('Short-notice');
    if (l && l.holiday) flags.push('Lunar New Year');
    if (l && l.manual) flags.push('Custom quote needed');
    if (t.svc === 'charter' && t.plan && t.hrs !== 'custom') flags.push('Plan not set yet');
    if (c.ovs && OTH.some(function (o) { return n0(c[o + 'n']); })) flags.push('Other large item: check the size');
    return {
      id: it.id, ti: it.ti, ci: it.ci, service: SVC[t.svc],
      mode: t.svc === 'airport' ? (t.dir === 'arr' ? 'Arrival' : 'Departure') : t.svc === 'charter' ? (t.hrs === 'custom' ? 'Custom' : t.hrs + ' hours') : '',
      tripcar: 'Day ' + (it.ti + 1) + ' · Car ' + (it.ci + 1),
      flight: t.svc === 'airport' ? t.flight + (t.fres && t.fres.status === 'notfound' ? ' (not in schedule, customer confirmed)' : '') : '',
      date: t.date, time: t.hh + ':' + t.mm,
      pickup: pts.from.label, stops: pts.stops.map(function (x) { return x.label; }),
      dropoff: t.same ? pts.from.label + ' (same as pick-up)' : pts.to.label,
      vehicle: c.vehicle, pax: c.pax,
      luggage: [n0(c.l28) + 'x 28-inch', n0(c.l20) + 'x 20-inch'].concat(ovsText(c, 'x ')).join(', '),
      seats: c.kids && (n0(c.inf) + n0(c.ch)) ? [n0(c.ch) ? n0(c.ch) + ' child seat (2-4)' : '', n0(c.inf) ? n0(c.inf) + ' rear-facing seat (under 2)' : ''].filter(Boolean).join(', ') : '',
      addons: addOnsOf(t, l).join(', '), flags: flags.join(' / '), itinerary: t.itinerary,
      tripNotes: (t.notes || '').trim().slice(0, 1000), carsInTrip: t.cars.length, planOpen: planOpenOf(t),
      cust: custFields(t, c, l),
      details: detailsText(t, it.ti, c, it.ci, l, it.id, q)
    };
  }

  function submit() {
    if (S.submitting) return;
    if (!validate()) { render(); var first = document.querySelector('.obk .bad'); if (first) first.scrollIntoView({ block: 'center' }); return; }
    S.review = true; render();
  }
  function doSubmit() {
    if (S.submitting) return;
    if (!validate()) { S.proc = null; render(); return; }
    S.submitting = true; S.proc = { step: 0, slow: false, err: '' }; render();
    var slowTimer = setTimeout(function () { if (S.proc && !S.proc.err) { S.proc.slow = true; render(); } }, 12000);
    // the same order ID on a retry: the GAS ignores a repeat, so a retry can never create a second booking
    var q = quote(), base = S.pendingId || (S.pendingId = orderBaseId());
    S.proc.quote = !(ONLINE() && q.complete && !q.manual && q.deposit > 0);
    var items = [];
    S.trips.forEach(function (t, ti) { t.cars.forEach(function (c, ci) { items.push({ t: t, ti: ti, c: c, ci: ci, l: lineFor(q, ti, ci) }); }); });
    items.sort(function (a, b) {
      var ka = a.t.date + ' ' + a.t.hh + a.t.mm, kb = b.t.date + ' ' + b.t.hh + b.t.mm;
      return ka < kb ? -1 : ka > kb ? 1 : (a.ti - b.ti) || (a.ci - b.ci);
    });
    items.forEach(function (it, i) { it.id = i === 0 ? base : base + '-' + (i + 1); });
    var rows = items.map(function (it) { return itemFor(it, q); });
    var allDetails = rows.map(function (r) { return r.details; }).join('\n\n');
    var created = new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour12: false });
    var priced = q.complete && !q.manual, payable = ONLINE() && priced && q.deposit > 0, tot = q.total, dep = q.deposit;
    var waLines = rows.map(function (r) { return r.id + ' · ' + r.date + ' ' + r.time + ' · ' + r.service + (r.mode ? ' (' + r.mode + ')' : '') + ' · ' + r.vehicle; });
    var waText = function (t2, d2) {
      return 'Hi ONYX! My booking ' + base + '\nName: ' + S.name + '\n' + waLines.join('\n') + (t2 != null ? '\n' + (ONLINE() ? 'Total: ' + fmt(t2) + ' · Deposit: ' + fmt(d2) : 'Estimated total: ' + fmt(t2)) : '');
    };
    var req = { action: 'submit', orderId: base, order: payload(base), contact: { name: S.name, phone: S.phone, email: S.email },
      remarks: S.remarks, promoCode: S.promo ? S.promo.code : '', hp: S.website || '', items: rows };
    var reg = null, saved = false, noAnswer = false;
    // one request writes the whole order (the GAS re-prices it); one retry is safe because the GAS ignores a repeated order ID.
    // No answer in 45 s: stop waiting and use the backup email (the order may still be saved; the email says to check)
    var send = function () { return gasPost(req, 45000).then(function (r) { return r && r.ok ? r : null; }, function (e) { if (e && e.timeout) noAnswer = true; return null; }); };
    // ?backuptest=1 (owner's test): skip the order sheet so this one booking goes only to the backup email
    (CFG.GAS_URL && !S.backupTest ? send().then(function (r) { return r || noAnswer ? r : send(); }) : Promise.resolve(null)).then(function (r) {
      if (r) { saved = true; if (r.payable) { reg = r; tot = r.total; dep = r.deposit; } else if (r.priced) tot = r.total; }
      if (S.proc) { S.proc.step = 1; render(); }
      // the GAS emails the customer and you; FormSubmit is only the backup to you when that did not happen
      if (saved && r.mailed && r.mailed.owner) return true;
      if (!CFG.FORMSUBMIT_URL) return saved;
      return fetch(CFG.FORMSUBMIT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        _subject: (S.backupTest ? '[TEST] ' : '') + '⚠ Booking ' + base + (saved ? ' – emails not sent, please contact the customer' : noAnswer ? ' – the order sheet did not answer: check the sheet, add it if missing, and contact the customer' : ' – NOT in the order sheet, please add it and contact the customer'),
        _cc: CFG.FORMSUBMIT_CC || '', _template: 'table', _captcha: 'false',
        orderId: base, name: S.name, phone: S.phone, email: S.email, estimatedTotal: priced ? fmt(tot) : 'To be quoted',
        savedToSheet: saved ? 'yes' : 'NO', promoCode: S.promo ? S.promo.code : '-', createdAt: created, orderDetails: allDetails
      }) }).then(function (res) {
        // delivered only when FormSubmit accepted it (an HTTP error or {"success":"false"}, e.g. not activated, is not delivered)
        if (!res.ok) return saved;
        return res.json().then(function (j) { return !(j && String(j.success) === 'false') || saved; }, function () { return true; });
      }, function () { return saved; });
    }).then(function (delivered) {
      S.submitting = false;
      clearTimeout(slowTimer);
      if (!delivered) { S.proc = { step: 0, err: 'The connection failed.' }; render(); return; }
      S.proc = null; S.pendingId = null;
      try { if (window.onyxTrack && !S.backupTest) window.onyxTrack('booking_submitted', { value: priced ? tot : 0, currency: 'TWD', quote_needed: !priced, trips: S.trips.length }); } catch (e) { /* analytics never blocks a booking */ }
      S.done = { id: base, q: { total: tot, deposit: dep }, payable: payable, priced: priced, reg: reg,
        wa: 'https://wa.me/' + (CFG.WHATSAPP || '886970326591') + '?text=' + encodeURIComponent(waText(priced ? tot : null, dep)) };
      render();
      var root = $('onyx-booking'); if (root) root.scrollIntoView({ block: 'start' });
      if (payable) startPayment();
    });
  }

  // What the payment GAS needs to re-check the price (no Google calls on the server)
  function payload(base) {
    return {
      orderId: base, promoCode: S.promo ? S.promo.code : '', contact: { name: S.name, phone: S.phone, email: S.email },
      trips: S.trips.map(function (t) {
        var e = engineTrip(t);
        if (e.route) e.route = { km: e.route.km, durationMin: e.route.durationMin, pointElev: e.route.pointElev, endElev: e.route.endElev, elevs: e.route.elevs, path: (e.route.path || []).map(function (p) { return [p.lat, p.lng]; }) };
        return e;
      })
    };
  }

  /* ---------------- success + PayPal ---------------- */
  function doneHtml() {
    var d = S.done, q = d.q;
    return '<section class="card" aria-label="Booking received"><span class="step-label">Booking received</span>' +
      '<p style="margin:0;font-size:15px">Order <b style="color:var(--gold)">' + esc(d.id) + '</b></p>' +
      (d.payable ? '<div class="summary"><div class="sumrow"><span>Total</span><span class="total" id="obk-tot">' + fmt(q.total) + '</span></div><div class="sumrow"><span>Deposit (pay now)</span><span id="obk-dep">' + fmt(q.deposit) + '</span></div><div class="sumrow"><span>Balance (cash to chauffeur)</span><span id="obk-bal">' + fmt(q.total - q.deposit) + '</span></div></div>' +
        '<div id="obk-pay"><span class="hint">Loading secure payment…</span></div>'
        : (d.priced ? '<div class="summary"><div class="sumrow"><span>Estimated total</span><span class="total" id="obk-tot">' + fmt(q.total) + '</span></div></div>' : '') +
          '<p class="msg warn" style="margin:0">' + nextStep(d.priced) + '</p>') +
      '<div><b>Staying in touch</b><ol class="touch"><li>Save our WhatsApp: +886 970 326 591</li><li>The day before, we\'ll add you to a group chat with your chauffeur.</li></ol></div>' +
      '<a class="btn wa" href="' + esc(d.wa) + '" target="_blank" rel="noopener">WhatsApp us</a>' +
      '<button class="link" type="button" onclick="location.reload()">Book another trip</button>' +
    '</section>';
  }
  // ms: give up after this long (the answer may still come later; a retry with the same order ID is ignored by the GAS)
  function gasPost(body, ms) {
    var call = fetch(CFG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
    if (!ms) return call;
    return Promise.race([call, new Promise(function (res, rej) { setTimeout(function () { rej({ timeout: true }); }, ms); })]);
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
    if (!CFG.GAS_URL || !CFG.PAYPAL_CLIENT_ID || !d.reg) { payFallback('We\'ll send your deposit link by email and WhatsApp shortly.'); return; }
    loadPayPal().then(function () {
      var box = $('obk-pay'); if (!box) return;
      box.innerHTML = '<div id="obk-paypal"></div><p class="hint paylater">Or pay later with the link in your email.</p>';
      window.paypal.Buttons({
        style: { color: 'gold', shape: 'rect', label: 'pay' },
        createOrder: function () { return gasPost({ action: 'create', orderId: d.id, k: d.reg.k }).then(function (r) { if (!r.ok) throw new Error(r.error || 'create'); return r.paypalOrderId; }); },
        onApprove: function (data) {
          return gasPost({ action: 'capture', orderId: d.id, k: d.reg.k, paypalOrderId: data.orderID }).then(function (r) {
            location.href = (r && r.ok ? CFG.SUCCESS_URL : CFG.FAIL_URL) + '?order=' + encodeURIComponent(d.id) + '&k=' + encodeURIComponent(d.reg.k);
          });
        },
        // the PayPal window was closed without paying: keep the booking, offer both ways to pay
        onCancel: function () {
          var b = $('obk-pay'); if (!b) return;
          b.innerHTML = '<div class="paycancel" role="status"><b>Payment not completed</b><p>Your booking is saved, but it\'s not confirmed until the deposit is paid.</p>' +
            '<button class="btn gold" type="button" data-act="paynow">Pay now</button>' +
            '<p class="hint">Or pay later with the link in your email.</p></div>';
        },
        onError: function () { location.href = CFG.FAIL_URL + '?order=' + encodeURIComponent(d.id) + '&k=' + encodeURIComponent(d.reg.k); }
      }).render('#obk-paypal');
    }).catch(function () { payFallback('We\'ll send your deposit link by email and WhatsApp shortly.'); });
  }

  /* ---------------- public API ---------------- */
  window.ONYX_BOOKING = {
    // map picker modal → address
    setAddress: function (inputId, label, lat, lng) { setPoint(inputId, pt(label, lat, lng)); render(); },
    getAddress: function (inputId) { var p = getPoint(inputId); return p ? { label: p.label, lat: p.lat, lng: p.lng } : null; },
    // itinerary "Book" buttons on the page
    // tour "Book" buttons: item = tour id (or an object with .id); plan = option key (where the guest stays)
    prefillItinerary: function (item, plan) {
      var tour = tourOf(item && typeof item === 'object' ? item.id : item); if (!tour) return false;
      var opt = tour.options.filter(function (o) { return o.key === plan; })[0] || tour.options[0];
      var days = opt.split ? opt.split.map(function (ix) { return ix.map(function (i) { return tour.days[0][i]; }); }) : tour.days;
      var g = ++uid, cars = S.trips[0] ? S.trips[0].cars : null, no = 'Itinerary No.' + String(tour.id).padStart(2, '0') + ' ' + tour.title;
      // keep trips the guest already filled in (e.g. an airport transfer); replace empty trips and an earlier itinerary
      var keep = S.trips.filter(function (t) { return hasData(t) && !t.itinerary; });
      var added = days.map(function (stops, di) {
        var t = newTrip(); t.svc = 'charter'; t.hrs = '8';
        t.itinerary = no + (days.length > 1 ? ' · Day ' + (di + 1) + ' of ' + days.length : '');
        t.stops = stops.map(function (x) { return pt(x[0], x[1], x[2]); });
        t.same = opt.days[di][0] === opt.days[di][1];
        // later days: date and pick-up follow the day before until the guest changes them
        t.tour = { g: g, d: di, n: days.length, label: opt.label, autoFrom: di > 0, autoDate: di > 0 };
        t.cars = cars ? cars.map(newCar) : [newCar()];
        return t;
      });
      S.trips = keep.concat(added);
      clearErrors(); dropPromo(); render();
      if (keep.length) { var card = document.querySelectorAll('#obk-trips > .card')[keep.length]; if (card && card.scrollIntoView) setTimeout(function () { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 350); }
      return true;
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
    // while the guest types (phone keyboard open), hide the bottom price bar so it never covers the field or the address suggestions
    var typing = function (el) { return !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|hidden)$/.test(el.type))); };
    document.addEventListener('focusin', function (e) { if (typing(e.target)) document.body.classList.add('obk-typing'); });
    document.addEventListener('focusout', function () { setTimeout(function () { if (!typing(document.activeElement)) document.body.classList.remove('obk-typing'); }, 0); });
    S.mapsDown = !!window.onyxMapsFailed;
    window.addEventListener('onyx-maps', function () { S.mapsDown = !!window.onyxMapsFailed; render(); });
    document.addEventListener('pointerdown', function () { ptrDown = true; }, true);
    document.addEventListener('pointerup', ptrEnd, true);
    document.addEventListener('pointercancel', ptrEnd, true);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('keydown', onKey);
    root.addEventListener('mousedown', function (e) { if (e.target.closest('[data-pick]')) e.preventDefault(); });
    document.addEventListener('click', function (e) {
      if (S.cal && !e.target.closest('.obk .cal') && !e.target.closest('[data-act="cal"],[data-act="day"],[data-act="calnav"]')) { S.cal = null; render(); }
    });
    bar = document.createElement('div');
    bar.id = 'obk-bar'; bar.className = 'obk obk-bar'; bar.hidden = true;
    bar.addEventListener('click', onBarClick);
    document.body.appendChild(bar);
    var tick = false;
    var onScroll = function () { if (tick) return; tick = true; requestAnimationFrame(function () { tick = false; barVisibility(); }); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // currency picker at the top of the page: show converted prices in the new currency
    document.addEventListener('onyx:currency', function () { render(); });
    F.load(CFG.FLIGHTDB_URL);
    render();
    var qs = new URLSearchParams(location.search);
    var svc = qs.get('service'), t0 = S.trips[0];
    if (svc === 'airport' && t0 && !hasData(t0)) {
      t0.svc = 'airport';
      if (AP[qs.get('airport')]) t0.airport = qs.get('airport');
      if (qs.get('dir') === 'arr' || qs.get('dir') === 'dep') t0.dir = qs.get('dir');
      render();
    }
    var ref = qs.get('ref') || qs.get('promo');
    if (ref) window.ONYX_BOOKING.applyPromoCode(ref);
    if (qs.get('backuptest') === '1') {
      S.backupTest = true;
      var bt = document.createElement('div'), host = $('onyx-booking');
      bt.id = 'obk-backuptest'; bt.setAttribute('role', 'status');
      bt.style.cssText = 'margin:0 0 12px;padding:10px 14px;border:1px solid #d4af37;border-radius:10px;color:#d4af37;font-size:13px;line-height:1.5';
      bt.textContent = 'Backup email test: this booking skips the order sheet and is sent only to the backup email (subject starts with [TEST]).';
      if (host && host.parentNode) host.parentNode.insertBefore(bt, host);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
