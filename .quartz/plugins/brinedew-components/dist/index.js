// ../../../node_modules/.pnpm/github-slugger@2.0.0/node_modules/github-slugger/index.js
var own = Object.hasOwnProperty;

// ../../../node_modules/.pnpm/preact@10.29.1/node_modules/preact/dist/preact.mjs
var n;
var l;
var u;
var t;
var i;
var r;
var o;
var e;
var f;
var c;
var s;
var a;
var h;
var p;
var v;
var y;
var d = {};
var w = [];
var _ = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
var g = Array.isArray;
function m(n2, l3) {
  for (var u4 in l3) n2[u4] = l3[u4];
  return n2;
}
function b(n2) {
  n2 && n2.parentNode && n2.parentNode.removeChild(n2);
}
function x(n2, t3, i3, r3, o3) {
  var e3 = { type: n2, props: t3, key: i3, ref: r3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: null == o3 ? ++u : o3, __i: -1, __u: 0 };
  return null == o3 && null != l.vnode && l.vnode(e3), e3;
}
function S(n2) {
  return n2.children;
}
function C(n2, l3) {
  this.props = n2, this.context = l3;
}
function $(n2, l3) {
  if (null == l3) return n2.__ ? $(n2.__, n2.__i + 1) : null;
  for (var u4; l3 < n2.__k.length; l3++) if (null != (u4 = n2.__k[l3]) && null != u4.__e) return u4.__e;
  return "function" == typeof n2.type ? $(n2) : null;
}
function I(n2) {
  if (n2.__P && n2.__d) {
    var u4 = n2.__v, t3 = u4.__e, i3 = [], r3 = [], o3 = m({}, u4);
    o3.__v = u4.__v + 1, l.vnode && l.vnode(o3), q(n2.__P, o3, u4, n2.__n, n2.__P.namespaceURI, 32 & u4.__u ? [t3] : null, i3, null == t3 ? $(u4) : t3, !!(32 & u4.__u), r3), o3.__v = u4.__v, o3.__.__k[o3.__i] = o3, D(i3, o3, r3), u4.__e = u4.__ = null, o3.__e != t3 && P(o3);
  }
}
function P(n2) {
  if (null != (n2 = n2.__) && null != n2.__c) return n2.__e = n2.__c.base = null, n2.__k.some(function(l3) {
    if (null != l3 && null != l3.__e) return n2.__e = n2.__c.base = l3.__e;
  }), P(n2);
}
function A(n2) {
  (!n2.__d && (n2.__d = true) && i.push(n2) && !H.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(H);
}
function H() {
  try {
    for (var n2, l3 = 1; i.length; ) i.length > l3 && i.sort(e), n2 = i.shift(), l3 = i.length, I(n2);
  } finally {
    i.length = H.__r = 0;
  }
}
function L(n2, l3, u4, t3, i3, r3, o3, e3, f4, c3, s3) {
  var a3, h3, p3, v3, y3, _2, g2, m3 = t3 && t3.__k || w, b2 = l3.length;
  for (f4 = T(u4, l3, m3, f4, b2), a3 = 0; a3 < b2; a3++) null != (p3 = u4.__k[a3]) && (h3 = -1 != p3.__i && m3[p3.__i] || d, p3.__i = a3, _2 = q(n2, p3, h3, i3, r3, o3, e3, f4, c3, s3), v3 = p3.__e, p3.ref && h3.ref != p3.ref && (h3.ref && J(h3.ref, null, p3), s3.push(p3.ref, p3.__c || v3, p3)), null == y3 && null != v3 && (y3 = v3), (g2 = !!(4 & p3.__u)) || h3.__k === p3.__k ? (f4 = j(p3, f4, n2, g2), g2 && h3.__e && (h3.__e = null)) : "function" == typeof p3.type && void 0 !== _2 ? f4 = _2 : v3 && (f4 = v3.nextSibling), p3.__u &= -7);
  return u4.__e = y3, f4;
}
function T(n2, l3, u4, t3, i3) {
  var r3, o3, e3, f4, c3, s3 = u4.length, a3 = s3, h3 = 0;
  for (n2.__k = new Array(i3), r3 = 0; r3 < i3; r3++) null != (o3 = l3[r3]) && "boolean" != typeof o3 && "function" != typeof o3 ? ("string" == typeof o3 || "number" == typeof o3 || "bigint" == typeof o3 || o3.constructor == String ? o3 = n2.__k[r3] = x(null, o3, null, null, null) : g(o3) ? o3 = n2.__k[r3] = x(S, { children: o3 }, null, null, null) : void 0 === o3.constructor && o3.__b > 0 ? o3 = n2.__k[r3] = x(o3.type, o3.props, o3.key, o3.ref ? o3.ref : null, o3.__v) : n2.__k[r3] = o3, f4 = r3 + h3, o3.__ = n2, o3.__b = n2.__b + 1, e3 = null, -1 != (c3 = o3.__i = O(o3, u4, f4, a3)) && (a3--, (e3 = u4[c3]) && (e3.__u |= 2)), null == e3 || null == e3.__v ? (-1 == c3 && (i3 > s3 ? h3-- : i3 < s3 && h3++), "function" != typeof o3.type && (o3.__u |= 4)) : c3 != f4 && (c3 == f4 - 1 ? h3-- : c3 == f4 + 1 ? h3++ : (c3 > f4 ? h3-- : h3++, o3.__u |= 4))) : n2.__k[r3] = null;
  if (a3) for (r3 = 0; r3 < s3; r3++) null != (e3 = u4[r3]) && 0 == (2 & e3.__u) && (e3.__e == t3 && (t3 = $(e3)), K(e3, e3));
  return t3;
}
function j(n2, l3, u4, t3) {
  var i3, r3;
  if ("function" == typeof n2.type) {
    for (i3 = n2.__k, r3 = 0; i3 && r3 < i3.length; r3++) i3[r3] && (i3[r3].__ = n2, l3 = j(i3[r3], l3, u4, t3));
    return l3;
  }
  n2.__e != l3 && (t3 && (l3 && n2.type && !l3.parentNode && (l3 = $(n2)), u4.insertBefore(n2.__e, l3 || null)), l3 = n2.__e);
  do {
    l3 = l3 && l3.nextSibling;
  } while (null != l3 && 8 == l3.nodeType);
  return l3;
}
function O(n2, l3, u4, t3) {
  var i3, r3, o3, e3 = n2.key, f4 = n2.type, c3 = l3[u4], s3 = null != c3 && 0 == (2 & c3.__u);
  if (null === c3 && null == e3 || s3 && e3 == c3.key && f4 == c3.type) return u4;
  if (t3 > (s3 ? 1 : 0)) {
    for (i3 = u4 - 1, r3 = u4 + 1; i3 >= 0 || r3 < l3.length; ) if (null != (c3 = l3[o3 = i3 >= 0 ? i3-- : r3++]) && 0 == (2 & c3.__u) && e3 == c3.key && f4 == c3.type) return o3;
  }
  return -1;
}
function z(n2, l3, u4) {
  "-" == l3[0] ? n2.setProperty(l3, null == u4 ? "" : u4) : n2[l3] = null == u4 ? "" : "number" != typeof u4 || _.test(l3) ? u4 : u4 + "px";
}
function N(n2, l3, u4, t3, i3) {
  var r3, o3;
  n: if ("style" == l3) if ("string" == typeof u4) n2.style.cssText = u4;
  else {
    if ("string" == typeof t3 && (n2.style.cssText = t3 = ""), t3) for (l3 in t3) u4 && l3 in u4 || z(n2.style, l3, "");
    if (u4) for (l3 in u4) t3 && u4[l3] == t3[l3] || z(n2.style, l3, u4[l3]);
  }
  else if ("o" == l3[0] && "n" == l3[1]) r3 = l3 != (l3 = l3.replace(a, "$1")), o3 = l3.toLowerCase(), l3 = o3 in n2 || "onFocusOut" == l3 || "onFocusIn" == l3 ? o3.slice(2) : l3.slice(2), n2.l || (n2.l = {}), n2.l[l3 + r3] = u4, u4 ? t3 ? u4[s] = t3[s] : (u4[s] = h, n2.addEventListener(l3, r3 ? v : p, r3)) : n2.removeEventListener(l3, r3 ? v : p, r3);
  else {
    if ("http://www.w3.org/2000/svg" == i3) l3 = l3.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
    else if ("width" != l3 && "height" != l3 && "href" != l3 && "list" != l3 && "form" != l3 && "tabIndex" != l3 && "download" != l3 && "rowSpan" != l3 && "colSpan" != l3 && "role" != l3 && "popover" != l3 && l3 in n2) try {
      n2[l3] = null == u4 ? "" : u4;
      break n;
    } catch (n3) {
    }
    "function" == typeof u4 || (null == u4 || false === u4 && "-" != l3[4] ? n2.removeAttribute(l3) : n2.setAttribute(l3, "popover" == l3 && 1 == u4 ? "" : u4));
  }
}
function V(n2) {
  return function(u4) {
    if (this.l) {
      var t3 = this.l[u4.type + n2];
      if (null == u4[c]) u4[c] = h++;
      else if (u4[c] < t3[s]) return;
      return t3(l.event ? l.event(u4) : u4);
    }
  };
}
function q(n2, u4, t3, i3, r3, o3, e3, f4, c3, s3) {
  var a3, h3, p3, v3, y3, d3, _2, k3, x2, M, $2, I2, P2, A2, H2, T2 = u4.type;
  if (void 0 !== u4.constructor) return null;
  128 & t3.__u && (c3 = !!(32 & t3.__u), o3 = [f4 = u4.__e = t3.__e]), (a3 = l.__b) && a3(u4);
  n: if ("function" == typeof T2) try {
    if (k3 = u4.props, x2 = T2.prototype && T2.prototype.render, M = (a3 = T2.contextType) && i3[a3.__c], $2 = a3 ? M ? M.props.value : a3.__ : i3, t3.__c ? _2 = (h3 = u4.__c = t3.__c).__ = h3.__E : (x2 ? u4.__c = h3 = new T2(k3, $2) : (u4.__c = h3 = new C(k3, $2), h3.constructor = T2, h3.render = Q), M && M.sub(h3), h3.state || (h3.state = {}), h3.__n = i3, p3 = h3.__d = true, h3.__h = [], h3._sb = []), x2 && null == h3.__s && (h3.__s = h3.state), x2 && null != T2.getDerivedStateFromProps && (h3.__s == h3.state && (h3.__s = m({}, h3.__s)), m(h3.__s, T2.getDerivedStateFromProps(k3, h3.__s))), v3 = h3.props, y3 = h3.state, h3.__v = u4, p3) x2 && null == T2.getDerivedStateFromProps && null != h3.componentWillMount && h3.componentWillMount(), x2 && null != h3.componentDidMount && h3.__h.push(h3.componentDidMount);
    else {
      if (x2 && null == T2.getDerivedStateFromProps && k3 !== v3 && null != h3.componentWillReceiveProps && h3.componentWillReceiveProps(k3, $2), u4.__v == t3.__v || !h3.__e && null != h3.shouldComponentUpdate && false === h3.shouldComponentUpdate(k3, h3.__s, $2)) {
        u4.__v != t3.__v && (h3.props = k3, h3.state = h3.__s, h3.__d = false), u4.__e = t3.__e, u4.__k = t3.__k, u4.__k.some(function(n3) {
          n3 && (n3.__ = u4);
        }), w.push.apply(h3.__h, h3._sb), h3._sb = [], h3.__h.length && e3.push(h3);
        break n;
      }
      null != h3.componentWillUpdate && h3.componentWillUpdate(k3, h3.__s, $2), x2 && null != h3.componentDidUpdate && h3.__h.push(function() {
        h3.componentDidUpdate(v3, y3, d3);
      });
    }
    if (h3.context = $2, h3.props = k3, h3.__P = n2, h3.__e = false, I2 = l.__r, P2 = 0, x2) h3.state = h3.__s, h3.__d = false, I2 && I2(u4), a3 = h3.render(h3.props, h3.state, h3.context), w.push.apply(h3.__h, h3._sb), h3._sb = [];
    else do {
      h3.__d = false, I2 && I2(u4), a3 = h3.render(h3.props, h3.state, h3.context), h3.state = h3.__s;
    } while (h3.__d && ++P2 < 25);
    h3.state = h3.__s, null != h3.getChildContext && (i3 = m(m({}, i3), h3.getChildContext())), x2 && !p3 && null != h3.getSnapshotBeforeUpdate && (d3 = h3.getSnapshotBeforeUpdate(v3, y3)), A2 = null != a3 && a3.type === S && null == a3.key ? E(a3.props.children) : a3, f4 = L(n2, g(A2) ? A2 : [A2], u4, t3, i3, r3, o3, e3, f4, c3, s3), h3.base = u4.__e, u4.__u &= -161, h3.__h.length && e3.push(h3), _2 && (h3.__E = h3.__ = null);
  } catch (n3) {
    if (u4.__v = null, c3 || null != o3) if (n3.then) {
      for (u4.__u |= c3 ? 160 : 128; f4 && 8 == f4.nodeType && f4.nextSibling; ) f4 = f4.nextSibling;
      o3[o3.indexOf(f4)] = null, u4.__e = f4;
    } else {
      for (H2 = o3.length; H2--; ) b(o3[H2]);
      B(u4);
    }
    else u4.__e = t3.__e, u4.__k = t3.__k, n3.then || B(u4);
    l.__e(n3, u4, t3);
  }
  else null == o3 && u4.__v == t3.__v ? (u4.__k = t3.__k, u4.__e = t3.__e) : f4 = u4.__e = G(t3.__e, u4, t3, i3, r3, o3, e3, c3, s3);
  return (a3 = l.diffed) && a3(u4), 128 & u4.__u ? void 0 : f4;
}
function B(n2) {
  n2 && (n2.__c && (n2.__c.__e = true), n2.__k && n2.__k.some(B));
}
function D(n2, u4, t3) {
  for (var i3 = 0; i3 < t3.length; i3++) J(t3[i3], t3[++i3], t3[++i3]);
  l.__c && l.__c(u4, n2), n2.some(function(u5) {
    try {
      n2 = u5.__h, u5.__h = [], n2.some(function(n3) {
        n3.call(u5);
      });
    } catch (n3) {
      l.__e(n3, u5.__v);
    }
  });
}
function E(n2) {
  return "object" != typeof n2 || null == n2 || n2.__b > 0 ? n2 : g(n2) ? n2.map(E) : m({}, n2);
}
function G(u4, t3, i3, r3, o3, e3, f4, c3, s3) {
  var a3, h3, p3, v3, y3, w3, _2, m3 = i3.props || d, k3 = t3.props, x2 = t3.type;
  if ("svg" == x2 ? o3 = "http://www.w3.org/2000/svg" : "math" == x2 ? o3 = "http://www.w3.org/1998/Math/MathML" : o3 || (o3 = "http://www.w3.org/1999/xhtml"), null != e3) {
    for (a3 = 0; a3 < e3.length; a3++) if ((y3 = e3[a3]) && "setAttribute" in y3 == !!x2 && (x2 ? y3.localName == x2 : 3 == y3.nodeType)) {
      u4 = y3, e3[a3] = null;
      break;
    }
  }
  if (null == u4) {
    if (null == x2) return document.createTextNode(k3);
    u4 = document.createElementNS(o3, x2, k3.is && k3), c3 && (l.__m && l.__m(t3, e3), c3 = false), e3 = null;
  }
  if (null == x2) m3 === k3 || c3 && u4.data == k3 || (u4.data = k3);
  else {
    if (e3 = e3 && n.call(u4.childNodes), !c3 && null != e3) for (m3 = {}, a3 = 0; a3 < u4.attributes.length; a3++) m3[(y3 = u4.attributes[a3]).name] = y3.value;
    for (a3 in m3) y3 = m3[a3], "dangerouslySetInnerHTML" == a3 ? p3 = y3 : "children" == a3 || a3 in k3 || "value" == a3 && "defaultValue" in k3 || "checked" == a3 && "defaultChecked" in k3 || N(u4, a3, null, y3, o3);
    for (a3 in k3) y3 = k3[a3], "children" == a3 ? v3 = y3 : "dangerouslySetInnerHTML" == a3 ? h3 = y3 : "value" == a3 ? w3 = y3 : "checked" == a3 ? _2 = y3 : c3 && "function" != typeof y3 || m3[a3] === y3 || N(u4, a3, y3, m3[a3], o3);
    if (h3) c3 || p3 && (h3.__html == p3.__html || h3.__html == u4.innerHTML) || (u4.innerHTML = h3.__html), t3.__k = [];
    else if (p3 && (u4.innerHTML = ""), L("template" == t3.type ? u4.content : u4, g(v3) ? v3 : [v3], t3, i3, r3, "foreignObject" == x2 ? "http://www.w3.org/1999/xhtml" : o3, e3, f4, e3 ? e3[0] : i3.__k && $(i3, 0), c3, s3), null != e3) for (a3 = e3.length; a3--; ) b(e3[a3]);
    c3 || (a3 = "value", "progress" == x2 && null == w3 ? u4.removeAttribute("value") : null != w3 && (w3 !== u4[a3] || "progress" == x2 && !w3 || "option" == x2 && w3 != m3[a3]) && N(u4, a3, w3, m3[a3], o3), a3 = "checked", null != _2 && _2 != u4[a3] && N(u4, a3, _2, m3[a3], o3));
  }
  return u4;
}
function J(n2, u4, t3) {
  try {
    if ("function" == typeof n2) {
      var i3 = "function" == typeof n2.__u;
      i3 && n2.__u(), i3 && null == u4 || (n2.__u = n2(u4));
    } else n2.current = u4;
  } catch (n3) {
    l.__e(n3, t3);
  }
}
function K(n2, u4, t3) {
  var i3, r3;
  if (l.unmount && l.unmount(n2), (i3 = n2.ref) && (i3.current && i3.current != n2.__e || J(i3, null, u4)), null != (i3 = n2.__c)) {
    if (i3.componentWillUnmount) try {
      i3.componentWillUnmount();
    } catch (n3) {
      l.__e(n3, u4);
    }
    i3.base = i3.__P = null;
  }
  if (i3 = n2.__k) for (r3 = 0; r3 < i3.length; r3++) i3[r3] && K(i3[r3], u4, t3 || "function" != typeof n2.type);
  t3 || b(n2.__e), n2.__c = n2.__ = n2.__e = void 0;
}
function Q(n2, l3, u4) {
  return this.constructor(n2, u4);
}
n = w.slice, l = { __e: function(n2, l3, u4, t3) {
  for (var i3, r3, o3; l3 = l3.__; ) if ((i3 = l3.__c) && !i3.__) try {
    if ((r3 = i3.constructor) && null != r3.getDerivedStateFromError && (i3.setState(r3.getDerivedStateFromError(n2)), o3 = i3.__d), null != i3.componentDidCatch && (i3.componentDidCatch(n2, t3 || {}), o3 = i3.__d), o3) return i3.__E = i3;
  } catch (l4) {
    n2 = l4;
  }
  throw n2;
} }, u = 0, t = function(n2) {
  return null != n2 && void 0 === n2.constructor;
}, C.prototype.setState = function(n2, l3) {
  var u4;
  u4 = null != this.__s && this.__s != this.state ? this.__s : this.__s = m({}, this.state), "function" == typeof n2 && (n2 = n2(m({}, u4), this.props)), n2 && m(u4, n2), null != n2 && this.__v && (l3 && this._sb.push(l3), A(this));
}, C.prototype.forceUpdate = function(n2) {
  this.__v && (this.__e = true, n2 && this.__h.push(n2), A(this));
}, C.prototype.render = S, i = [], o = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n2, l3) {
  return n2.__v.__b - l3.__v.__b;
}, H.__r = 0, f = Math.random().toString(8), c = "__d" + f, s = "__a" + f, a = /(PointerCapture)$|Capture$/i, h = 0, p = V(false), v = V(true), y = 0;

// ../../../node_modules/.pnpm/preact@10.29.1/node_modules/preact/jsx-runtime/dist/jsxRuntime.mjs
var f2 = 0;
function u2(e3, t3, n2, o3, i3, u4) {
  t3 || (t3 = {});
  var a3, c3, p3 = t3;
  if ("ref" in p3) for (c3 in p3 = {}, t3) "ref" == c3 ? a3 = t3[c3] : p3[c3] = t3[c3];
  var l3 = { type: e3, props: p3, key: n2, ref: a3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --f2, __i: -1, __u: 0, __source: i3, __self: u4 };
  if ("function" == typeof e3 && (a3 = e3.defaultProps)) for (c3 in a3) void 0 === p3[c3] && (p3[c3] = a3[c3]);
  return l.vnode && l.vnode(l3), l3;
}

// ../../../node_modules/.pnpm/@quartz-community+utils@htt_c76798f00f85ebf314780fc8da6c3594/node_modules/@quartz-community/utils/dist/index.js
function simplifySlug(fp) {
  const res = stripSlashes(trimSuffix(fp, "index"), true);
  return res.length === 0 ? "/" : res;
}
function joinSegments(...args) {
  if (args.length === 0) {
    return "";
  }
  let joined = args.filter((segment) => segment !== "" && segment !== "/").map((segment) => stripSlashes(segment)).join("/");
  const first = args[0];
  const last = args[args.length - 1];
  if (first?.startsWith("/")) {
    joined = "/" + joined;
  }
  if (last?.endsWith("/")) {
    joined = joined + "/";
  }
  return joined;
}
function endsWith(s3, suffix) {
  return s3 === suffix || s3.endsWith("/" + suffix);
}
function trimSuffix(s3, suffix) {
  if (endsWith(s3, suffix)) {
    s3 = s3.slice(0, -suffix.length);
  }
  return s3;
}
function stripSlashes(s3, onlyStripPrefix) {
  if (s3.startsWith("/")) {
    s3 = s3.substring(1);
  }
  if (!onlyStripPrefix && s3.endsWith("/")) {
    s3 = s3.slice(0, -1);
  }
  return s3;
}
function isFolderPath(fplike) {
  return fplike.endsWith("/") || endsWith(fplike, "index") || endsWith(fplike, "index.md") || endsWith(fplike, "index.html");
}
function pathToRoot(slug2) {
  let rootPath = slug2.split("/").filter((x2) => x2 !== "").slice(0, -1).map((_2) => "..").join("/");
  if (rootPath.length === 0) {
    rootPath = ".";
  }
  return rootPath;
}
function resolveRelative(current, target) {
  const res = joinSegments(pathToRoot(current), simplifySlug(target));
  return res;
}
function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}
var U200D = String.fromCharCode(8205);

// src/util/crawlability.ts
var truthyFrontmatter = (value) => value === true || value === "true";
var subdomainMappings = {
  "apps/geneguessr": "geneguessr.brinedew.bio",
  "apps/iconoplasm": "iconoplasm.brinedew.bio"
};
function isNoIndexFile(file) {
  const fm = file.frontmatter ?? {};
  return truthyFrontmatter(fm.noindex) || truthyFrontmatter(fm.excludeFromSearch);
}
function isCrawlableFile(file) {
  if (typeof file.slug !== "string" || file.slug.length === 0 || isNoIndexFile(file)) {
    return false;
  }
  if (file.slug.startsWith("Attachments/") || file.slug.includes(".excalidraw")) {
    return false;
  }
  if (typeof file.text === "string" && file.text.trim().length === 0) {
    return false;
  }
  return true;
}
function getPublicUrlForSlug(baseUrl, slug2) {
  const simpleSlug = simplifySlug(slug2);
  if (simpleSlug === "/" || simpleSlug === "index") {
    return `https://${baseUrl}/`;
  }
  for (const [pathPrefix, subdomain] of Object.entries(subdomainMappings)) {
    if (simpleSlug === pathPrefix || simpleSlug.startsWith(pathPrefix + "/")) {
      if (simpleSlug === pathPrefix) {
        return `https://${subdomain}/`;
      }
      return `https://${subdomain}${simpleSlug.slice(pathPrefix.length)}`;
    }
  }
  return `https://${joinSegments(baseUrl, encodeURI(simpleSlug))}`;
}
function classifyCrawlSection(file) {
  const slug2 = String(file.slug ?? "");
  const tags = Array.isArray(file.frontmatter?.tags) ? file.frontmatter.tags : [];
  const isDraft = file.frontmatter?.draft === true || file.frontmatter?.draft === "true";
  if (isDraft) return "drafts";
  if (slug2.startsWith("apps/") || tags.includes("content/apps")) return "apps";
  if (slug2.startsWith("posts/") || tags.includes("content/post")) return "posts";
  if (slug2.startsWith("wiki/") || tags.includes("content/wiki")) return "wiki";
  return "pages";
}

// src/components/homepageApps.ts
var homepageApps = [
  {
    slug: "apps/iconoplasm/index",
    title: "Iconoplasm",
    description: "Gene personas and visual identities for human protein-coding genes."
  },
  {
    slug: "apps/geneguessr/index",
    title: "GeneGuessr",
    description: "A daily protein guessing game built from structure and function clues."
  }
];
function homepageAppHref(baseUrl, app) {
  return getPublicUrlForSlug(baseUrl, app.slug);
}

// src/components/Date.tsx
function getDate(data) {
  if (!data.defaultDateType) {
    throw new Error(
      `Field 'defaultDateType' was not set. Ensure the CreatedModifiedDate plugin is configured with a 'defaultDateType' option. See https://quartz.jzhao.xyz/plugins/CreatedModifiedDate for more details.`
    );
  }
  return data.dates?.[data.defaultDateType];
}
function formatDate(d3, locale = "en-US") {
  return d3.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}
function Date({ date, locale }) {
  return /* @__PURE__ */ u2("time", { datetime: date.toISOString(), children: formatDate(date, locale) });
}

// src/components/PageList.tsx
function byDateAndAlphabetical() {
  return (f1, f22) => {
    if (f1.dates && f22.dates) {
      return getDate(f22).getTime() - getDate(f1).getTime();
    } else if (f1.dates && !f22.dates) {
      return -1;
    } else if (!f1.dates && f22.dates) {
      return 1;
    }
    const f1Title = f1.frontmatter?.title.toLowerCase() ?? "";
    const f2Title = f22.frontmatter?.title.toLowerCase() ?? "";
    return f1Title.localeCompare(f2Title);
  };
}
function byDateAndAlphabeticalFolderFirst() {
  return (f1, f22) => {
    const f1IsFolder = isFolderPath(f1.slug ?? "");
    const f2IsFolder = isFolderPath(f22.slug ?? "");
    if (f1IsFolder && !f2IsFolder) return -1;
    if (!f1IsFolder && f2IsFolder) return 1;
    if (f1.dates && f22.dates) {
      return getDate(f22).getTime() - getDate(f1).getTime();
    } else if (f1.dates && !f22.dates) {
      return -1;
    } else if (!f1.dates && f22.dates) {
      return 1;
    }
    const f1Title = f1.frontmatter?.title.toLowerCase() ?? "";
    const f2Title = f22.frontmatter?.title.toLowerCase() ?? "";
    return f1Title.localeCompare(f2Title);
  };
}
var PageList = ({ cfg, fileData, allFiles, limit, sort }) => {
  const sorter = sort ?? byDateAndAlphabeticalFolderFirst();
  let list = allFiles.sort(sorter);
  if (limit) {
    list = list.slice(0, limit);
  }
  return /* @__PURE__ */ u2("ul", { class: "section-ul", children: list.map((page) => {
    const title = page.frontmatter?.title;
    const tags = page.frontmatter?.tags ?? [];
    return /* @__PURE__ */ u2("li", { class: "section-li", children: /* @__PURE__ */ u2("div", { class: "section", children: [
      /* @__PURE__ */ u2("p", { class: "meta", children: page.dates && /* @__PURE__ */ u2(Date, { date: getDate(page), locale: cfg.locale }) }),
      /* @__PURE__ */ u2("div", { class: "desc", children: /* @__PURE__ */ u2("h3", { children: /* @__PURE__ */ u2(
        "a",
        {
          href: resolveRelative(fileData.slug, page.slug),
          class: "internal internal-link",
          children: title
        }
      ) }) }),
      /* @__PURE__ */ u2("ul", { class: "tags", children: tags.map((tag) => /* @__PURE__ */ u2("li", { children: /* @__PURE__ */ u2(
        "a",
        {
          class: "internal tag-link",
          href: resolveRelative(fileData.slug, `tags/${tag}`),
          children: tag
        }
      ) })) })
    ] }) });
  }) });
};
PageList.css = `
.section h3 {
  margin: 0;
}

.section > .tags {
  margin: 0;
}
`;

// src/components/HomepageCrawlFrontier.tsx
var sectionTitles = {
  posts: "Posts",
  apps: "Apps",
  wiki: "Wiki",
  drafts: "Drafts"
};
var sectionTargets = {
  posts: "tags/content/post",
  apps: "apps/index",
  wiki: "tags/content/wiki",
  drafts: "tags/draft"
};
var sectionLimits = {
  posts: 4,
  wiki: 4,
  drafts: 5
};
var sectionIndexSlugs = /* @__PURE__ */ new Set(["posts/index", "wiki/index", "apps/index"]);
var summarize = (description) => {
  if (typeof description !== "string") return null;
  const compact = description.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > 130 ? `${compact.slice(0, 127).trim()}...` : compact;
};
var homepageDescription = (description) => summarize(description);
var HomepageCrawlFrontier_default = (() => {
  const HomepageCrawlFrontier = ({
    cfg,
    fileData,
    allFiles
  }) => {
    if (fileData.slug !== "index") return null;
    const sorted = allFiles.filter(
      (file) => isCrawlableFile(file) && file.slug !== "index" && !sectionIndexSlugs.has(String(file.slug))
    ).sort(byDateAndAlphabetical());
    const sections = {
      posts: sorted.filter((file) => classifyCrawlSection(file) === "posts").slice(0, sectionLimits.posts),
      wiki: sorted.filter((file) => classifyCrawlSection(file) === "wiki").slice(0, sectionLimits.wiki),
      drafts: sorted.filter((file) => classifyCrawlSection(file) === "drafts").slice(0, sectionLimits.drafts)
    };
    const baseUrl = cfg.baseUrl ?? "brinedew.bio";
    return /* @__PURE__ */ u2("nav", { class: "homepage-crawl-frontier", "aria-label": "Site index", children: /* @__PURE__ */ u2("div", { class: "homepage-crawl-frontier__sections", children: [
      ["posts", "wiki", "drafts"].map(
        (section) => sections[section].length > 0 ? /* @__PURE__ */ u2("section", { children: [
          /* @__PURE__ */ u2("h2", { children: sectionTargets[section] ? /* @__PURE__ */ u2(
            "a",
            {
              class: "internal",
              href: resolveRelative(fileData.slug, sectionTargets[section]),
              children: sectionTitles[section]
            }
          ) : sectionTitles[section] }),
          /* @__PURE__ */ u2("ul", { children: sections[section].map((page) => /* @__PURE__ */ u2("li", { children: /* @__PURE__ */ u2(
            "a",
            {
              class: "internal",
              href: resolveRelative(fileData.slug, page.slug),
              children: page.frontmatter?.title ?? page.slug
            }
          ) })) })
        ] }) : null
      ),
      /* @__PURE__ */ u2("section", { children: [
        /* @__PURE__ */ u2("h2", { children: /* @__PURE__ */ u2(
          "a",
          {
            class: "internal",
            href: resolveRelative(fileData.slug, sectionTargets.apps),
            children: sectionTitles.apps
          }
        ) }),
        /* @__PURE__ */ u2("ul", { children: homepageApps.map((app) => /* @__PURE__ */ u2("li", { children: [
          /* @__PURE__ */ u2("a", { href: homepageAppHref(baseUrl, app), children: app.title }),
          homepageDescription(app.description) && /* @__PURE__ */ u2("p", { children: homepageDescription(app.description) })
        ] })) })
      ] })
    ] }) });
  };
  HomepageCrawlFrontier.css = `
.homepage-crawl-frontier {
  margin: 2.5rem 0 0;
}

.homepage-crawl-frontier__sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 2rem;
}

.homepage-crawl-frontier h2 {
  color: var(--darkgray);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0 0 0.75rem;
  text-transform: uppercase;
}

.homepage-crawl-frontier h2 > a {
  color: inherit;
}

.homepage-crawl-frontier ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.homepage-crawl-frontier li {
  margin: 0 0 0.85rem;
}

.homepage-crawl-frontier li > a {
  display: inline-block;
  line-height: 1.2;
}

.homepage-crawl-frontier p {
  color: var(--gray);
  font-size: 0.92rem;
  line-height: 1.35;
  margin: 0.18rem 0 0;
}
`;
  return HomepageCrawlFrontier;
});

// src/components/IconoplasmPageSwitcher.tsx
var IconoplasmPageSwitcher = ({ fileData, displayClass }) => {
  const slug2 = fileData.slug ?? "";
  const isIconoplasmPage = slug2.startsWith("apps/iconoplasm");
  if (!isIconoplasmPage) return null;
  const activeTab = slug2 === "" || slug2 === "/" ? "archive" : slug2.startsWith("clans") ? "clans" : slug2.startsWith("wiki/Tutorial") ? "tutorial" : void 0;
  return /* @__PURE__ */ u2(
    "nav",
    {
      class: classNames(displayClass, "icono-page-switcher"),
      "aria-label": "Iconoplasm sections",
      "data-icono-page-switcher": true,
      children: [
        /* @__PURE__ */ u2(
          "a",
          {
            href: "/",
            class: classNames("icono-page-tab", activeTab === "archive" && "is-active"),
            "data-icono-nav": true,
            "data-icono-switch": "archive",
            "aria-current": activeTab === "archive" ? "page" : void 0,
            children: "Archive"
          }
        ),
        /* @__PURE__ */ u2(
          "a",
          {
            href: "/clans",
            class: classNames("icono-page-tab", activeTab === "clans" && "is-active"),
            "data-icono-nav": true,
            "data-icono-switch": "clans",
            "aria-current": activeTab === "clans" ? "page" : void 0,
            children: "Clans"
          }
        ),
        /* @__PURE__ */ u2(
          "a",
          {
            href: "/wiki/Tutorial-How-to-generate-and-edit-blots-in-Iconoplasm",
            class: classNames("icono-page-tab", activeTab === "tutorial" && "is-active"),
            "data-icono-nav": true,
            "data-icono-switch": "tutorial",
            "aria-current": activeTab === "tutorial" ? "page" : void 0,
            children: "Tutorial"
          }
        )
      ]
    }
  );
};
IconoplasmPageSwitcher.css = `
.icono-page-switcher {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0.25rem 0 0.85rem;
}

.icono-page-switcher .icono-page-tab {
  display: block;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  background: transparent;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.85rem;
  color: var(--secondary, var(--darkgray));
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.icono-page-switcher .icono-page-tab::before {
  content: none;
}

.icono-page-switcher .icono-page-tab:hover {
  background: color-mix(in srgb, var(--ui-border) 22%, transparent);
  color: var(--dark);
}

.icono-page-switcher .icono-page-tab.is-active,
.icono-page-switcher .icono-page-tab[aria-current="page"] {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
  font-weight: 600;
}
`;
var IconoplasmPageSwitcher_default = (() => IconoplasmPageSwitcher);

// src/components/TagSections.tsx
var SECTION_CONFIG = {
  content: { displayName: "Content" },
  topic: { displayName: "Topics" },
  protein: { displayName: "Proteins" },
  meta: { displayName: "Meta" }
};
var TagSections = ({ fileData, displayClass }) => {
  if (String(fileData.slug ?? "").startsWith("apps/")) return null;
  const isDraft = fileData.frontmatter?.draft === true || fileData.frontmatter?.draft === "true";
  const pageTags = isDraft ? ["draft", ...Array.isArray(fileData.frontmatter?.tags) ? fileData.frontmatter.tags : []] : fileData.frontmatter?.tags ?? [];
  if (!Array.isArray(pageTags) || pageTags.length === 0) {
    return null;
  }
  const sections = /* @__PURE__ */ new Map();
  for (const tag of pageTags) {
    if (typeof tag !== "string") continue;
    const normalized = tag.trim().toLowerCase();
    if (!normalized) continue;
    const parts = normalized.split("/");
    const prefix = parts[0];
    const displayName = parts.length > 1 ? parts.slice(1).join("/") : normalized;
    const sectionKey = parts.length > 1 && SECTION_CONFIG[prefix] ? prefix : "general";
    if (!sections.has(sectionKey)) {
      sections.set(sectionKey, []);
    }
    sections.get(sectionKey).push({ fullPath: normalized, displayName });
  }
  for (const tags of sections.values()) {
    tags.sort((a3, b2) => a3.displayName.localeCompare(b2.displayName));
  }
  const orderedSections = [];
  for (const key of Object.keys(SECTION_CONFIG)) {
    const tags = sections.get(key);
    if (tags && tags.length > 0) {
      orderedSections.push({ key, displayName: SECTION_CONFIG[key].displayName, tags });
    }
  }
  const generalTags = sections.get("general");
  if (generalTags && generalTags.length > 0) {
    orderedSections.push({ key: "general", displayName: "General", tags: generalTags });
  }
  if (orderedSections.length === 0) {
    return null;
  }
  return /* @__PURE__ */ u2("nav", { class: classNames(displayClass, "tag-sections"), children: orderedSections.map((section) => {
    const sectionHref = section.key !== "general" ? resolveRelative(fileData.slug, `tags/${section.key}`) : null;
    return /* @__PURE__ */ u2("div", { class: "tag-section", children: [
      /* @__PURE__ */ u2("h4", { children: sectionHref ? /* @__PURE__ */ u2("a", { href: sectionHref, class: "internal section-link", children: section.displayName }) : section.displayName }),
      /* @__PURE__ */ u2("ul", { children: section.tags.map((tag) => {
        const href = resolveRelative(fileData.slug, `tags/${tag.fullPath}`);
        return /* @__PURE__ */ u2("li", { children: /* @__PURE__ */ u2("a", { href, class: "internal tag-link", children: tag.displayName }) }, tag.fullPath);
      }) })
    ] }, section.key);
  }) });
};
TagSections.css = `
.tag-sections .tag-section {
  margin-bottom: 0.75rem;
}

.tag-sections h4 {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 0 0 0.25rem 0;
  padding: 0;
}

.tag-sections h4 a.section-link {
  color: var(--secondary);
  text-decoration: none;
  background: none;
  padding: 0;
  border-radius: 0;
}

.tag-sections h4 a.section-link:hover {
  color: var(--tertiary);
}

.tag-sections ul {
  list-style: none;
  margin: 0;
  padding: 0;
  padding-left: 0.75rem;
}

.tag-sections li {
  padding: 0.1rem 0;
}

.tag-sections a.tag-link {
  color: var(--dark);
  font-size: 0.9rem;
  text-decoration: none;
  background: none;
  padding: 0;
  border-radius: 0;
}

.tag-sections a.tag-link::before {
  content: none;
}

.tag-sections a.tag-link:hover {
  color: var(--tertiary);
}

@media all and (max-width: 800px) {
  .tag-sections {
    display: none;
    position: fixed;
    top: 4rem;
    left: 0;
    right: 0;
    background: var(--light);
    border-bottom: 1px solid var(--lightgray);
    padding: 0.75rem 1rem;
    z-index: 100;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .tag-sections.mobile-open {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .tag-sections .tag-section {
    margin-bottom: 0;
  }

  .tag-sections ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    padding-left: 0;
  }

  .tag-sections li {
    padding: 0;
  }
}
`;
var TagSections_default = (() => TagSections);

// ../../../node_modules/.pnpm/preact@10.29.1/node_modules/preact/hooks/dist/hooks.mjs
var t2;
var r2;
var u3;
var i2;
var o2 = 0;
var f3 = [];
var c2 = l;
var e2 = c2.__b;
var a2 = c2.__r;
var v2 = c2.diffed;
var l2 = c2.__c;
var m2 = c2.unmount;
var s2 = c2.__;
function p2(n2, t3) {
  c2.__h && c2.__h(r2, n2, o2 || t3), o2 = 0;
  var u4 = r2.__H || (r2.__H = { __: [], __h: [] });
  return n2 >= u4.__.length && u4.__.push({}), u4.__[n2];
}
function d2(n2) {
  return o2 = 1, h2(D2, n2);
}
function h2(n2, u4, i3) {
  var o3 = p2(t2++, 2);
  if (o3.t = n2, !o3.__c && (o3.__ = [i3 ? i3(u4) : D2(void 0, u4), function(n3) {
    var t3 = o3.__N ? o3.__N[0] : o3.__[0], r3 = o3.t(t3, n3);
    t3 !== r3 && (o3.__N = [r3, o3.__[1]], o3.__c.setState({}));
  }], o3.__c = r2, !r2.__f)) {
    var f4 = function(n3, t3, r3) {
      if (!o3.__c.__H) return true;
      var u5 = o3.__c.__H.__.filter(function(n4) {
        return n4.__c;
      });
      if (u5.every(function(n4) {
        return !n4.__N;
      })) return !c3 || c3.call(this, n3, t3, r3);
      var i4 = o3.__c.props !== n3;
      return u5.some(function(n4) {
        if (n4.__N) {
          var t4 = n4.__[0];
          n4.__ = n4.__N, n4.__N = void 0, t4 !== n4.__[0] && (i4 = true);
        }
      }), c3 && c3.call(this, n3, t3, r3) || i4;
    };
    r2.__f = true;
    var c3 = r2.shouldComponentUpdate, e3 = r2.componentWillUpdate;
    r2.componentWillUpdate = function(n3, t3, r3) {
      if (this.__e) {
        var u5 = c3;
        c3 = void 0, f4(n3, t3, r3), c3 = u5;
      }
      e3 && e3.call(this, n3, t3, r3);
    }, r2.shouldComponentUpdate = f4;
  }
  return o3.__N || o3.__;
}
function y2(n2, u4) {
  var i3 = p2(t2++, 3);
  !c2.__s && C2(i3.__H, u4) && (i3.__ = n2, i3.u = u4, r2.__H.__h.push(i3));
}
function j2() {
  for (var n2; n2 = f3.shift(); ) {
    var t3 = n2.__H;
    if (n2.__P && t3) try {
      t3.__h.some(z2), t3.__h.some(B2), t3.__h = [];
    } catch (r3) {
      t3.__h = [], c2.__e(r3, n2.__v);
    }
  }
}
c2.__b = function(n2) {
  r2 = null, e2 && e2(n2);
}, c2.__ = function(n2, t3) {
  n2 && t3.__k && t3.__k.__m && (n2.__m = t3.__k.__m), s2 && s2(n2, t3);
}, c2.__r = function(n2) {
  a2 && a2(n2), t2 = 0;
  var i3 = (r2 = n2.__c).__H;
  i3 && (u3 === r2 ? (i3.__h = [], r2.__h = [], i3.__.some(function(n3) {
    n3.__N && (n3.__ = n3.__N), n3.u = n3.__N = void 0;
  })) : (i3.__h.some(z2), i3.__h.some(B2), i3.__h = [], t2 = 0)), u3 = r2;
}, c2.diffed = function(n2) {
  v2 && v2(n2);
  var t3 = n2.__c;
  t3 && t3.__H && (t3.__H.__h.length && (1 !== f3.push(t3) && i2 === c2.requestAnimationFrame || ((i2 = c2.requestAnimationFrame) || w2)(j2)), t3.__H.__.some(function(n3) {
    n3.u && (n3.__H = n3.u), n3.u = void 0;
  })), u3 = r2 = null;
}, c2.__c = function(n2, t3) {
  t3.some(function(n3) {
    try {
      n3.__h.some(z2), n3.__h = n3.__h.filter(function(n4) {
        return !n4.__ || B2(n4);
      });
    } catch (r3) {
      t3.some(function(n4) {
        n4.__h && (n4.__h = []);
      }), t3 = [], c2.__e(r3, n3.__v);
    }
  }), l2 && l2(n2, t3);
}, c2.unmount = function(n2) {
  m2 && m2(n2);
  var t3, r3 = n2.__c;
  r3 && r3.__H && (r3.__H.__.some(function(n3) {
    try {
      z2(n3);
    } catch (n4) {
      t3 = n4;
    }
  }), r3.__H = void 0, t3 && c2.__e(t3, r3.__v));
};
var k2 = "function" == typeof requestAnimationFrame;
function w2(n2) {
  var t3, r3 = function() {
    clearTimeout(u4), k2 && cancelAnimationFrame(t3), setTimeout(n2);
  }, u4 = setTimeout(r3, 35);
  k2 && (t3 = requestAnimationFrame(r3));
}
function z2(n2) {
  var t3 = r2, u4 = n2.__c;
  "function" == typeof u4 && (n2.__c = void 0, u4()), r2 = t3;
}
function B2(n2) {
  var t3 = r2;
  n2.__c = n2.__(), r2 = t3;
}
function C2(n2, t3) {
  return !n2 || n2.length !== t3.length || t3.some(function(t4, r3) {
    return t4 !== n2[r3];
  });
}
function D2(n2, t3) {
  return "function" == typeof t3 ? t3(n2) : t3;
}

// src/components/Citation.tsx
var CitationComponent = ({ displayClass, cite }) => {
  const [showPopover, setShowPopover] = d2(false);
  const [metadata, setMetadata] = d2(null);
  y2(() => {
    let cancelled = false;
    async function fetchMetadata() {
      try {
        if (cite?.doi) {
          const resp = await fetch(`https://api.crossref.org/works/${cite.doi}`);
          if (!resp.ok) return;
          const data = await resp.json();
          if (cancelled) return;
          setMetadata({
            title: data.message?.title?.[0],
            authors: Array.isArray(data.message?.author) ? data.message.author.map(
              (a3) => `${a3.given} ${a3.family}`
            ) : void 0,
            year: data.message?.published?.["date-parts"]?.[0]?.[0]
          });
        } else if (cite?.zoteroKey) {
          const resp = await fetch(
            `https://api.zotero.org/users/biokozlov/items/${cite.zoteroKey}?format=json`
          );
          if (!resp.ok) return;
          const data = await resp.json();
          if (cancelled) return;
          setMetadata({
            title: data?.data?.title,
            authors: Array.isArray(data?.data?.creators) ? data.data.creators.map(
              (c3) => [c3.firstName, c3.lastName].filter(Boolean).join(" ")
            ) : void 0,
            year: typeof data?.data?.date === "string" ? data.data.date : void 0
          });
        }
      } catch (err) {
        console.warn("Failed to load citation data", err);
      }
    }
    fetchMetadata();
    return () => {
      cancelled = true;
    };
  }, [cite?.doi, cite?.zoteroKey]);
  return /* @__PURE__ */ u2(
    "span",
    {
      class: classNames(displayClass, "citation"),
      onMouseEnter: () => setShowPopover(true),
      onMouseLeave: () => setShowPopover(false),
      children: [
        /* @__PURE__ */ u2("sup", { children: [
          "[",
          metadata?.year || cite?.year || "...",
          "]"
        ] }),
        showPopover && metadata && /* @__PURE__ */ u2("div", { class: "citation-popover", children: [
          /* @__PURE__ */ u2("h4", { children: metadata.title }),
          /* @__PURE__ */ u2("p", { children: metadata.authors?.join(", ") }),
          /* @__PURE__ */ u2("div", { class: "citation-actions", children: /* @__PURE__ */ u2(
            "button",
            {
              onClick: () => navigator.clipboard.writeText(
                `@article{${cite?.doi || cite?.zoteroKey},
  title={${metadata.title}},
  author={${metadata.authors?.join(" and ")}},
  year={${metadata.year}}
}`
              ),
              children: "Copy BibTeX"
            }
          ) })
        ] })
      ]
    }
  );
};
CitationComponent.displayName = "Citation";
CitationComponent.css = `
.citation {
  position: relative;
  cursor: help;
  color: var(--secondary);
}

.citation-popover {
  position: absolute;
  bottom: 100%;
  left: 0;
  background: var(--light);
  border: 1px solid var(--lightgray);
  border-radius: 4px;
  padding: 0.75rem;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  width: 300px;
  z-index: 1000;
  margin-bottom: 0.25rem;
}

.citation-popover h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.9rem;
}

.citation-popover p {
  margin: 0 0 0.5rem 0;
  font-size: 0.8rem;
  color: var(--gray);
}

.citation-actions button {
  background: var(--lightgray);
  border: none;
  padding: 0.25rem 0.5rem;
  border-radius: 2px;
  font-size: 0.75rem;
  cursor: pointer;
}

.citation-actions button:hover {
  background: var(--gray);
}
`;
var Citation_default = (() => CitationComponent);

// ../../../node_modules/.pnpm/hsluv@1.0.2/node_modules/hsluv/dist/hsluv.mjs
var Hsluv = class _Hsluv {
  constructor() {
    this.hex = "#000000";
    this.rgb_r = 0;
    this.rgb_g = 0;
    this.rgb_b = 0;
    this.xyz_x = 0;
    this.xyz_y = 0;
    this.xyz_z = 0;
    this.luv_l = 0;
    this.luv_u = 0;
    this.luv_v = 0;
    this.lch_l = 0;
    this.lch_c = 0;
    this.lch_h = 0;
    this.hsluv_h = 0;
    this.hsluv_s = 0;
    this.hsluv_l = 0;
    this.hpluv_h = 0;
    this.hpluv_p = 0;
    this.hpluv_l = 0;
    this.r0s = 0;
    this.r0i = 0;
    this.r1s = 0;
    this.r1i = 0;
    this.g0s = 0;
    this.g0i = 0;
    this.g1s = 0;
    this.g1i = 0;
    this.b0s = 0;
    this.b0i = 0;
    this.b1s = 0;
    this.b1i = 0;
  }
  static fromLinear(c3) {
    if (c3 <= 31308e-7) {
      return 12.92 * c3;
    } else {
      return 1.055 * Math.pow(c3, 1 / 2.4) - 0.055;
    }
  }
  static toLinear(c3) {
    if (c3 > 0.04045) {
      return Math.pow((c3 + 0.055) / 1.055, 2.4);
    } else {
      return c3 / 12.92;
    }
  }
  static yToL(Y) {
    if (Y <= _Hsluv.epsilon) {
      return Y / _Hsluv.refY * _Hsluv.kappa;
    } else {
      return 116 * Math.pow(Y / _Hsluv.refY, 1 / 3) - 16;
    }
  }
  static lToY(L2) {
    if (L2 <= 8) {
      return _Hsluv.refY * L2 / _Hsluv.kappa;
    } else {
      return _Hsluv.refY * Math.pow((L2 + 16) / 116, 3);
    }
  }
  static rgbChannelToHex(chan) {
    const c3 = Math.round(chan * 255);
    const digit2 = c3 % 16;
    const digit1 = (c3 - digit2) / 16 | 0;
    return _Hsluv.hexChars.charAt(digit1) + _Hsluv.hexChars.charAt(digit2);
  }
  static hexToRgbChannel(hex, offset) {
    const digit1 = _Hsluv.hexChars.indexOf(hex.charAt(offset));
    const digit2 = _Hsluv.hexChars.indexOf(hex.charAt(offset + 1));
    const n2 = digit1 * 16 + digit2;
    return n2 / 255;
  }
  static distanceFromOriginAngle(slope, intercept, angle) {
    const d3 = intercept / (Math.sin(angle) - slope * Math.cos(angle));
    if (d3 < 0) {
      return Infinity;
    } else {
      return d3;
    }
  }
  static distanceFromOrigin(slope, intercept) {
    return Math.abs(intercept) / Math.sqrt(Math.pow(slope, 2) + 1);
  }
  static min6(f1, f22, f32, f4, f5, f6) {
    return Math.min(f1, Math.min(f22, Math.min(f32, Math.min(f4, Math.min(f5, f6)))));
  }
  rgbToHex() {
    this.hex = "#";
    this.hex += _Hsluv.rgbChannelToHex(this.rgb_r);
    this.hex += _Hsluv.rgbChannelToHex(this.rgb_g);
    this.hex += _Hsluv.rgbChannelToHex(this.rgb_b);
  }
  hexToRgb() {
    this.hex = this.hex.toLowerCase();
    this.rgb_r = _Hsluv.hexToRgbChannel(this.hex, 1);
    this.rgb_g = _Hsluv.hexToRgbChannel(this.hex, 3);
    this.rgb_b = _Hsluv.hexToRgbChannel(this.hex, 5);
  }
  xyzToRgb() {
    this.rgb_r = _Hsluv.fromLinear(_Hsluv.m_r0 * this.xyz_x + _Hsluv.m_r1 * this.xyz_y + _Hsluv.m_r2 * this.xyz_z);
    this.rgb_g = _Hsluv.fromLinear(_Hsluv.m_g0 * this.xyz_x + _Hsluv.m_g1 * this.xyz_y + _Hsluv.m_g2 * this.xyz_z);
    this.rgb_b = _Hsluv.fromLinear(_Hsluv.m_b0 * this.xyz_x + _Hsluv.m_b1 * this.xyz_y + _Hsluv.m_b2 * this.xyz_z);
  }
  rgbToXyz() {
    const lr = _Hsluv.toLinear(this.rgb_r);
    const lg = _Hsluv.toLinear(this.rgb_g);
    const lb = _Hsluv.toLinear(this.rgb_b);
    this.xyz_x = 0.41239079926595 * lr + 0.35758433938387 * lg + 0.18048078840183 * lb;
    this.xyz_y = 0.21263900587151 * lr + 0.71516867876775 * lg + 0.072192315360733 * lb;
    this.xyz_z = 0.019330818715591 * lr + 0.11919477979462 * lg + 0.95053215224966 * lb;
  }
  xyzToLuv() {
    const divider = this.xyz_x + 15 * this.xyz_y + 3 * this.xyz_z;
    let varU = 4 * this.xyz_x;
    let varV = 9 * this.xyz_y;
    if (divider !== 0) {
      varU /= divider;
      varV /= divider;
    } else {
      varU = NaN;
      varV = NaN;
    }
    this.luv_l = _Hsluv.yToL(this.xyz_y);
    if (this.luv_l === 0) {
      this.luv_u = 0;
      this.luv_v = 0;
    } else {
      this.luv_u = 13 * this.luv_l * (varU - _Hsluv.refU);
      this.luv_v = 13 * this.luv_l * (varV - _Hsluv.refV);
    }
  }
  luvToXyz() {
    if (this.luv_l === 0) {
      this.xyz_x = 0;
      this.xyz_y = 0;
      this.xyz_z = 0;
      return;
    }
    const varU = this.luv_u / (13 * this.luv_l) + _Hsluv.refU;
    const varV = this.luv_v / (13 * this.luv_l) + _Hsluv.refV;
    this.xyz_y = _Hsluv.lToY(this.luv_l);
    this.xyz_x = 0 - 9 * this.xyz_y * varU / ((varU - 4) * varV - varU * varV);
    this.xyz_z = (9 * this.xyz_y - 15 * varV * this.xyz_y - varV * this.xyz_x) / (3 * varV);
  }
  luvToLch() {
    this.lch_l = this.luv_l;
    this.lch_c = Math.sqrt(this.luv_u * this.luv_u + this.luv_v * this.luv_v);
    if (this.lch_c < 1e-8) {
      this.lch_h = 0;
    } else {
      const hrad = Math.atan2(this.luv_v, this.luv_u);
      this.lch_h = hrad * 180 / Math.PI;
      if (this.lch_h < 0) {
        this.lch_h = 360 + this.lch_h;
      }
    }
  }
  lchToLuv() {
    const hrad = this.lch_h / 180 * Math.PI;
    this.luv_l = this.lch_l;
    this.luv_u = Math.cos(hrad) * this.lch_c;
    this.luv_v = Math.sin(hrad) * this.lch_c;
  }
  calculateBoundingLines(l3) {
    const sub1 = Math.pow(l3 + 16, 3) / 1560896;
    const sub2 = sub1 > _Hsluv.epsilon ? sub1 : l3 / _Hsluv.kappa;
    const s1r = sub2 * (284517 * _Hsluv.m_r0 - 94839 * _Hsluv.m_r2);
    const s2r = sub2 * (838422 * _Hsluv.m_r2 + 769860 * _Hsluv.m_r1 + 731718 * _Hsluv.m_r0);
    const s3r = sub2 * (632260 * _Hsluv.m_r2 - 126452 * _Hsluv.m_r1);
    const s1g = sub2 * (284517 * _Hsluv.m_g0 - 94839 * _Hsluv.m_g2);
    const s2g = sub2 * (838422 * _Hsluv.m_g2 + 769860 * _Hsluv.m_g1 + 731718 * _Hsluv.m_g0);
    const s3g = sub2 * (632260 * _Hsluv.m_g2 - 126452 * _Hsluv.m_g1);
    const s1b = sub2 * (284517 * _Hsluv.m_b0 - 94839 * _Hsluv.m_b2);
    const s2b = sub2 * (838422 * _Hsluv.m_b2 + 769860 * _Hsluv.m_b1 + 731718 * _Hsluv.m_b0);
    const s3b = sub2 * (632260 * _Hsluv.m_b2 - 126452 * _Hsluv.m_b1);
    this.r0s = s1r / s3r;
    this.r0i = s2r * l3 / s3r;
    this.r1s = s1r / (s3r + 126452);
    this.r1i = (s2r - 769860) * l3 / (s3r + 126452);
    this.g0s = s1g / s3g;
    this.g0i = s2g * l3 / s3g;
    this.g1s = s1g / (s3g + 126452);
    this.g1i = (s2g - 769860) * l3 / (s3g + 126452);
    this.b0s = s1b / s3b;
    this.b0i = s2b * l3 / s3b;
    this.b1s = s1b / (s3b + 126452);
    this.b1i = (s2b - 769860) * l3 / (s3b + 126452);
  }
  calcMaxChromaHpluv() {
    const r0 = _Hsluv.distanceFromOrigin(this.r0s, this.r0i);
    const r1 = _Hsluv.distanceFromOrigin(this.r1s, this.r1i);
    const g0 = _Hsluv.distanceFromOrigin(this.g0s, this.g0i);
    const g1 = _Hsluv.distanceFromOrigin(this.g1s, this.g1i);
    const b0 = _Hsluv.distanceFromOrigin(this.b0s, this.b0i);
    const b1 = _Hsluv.distanceFromOrigin(this.b1s, this.b1i);
    return _Hsluv.min6(r0, r1, g0, g1, b0, b1);
  }
  calcMaxChromaHsluv(h3) {
    const hueRad = h3 / 360 * Math.PI * 2;
    const r0 = _Hsluv.distanceFromOriginAngle(this.r0s, this.r0i, hueRad);
    const r1 = _Hsluv.distanceFromOriginAngle(this.r1s, this.r1i, hueRad);
    const g0 = _Hsluv.distanceFromOriginAngle(this.g0s, this.g0i, hueRad);
    const g1 = _Hsluv.distanceFromOriginAngle(this.g1s, this.g1i, hueRad);
    const b0 = _Hsluv.distanceFromOriginAngle(this.b0s, this.b0i, hueRad);
    const b1 = _Hsluv.distanceFromOriginAngle(this.b1s, this.b1i, hueRad);
    return _Hsluv.min6(r0, r1, g0, g1, b0, b1);
  }
  hsluvToLch() {
    if (this.hsluv_l > 99.9999999) {
      this.lch_l = 100;
      this.lch_c = 0;
    } else if (this.hsluv_l < 1e-8) {
      this.lch_l = 0;
      this.lch_c = 0;
    } else {
      this.lch_l = this.hsluv_l;
      this.calculateBoundingLines(this.hsluv_l);
      const max = this.calcMaxChromaHsluv(this.hsluv_h);
      this.lch_c = max / 100 * this.hsluv_s;
    }
    this.lch_h = this.hsluv_h;
  }
  lchToHsluv() {
    if (this.lch_l > 99.9999999) {
      this.hsluv_s = 0;
      this.hsluv_l = 100;
    } else if (this.lch_l < 1e-8) {
      this.hsluv_s = 0;
      this.hsluv_l = 0;
    } else {
      this.calculateBoundingLines(this.lch_l);
      const max = this.calcMaxChromaHsluv(this.lch_h);
      this.hsluv_s = this.lch_c / max * 100;
      this.hsluv_l = this.lch_l;
    }
    this.hsluv_h = this.lch_h;
  }
  hpluvToLch() {
    if (this.hpluv_l > 99.9999999) {
      this.lch_l = 100;
      this.lch_c = 0;
    } else if (this.hpluv_l < 1e-8) {
      this.lch_l = 0;
      this.lch_c = 0;
    } else {
      this.lch_l = this.hpluv_l;
      this.calculateBoundingLines(this.hpluv_l);
      const max = this.calcMaxChromaHpluv();
      this.lch_c = max / 100 * this.hpluv_p;
    }
    this.lch_h = this.hpluv_h;
  }
  lchToHpluv() {
    if (this.lch_l > 99.9999999) {
      this.hpluv_p = 0;
      this.hpluv_l = 100;
    } else if (this.lch_l < 1e-8) {
      this.hpluv_p = 0;
      this.hpluv_l = 0;
    } else {
      this.calculateBoundingLines(this.lch_l);
      const max = this.calcMaxChromaHpluv();
      this.hpluv_p = this.lch_c / max * 100;
      this.hpluv_l = this.lch_l;
    }
    this.hpluv_h = this.lch_h;
  }
  hsluvToRgb() {
    this.hsluvToLch();
    this.lchToLuv();
    this.luvToXyz();
    this.xyzToRgb();
  }
  hpluvToRgb() {
    this.hpluvToLch();
    this.lchToLuv();
    this.luvToXyz();
    this.xyzToRgb();
  }
  hsluvToHex() {
    this.hsluvToRgb();
    this.rgbToHex();
  }
  hpluvToHex() {
    this.hpluvToRgb();
    this.rgbToHex();
  }
  rgbToHsluv() {
    this.rgbToXyz();
    this.xyzToLuv();
    this.luvToLch();
    this.lchToHpluv();
    this.lchToHsluv();
  }
  rgbToHpluv() {
    this.rgbToXyz();
    this.xyzToLuv();
    this.luvToLch();
    this.lchToHpluv();
    this.lchToHpluv();
  }
  hexToHsluv() {
    this.hexToRgb();
    this.rgbToHsluv();
  }
  hexToHpluv() {
    this.hexToRgb();
    this.rgbToHpluv();
  }
};
Hsluv.hexChars = "0123456789abcdef";
Hsluv.refY = 1;
Hsluv.refU = 0.19783000664283;
Hsluv.refV = 0.46831999493879;
Hsluv.kappa = 903.2962962;
Hsluv.epsilon = 0.0088564516;
Hsluv.m_r0 = 3.240969941904521;
Hsluv.m_r1 = -1.537383177570093;
Hsluv.m_r2 = -0.498610760293;
Hsluv.m_g0 = -0.96924363628087;
Hsluv.m_g1 = 1.87596750150772;
Hsluv.m_g2 = 0.041555057407175;
Hsluv.m_b0 = 0.055630079696993;
Hsluv.m_b1 = -0.20397695888897;
Hsluv.m_b2 = 1.056971514242878;

// src/components/ProteinInfobox.tsx
var MAPPINGS = [
  { source: "mass", target: "height" },
  { source: "Has transmembrane domains", target: "Sex" },
  { source: "membrane_depth", target: "background_setting" },
  { source: "alignment", target: "Politics" },
  { source: "first_letter", target: "Skintone Hue " },
  { source: "rvis_percentile", target: "Skintone Lightness" },
  { source: "tissue_tau", target: "Skintone Saturation" },
  { source: "kegg_families", target: "Aesthetics" },
  { source: "percent_disordered", target: "Age" }
];
var ProteinInfobox = ({ fileData, displayClass }) => {
  const fm = fileData.frontmatter ?? {};
  const tagList = Array.isArray(fm.tags) ? fm.tags : [];
  if (!tagList.includes("protein")) {
    return null;
  }
  const mappings = MAPPINGS;
  const toStringValue = (value, fallback = "") => {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return fallback;
  };
  const toNumberValue = (value, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  };
  const visibleMappings = mappings.filter((m3) => {
    const molecularValue = fm?.[m3.source];
    const targetNormalized = m3.target.toLowerCase().replace(/\s+/g, "_").replace(/_+$/, "");
    const personaKey = `persona_${targetNormalized}`;
    const personaValue = fm?.[personaKey];
    const hasMolecular = molecularValue !== void 0 && molecularValue !== null && molecularValue !== "" && String(molecularValue).toLowerCase() !== "nan";
    const hasPersona = personaValue !== void 0 && personaValue !== null && personaValue !== "" && String(personaValue).toLowerCase() !== "nan";
    return hasMolecular && hasPersona;
  });
  const personaImage = toStringValue(fm.persona_image) || (typeof fm.uniprot_id === "string" ? `/static/proteins/${fm.uniprot_id}.png` : "");
  const toHexHsluv = (h3, s3, l3) => {
    const hue = (h3 % 360 + 360) % 360;
    const sat = Math.max(0, Math.min(100, s3));
    const lum = Math.max(0, Math.min(100, l3));
    const conv = new Hsluv();
    conv.hsluv_h = hue;
    conv.hsluv_s = sat;
    conv.hsluv_l = lum;
    conv.hsluvToHex();
    return conv.hex;
  };
  let hexcode = toStringValue(fm.persona_hexcode);
  if (!hexcode || hexcode === "null") {
    const hue = toNumberValue(fm.persona_skintone_hue, 0);
    const sat = toNumberValue(fm.persona_skintone_saturation, 50);
    const light = toNumberValue(fm.persona_skintone_lightness, 50);
    hexcode = toHexHsluv(hue, sat, light);
  }
  const geneSymbol = toStringValue(fm.symbol) || toStringValue(fm.gene_symbol) || toStringValue(fm.title, "Protein");
  const prettifyLabel = (fieldName) => {
    const labelMap = {
      mass: "Mass",
      length: "Length",
      percent_disordered: "Disorder",
      rvis_percentile: "RVIS",
      alignment: "Classification",
      first_letter: "First Letter",
      "Has transmembrane domains": "Transmembrane",
      membrane_depth: "Membrane Depth",
      tissue_tau: "Tissue Specificity",
      height: "Height",
      Sex: "Gender",
      Politics: "Politics",
      "Skintone Hue ": "Skin Hue",
      "Skintone Saturation": "Skin Saturation",
      "Skintone Lightness": "Skin Lightness",
      Aesthetics: "Aesthetics",
      background_setting: "Setting",
      Age: "Age"
    };
    return labelMap[fieldName] || fieldName;
  };
  const formatValue = (fieldName, value) => {
    const unitMap = {
      mass: " kDa",
      length: " aa",
      percent_disordered: "%",
      rvis_percentile: "",
      height: " cm",
      Age: "",
      "Skintone Hue ": "",
      "Skintone Saturation": "%",
      "Skintone Lightness": "%"
    };
    const unit = unitMap[fieldName] || "";
    return `${value}${unit}`;
  };
  return /* @__PURE__ */ u2("div", { class: classNames(displayClass, "protein-infobox"), children: [
    /* @__PURE__ */ u2("div", { class: "infobox-image-container", children: /* @__PURE__ */ u2("div", { class: "infobox-image", style: `background-color: ${hexcode}`, children: [
      /* @__PURE__ */ u2(
        "img",
        {
          src: personaImage,
          alt: `${geneSymbol} persona portrait`,
          onError: (e3) => {
            const target = e3.target;
            target.style.display = "none";
            const placeholder = target.nextElementSibling;
            if (placeholder) placeholder.style.display = "flex";
          }
        }
      ),
      /* @__PURE__ */ u2(
        "div",
        {
          class: "infobox-image-placeholder",
          style: `background-color: ${hexcode}; display: none;`,
          children: geneSymbol
        }
      )
    ] }) }),
    /* @__PURE__ */ u2("div", { class: "infobox-title", children: /* @__PURE__ */ u2("h3", { children: geneSymbol }) }),
    visibleMappings.length > 0 && /* @__PURE__ */ u2("div", { class: "infobox-mappings", children: [
      /* @__PURE__ */ u2("div", { class: "mapping-header", children: [
        /* @__PURE__ */ u2("span", { class: "mapping-col-title", children: "Molecular" }),
        /* @__PURE__ */ u2("span", { class: "mapping-arrow", children: "\u2192" }),
        /* @__PURE__ */ u2("span", { class: "mapping-col-title", children: "Persona" })
      ] }),
      visibleMappings.map((m3) => {
        const targetNormalized = m3.target.toLowerCase().replace(/\s+/g, "_").replace(/_+$/, "");
        const personaKey = `persona_${targetNormalized}`;
        const molecularValue = fm[m3.source];
        const personaValue = fm[personaKey];
        const isHueMapping = m3.source === "first_letter" && m3.target === "Skintone Hue ";
        let personaDisplay = formatValue(m3.target, personaValue);
        if (isHueMapping) {
          const hue = fm?.persona_skintone_hue || 0;
          const letter = (molecularValue || "X").toUpperCase();
          const hueColor = toHexHsluv(hue, 100, 50);
          const letterCode = letter.charCodeAt(0);
          let enclosedChar = letter;
          if (letterCode >= 65 && letterCode <= 90) {
            enclosedChar = String.fromCodePoint(127344 + (letterCode - 65));
          }
          return /* @__PURE__ */ u2("div", { class: "mapping-row", children: [
            /* @__PURE__ */ u2("div", { class: "mapping-molecular", children: [
              /* @__PURE__ */ u2("span", { class: "mapping-label", children: prettifyLabel(m3.source) }),
              /* @__PURE__ */ u2("span", { class: "mapping-value", children: letter })
            ] }),
            /* @__PURE__ */ u2("span", { class: "mapping-arrow", children: "\u2192" }),
            /* @__PURE__ */ u2("div", { class: "mapping-persona", children: [
              /* @__PURE__ */ u2("span", { class: "mapping-label", children: prettifyLabel(m3.target) }),
              /* @__PURE__ */ u2("span", { class: "mapping-value", children: /* @__PURE__ */ u2("span", { class: "hue-letter", style: `color: ${hueColor}; font-size: 1.4rem;`, children: enclosedChar }) })
            ] })
          ] });
        }
        return /* @__PURE__ */ u2("div", { class: "mapping-row", children: [
          /* @__PURE__ */ u2("div", { class: "mapping-molecular", children: [
            /* @__PURE__ */ u2("span", { class: "mapping-label", children: prettifyLabel(m3.source) }),
            /* @__PURE__ */ u2("span", { class: "mapping-value", children: formatValue(m3.source, molecularValue) })
          ] }),
          /* @__PURE__ */ u2("span", { class: "mapping-arrow", children: "\u2192" }),
          /* @__PURE__ */ u2("div", { class: "mapping-persona", children: [
            /* @__PURE__ */ u2("span", { class: "mapping-label", children: prettifyLabel(m3.target) }),
            /* @__PURE__ */ u2("span", { class: "mapping-value", children: personaDisplay })
          ] })
        ] });
      })
    ] }),
    fm?.uniprot_id && /* @__PURE__ */ u2("div", { class: "infobox-footer", children: /* @__PURE__ */ u2(
      "a",
      {
        href: `https://www.uniprot.org/uniprotkb/${fm.uniprot_id}`,
        target: "_blank",
        rel: "noopener",
        children: [
          "UniProt: ",
          fm.uniprot_id
        ]
      }
    ) })
  ] });
};
ProteinInfobox.css = `
.protein-infobox {
  float: right;
  width: 320px;
  margin: 0 0 1.5rem 1.5rem;
  border: 1px solid var(--border);
  background: var(--light);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.9rem;
  clear: right;
}

.protein-infobox.in-gallery {
  float: none !important;
  width: 100% !important;
  margin: 0 !important;
  clear: none !important;
}

.infobox-image-container {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 5;
  overflow: hidden;
}

.infobox-image {
  width: 100%;
  height: 100%;
  position: relative;
}

.infobox-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.infobox-image-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: 600;
  color: var(--light);
  text-align: center;
  padding: 1rem;
}

.infobox-title {
  padding: 1rem;
  text-align: center;
  border-bottom: 1px solid var(--border);
  background: var(--lightgray);
}

.infobox-title h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--dark);
}

.infobox-mappings {
  padding: 1rem;
}

.mapping-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--border);
}

.mapping-col-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--darkgray);
  text-align: center;
}

.mapping-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--lightgray);
}

.mapping-row:last-child {
  border-bottom: none;
}

.mapping-molecular,
.mapping-persona {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-align: center;
  align-items: center;
}

.mapping-label {
  font-size: 0.7rem;
  color: var(--darkgray);
  font-weight: 500;
  text-align: center;
}

.mapping-value {
  font-size: 0.85rem;
  color: var(--dark);
  font-weight: 600;
  text-align: center;
}

.hue-letter {
  display: inline-block;
  line-height: 1;
}

.mapping-arrow {
  color: var(--accent);
  font-weight: bold;
  font-size: 1rem;
  text-align: center;
}

.infobox-footer {
  padding: 0.75rem 1rem;
  background: var(--highlight);
  border-top: 1px solid var(--border);
  text-align: center;
}

.infobox-footer a {
  color: var(--secondary);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 500;
}

.infobox-footer a:hover {
  text-decoration: underline;
}

@media (max-width: 800px) {
  .protein-infobox {
    float: none;
    width: 100%;
    margin: 1rem 0;
  }
}
`;
var ProteinInfobox_default = (() => ProteinInfobox);

// src/components/ContactForm.tsx
var ContactForm = (opts = {}) => {
  const endpoint = opts.endpoint || "/api/contact";
  const Component = ({ fileData }) => {
    const frontmatter = fileData?.frontmatter || null;
    const aliases = ["contact", "contactForm", "showContactForm"];
    const wantsForm = Array.isArray(frontmatter) ? frontmatter.some((v3) => aliases.includes(String(v3))) : frontmatter && typeof frontmatter === "object" ? aliases.some((k3) => Boolean(frontmatter[k3])) : false;
    if (!wantsForm) return null;
    return /* @__PURE__ */ u2("div", { class: "contact-form-card", "data-contact-form-root": true, "data-endpoint": endpoint, children: /* @__PURE__ */ u2("form", { class: "contact-form", "data-contact-form": true, novalidate: true, children: [
      /* @__PURE__ */ u2("label", { class: "contact-form__field", children: [
        /* @__PURE__ */ u2("span", { class: "contact-form__label", children: "Email" }),
        /* @__PURE__ */ u2(
          "input",
          {
            class: "contact-form__input",
            type: "email",
            name: "email",
            required: true,
            maxLength: 254,
            autocomplete: "email",
            placeholder: "you@example.com"
          }
        )
      ] }),
      /* @__PURE__ */ u2("label", { class: "contact-form__field", children: [
        /* @__PURE__ */ u2("span", { class: "contact-form__label", children: "Message" }),
        /* @__PURE__ */ u2(
          "textarea",
          {
            class: "contact-form__textarea",
            name: "message",
            required: true,
            rows: 6,
            maxLength: 5e3
          }
        )
      ] }),
      /* @__PURE__ */ u2("div", { class: "contact-form__honeypot", "aria-hidden": "true", children: /* @__PURE__ */ u2("label", { children: [
        "Website",
        /* @__PURE__ */ u2(
          "input",
          {
            type: "text",
            name: "website",
            tabIndex: -1,
            autocomplete: "off",
            "aria-hidden": "true"
          }
        )
      ] }) }),
      /* @__PURE__ */ u2("div", { class: "contact-form__actions", children: /* @__PURE__ */ u2(
        "button",
        {
          class: "contact-form__submit",
          type: "submit",
          "data-contact-form-submit": true,
          children: "Send"
        }
      ) }),
      /* @__PURE__ */ u2(
        "p",
        {
          class: "contact-form__status",
          "data-contact-form-status": true,
          "data-tone": "neutral",
          "aria-live": "polite",
          role: "status"
        }
      )
    ] }) });
  };
  Component.displayName = "ContactForm";
  Component.css = `
.contact-form-card {
  margin: 2.25rem 0 1.5rem;
  padding: 1.75rem 1.5rem 1.5rem;
  border: 1px solid var(--gray);
  border-radius: 16px;
  background: var(--light);
  max-width: 36rem;
}

.contact-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.contact-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.contact-form__label {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--darkgray);
}

.contact-form__input,
.contact-form__textarea {
  font: inherit;
  color: var(--dark);
  background: var(--lightgray);
  border: 1px solid var(--gray);
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.contact-form__textarea {
  resize: vertical;
  min-height: 6.5rem;
  font-family: inherit;
  line-height: 1.5;
}

.contact-form__input:focus,
.contact-form__textarea:focus {
  outline: none;
  border-color: var(--tertiary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tertiary) 25%, transparent);
}

.contact-form__honeypot {
  position: absolute;
  left: -10000px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.contact-form__actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.contact-form__submit {
  font: inherit;
  font-weight: 600;
  color: var(--light);
  background: var(--tertiary);
  border: 1px solid var(--tertiary);
  border-radius: 8px;
  padding: 0.7rem 1.2rem;
  cursor: pointer;
  transition: filter 120ms ease, transform 120ms ease;
}

.contact-form__submit:hover:not(:disabled) {
  filter: brightness(0.95);
}

.contact-form__submit:active:not(:disabled) {
  transform: translateY(1px);
}

.contact-form__submit:disabled {
  opacity: 0.6;
  cursor: progress;
}

.contact-form__status {
  margin: 0;
  min-height: 1.25rem;
  font-size: 0.92rem;
  color: var(--darkgray);
  line-height: 1.4;
}

.contact-form__status[data-tone="ok"] {
  color: oklch(45% 0.12 150);
}

.contact-form__status[data-tone="error"] {
  color: oklch(50% 0.18 25);
}
`;
  Component.afterDOMLoaded = `
(function () {
  function attach(root) {
    if (!root || root.__contactFormWired === true) return;
    var form = root.querySelector("[data-contact-form]");
    if (!form) return;
    root.__contactFormWired = true;
    var endpoint = root.getAttribute("data-endpoint") || "/api/contact";
    var status = root.querySelector("[data-contact-form-status]");
    var submit = root.querySelector("[data-contact-form-submit]");

    function setStatus(message, tone) {
      if (!status) return;
      status.textContent = String(message || "");
      status.setAttribute("data-tone", tone || "neutral");
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var emailInput = form.querySelector("input[name='email']");
      var messageInput = form.querySelector("textarea[name='message']");
      var honeypot = form.querySelector("input[name='website']");

      var email = emailInput ? String(emailInput.value || "").trim() : "";
      var message = messageInput ? String(messageInput.value || "").trim() : "";

      if (!email) {
        setStatus("Enter your email.", "error");
        if (emailInput) emailInput.focus();
        return;
      }
      if (!message || message.length < 3) {
        setStatus("Write a message.", "error");
        if (messageInput) messageInput.focus();
        return;
      }

      if (submit) submit.disabled = true;
      setStatus("Sending\u2026", "neutral");

      var payload = {
        email: email,
        message: message,
        website: honeypot ? String(honeypot.value || "") : "",
      };

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (resp) {
          return resp.text().then(function (text) {
            var data = null;
            try { data = text ? JSON.parse(text) : null; } catch (_e) { data = { raw: text }; }
            return { ok: resp.ok, status: resp.status, data: data };
          });
        })
        .then(function (result) {
          if (result.ok) {
            setStatus("Thanks \u2014 your message is on its way to my inbox.", "ok");
            form.reset();
          } else {
            var msg = (result.data && result.data.error) ? result.data.error : ("HTTP " + result.status);
            setStatus(msg, "error");
          }
        })
        .catch(function (err) {
          setStatus(String((err && err.message) || err || "Submission failed."), "error");
        })
        .finally(function () {
          if (submit) submit.disabled = false;
        });
    });
  }

  // Attach to anything currently on the page, and re-attach on Quartz's
  // SPA navigation events. The form is rendered only on pages that include
  // the ContactForm component, but Quartz replaces the body on each nav.
  function init() {
    var roots = document.querySelectorAll("[data-contact-form-root]");
    for (var i = 0; i < roots.length; i++) attach(roots[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Quartz SPA nav fires a popstate on browser back/forward; emit a custom
  // event the form can listen to. We hook into history.pushState too.
  var origPush = history.pushState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    window.dispatchEvent(new Event("quartz:nav"));
  };
  window.addEventListener("popstate", function () { window.dispatchEvent(new Event("quartz:nav")); });
  window.addEventListener("quartz:nav", init);
})();
`;
  return Component;
};
var ContactForm_default = ContactForm;

// ../../../node_modules/.pnpm/unist-util-is@6.0.1/node_modules/unist-util-is/lib/index.js
var convert = (
  // Note: overloads in JSDoc can’t yet use different `@template`s.
  /**
   * @type {(
   *   (<Condition extends string>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & {type: Condition}) &
   *   (<Condition extends Props>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Condition) &
   *   (<Condition extends TestFunction>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Predicate<Condition, Node>) &
   *   ((test?: null | undefined) => (node?: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node) &
   *   ((test?: Test) => Check)
   * )}
   */
  /**
   * @param {Test} [test]
   * @returns {Check}
   */
  (function(test) {
    if (test === null || test === void 0) {
      return ok;
    }
    if (typeof test === "function") {
      return castFactory(test);
    }
    if (typeof test === "object") {
      return Array.isArray(test) ? anyFactory(test) : (
        // Cast because `ReadonlyArray` goes into the above but `isArray`
        // narrows to `Array`.
        propertiesFactory(
          /** @type {Props} */
          test
        )
      );
    }
    if (typeof test === "string") {
      return typeFactory(test);
    }
    throw new Error("Expected function, string, or object as test");
  })
);
function anyFactory(tests) {
  const checks = [];
  let index = -1;
  while (++index < tests.length) {
    checks[index] = convert(tests[index]);
  }
  return castFactory(any);
  function any(...parameters) {
    let index2 = -1;
    while (++index2 < checks.length) {
      if (checks[index2].apply(this, parameters)) return true;
    }
    return false;
  }
}
function propertiesFactory(check) {
  const checkAsRecord = (
    /** @type {Record<string, unknown>} */
    check
  );
  return castFactory(all);
  function all(node) {
    const nodeAsRecord = (
      /** @type {Record<string, unknown>} */
      /** @type {unknown} */
      node
    );
    let key;
    for (key in check) {
      if (nodeAsRecord[key] !== checkAsRecord[key]) return false;
    }
    return true;
  }
}
function typeFactory(check) {
  return castFactory(type);
  function type(node) {
    return node && node.type === check;
  }
}
function castFactory(testFunction) {
  return check;
  function check(value, index, parent) {
    return Boolean(
      looksLikeANode(value) && testFunction.call(
        this,
        value,
        typeof index === "number" ? index : void 0,
        parent || void 0
      )
    );
  }
}
function ok() {
  return true;
}
function looksLikeANode(value) {
  return value !== null && typeof value === "object" && "type" in value;
}

// ../../../node_modules/.pnpm/unist-util-visit-parents@6.0.2/node_modules/unist-util-visit-parents/lib/color.node.js
function color(d3) {
  return "\x1B[33m" + d3 + "\x1B[39m";
}

// ../../../node_modules/.pnpm/unist-util-visit-parents@6.0.2/node_modules/unist-util-visit-parents/lib/index.js
var empty = [];
var CONTINUE = true;
var EXIT = false;
var SKIP = "skip";
function visitParents(tree, test, visitor, reverse) {
  let check;
  if (typeof test === "function" && typeof visitor !== "function") {
    reverse = visitor;
    visitor = test;
  } else {
    check = test;
  }
  const is2 = convert(check);
  const step = reverse ? -1 : 1;
  factory(tree, void 0, [])();
  function factory(node, index, parents) {
    const value = (
      /** @type {Record<string, unknown>} */
      node && typeof node === "object" ? node : {}
    );
    if (typeof value.type === "string") {
      const name = (
        // `hast`
        typeof value.tagName === "string" ? value.tagName : (
          // `xast`
          typeof value.name === "string" ? value.name : void 0
        )
      );
      Object.defineProperty(visit2, "name", {
        value: "node (" + color(node.type + (name ? "<" + name + ">" : "")) + ")"
      });
    }
    return visit2;
    function visit2() {
      let result = empty;
      let subresult;
      let offset;
      let grandparents;
      if (!test || is2(node, index, parents[parents.length - 1] || void 0)) {
        result = toResult(visitor(node, parents));
        if (result[0] === EXIT) {
          return result;
        }
      }
      if ("children" in node && node.children) {
        const nodeAsParent = (
          /** @type {UnistParent} */
          node
        );
        if (nodeAsParent.children && result[0] !== SKIP) {
          offset = (reverse ? nodeAsParent.children.length : -1) + step;
          grandparents = parents.concat(nodeAsParent);
          while (offset > -1 && offset < nodeAsParent.children.length) {
            const child = nodeAsParent.children[offset];
            subresult = factory(child, offset, grandparents)();
            if (subresult[0] === EXIT) {
              return subresult;
            }
            offset = typeof subresult[1] === "number" ? subresult[1] : offset + step;
          }
        }
      }
      return result;
    }
  }
}
function toResult(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "number") {
    return [CONTINUE, value];
  }
  return value === null || value === void 0 ? empty : [value];
}

// ../../../node_modules/.pnpm/unist-util-visit@5.1.0/node_modules/unist-util-visit/lib/index.js
function visit(tree, testOrVisitor, visitorOrReverse, maybeReverse) {
  let reverse;
  let test;
  let visitor;
  if (typeof testOrVisitor === "function" && typeof visitorOrReverse !== "function") {
    test = void 0;
    visitor = testOrVisitor;
    reverse = visitorOrReverse;
  } else {
    test = testOrVisitor;
    visitor = visitorOrReverse;
    reverse = maybeReverse;
  }
  visitParents(tree, test, overload, reverse);
  function overload(node, parents) {
    const parent = parents[parents.length - 1];
    const index = parent ? parent.children.indexOf(node) : void 0;
    return visitor(node, index, parent);
  }
}

// src/plugins/imageCaptions.ts
var ImageCaptions = () => {
  return {
    name: "brinedew-image-captions",
    htmlPlugins() {
      return [() => (tree) => {
        visit(tree, "element", (node, index, parent) => {
          if (!parent || index === void 0) return;
          if (node.tagName !== "p") return;
          if (node.children.length !== 1) return;
          const img = node.children[0];
          if (img.type !== "element" || img.tagName !== "img") return;
          const alt = img.properties?.alt || "";
          if (!alt) return;
          const figcaption = {
            type: "element",
            tagName: "figcaption",
            properties: {},
            children: [{ type: "text", value: alt }]
          };
          const figure = {
            type: "element",
            tagName: "figure",
            properties: {},
            children: [img, figcaption]
          };
          parent.children.splice(index, 1, figure);
        });
      }];
    }
  };
};

// src/plugins/draftTagInjector.ts
var rehypeDraftTag = () => {
  return (_tree, file) => {
    const fm = file.data?.frontmatter;
    if (!fm) return;
    const isDraft = fm.draft === true || fm.draft === "true";
    if (!isDraft) return;
    const tags = Array.isArray(fm.tags) ? fm.tags : [];
    if (!tags.includes("draft")) {
      tags.push("draft");
      fm.tags = tags;
    }
  };
};
var DraftTagInjector = () => ({
  name: "brinedew-draft-tag-injector",
  htmlPlugins() {
    return [rehypeDraftTag];
  }
});
export {
  Citation_default as Citation,
  ContactForm_default as ContactForm,
  DraftTagInjector,
  HomepageCrawlFrontier_default as HomepageCrawlFrontier,
  IconoplasmPageSwitcher_default as IconoplasmPageSwitcher,
  ImageCaptions,
  ProteinInfobox_default as ProteinInfobox,
  TagSections_default as TagSections
};
